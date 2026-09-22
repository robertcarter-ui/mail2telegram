import type { EmailMessage, ForwardableEmailMessage } from '@cloudflare/workers-types';
import type { AddressTestResponse } from '@mail2telegram/shared';
import type { AddressType, Environment } from '../types';
import { Dao, loadArrayFromRaw } from '../db';

export type AddressCheckStatus = 'white' | 'block' | 'no_match';

/**
 * Longest pattern accepted for matching. Generous for an address glob or regex,
 * and small enough that the structural scan below stays cheap and cannot recurse
 * without bound.
 */
const MAX_PATTERN_LENGTH = 512;

/**
 * Longest address that is still matched against a pattern. Addresses have a
 * small practical length bound, and matching an unbounded attacker string with
 * a backtracking engine is what turns a careless pattern into a CPU sink.
 */
const MAX_TESTED_ADDRESS_LENGTH = 320;

/**
 * How many quantifiers a pattern may contain. Two or three are common in address
 * globs (`.*@spam\.test`, `^[a-z]+\.[a-z]+@`); beyond that the pattern is
 * almost certainly an accidental ReDoS rather than an address matcher.
 */
const MAX_PATTERN_QUANTIFIERS = 3;

interface ScanResult {
    /** True when a quantifier was applied to a group that varies or alternates. */
    nested: boolean;
    /**
     * Number of quantifiers in the fragment. Each one multiplies the ways the
     * engine can split the input, so a handful of them is already enough for
     * explosive backtracking whether they are written `a*a*`, `a?a?` or
     * `[a-z]{1,4}[a-z]{1,4}`.
     */
    quantifiers: number;
    /** True when this fragment contains a top-level alternation. */
    alternation: boolean;
    /** True when this fragment can match strings of differing lengths. */
    variable: boolean;
}

interface Quantifier {
    applied: boolean;
}

/**
 * Rejects address-list patterns that let a backtracking engine do superlinear
 * work. Matching runs on every inbound delivery against a sender-controlled
 * address, so a pathological pattern would let one short email burn worker CPU.
 *
 * Two structural rules, deliberately not a shape blacklist — four rounds of
 * review each found a fresh blacklist bypass, so the rules bound the property
 * that actually causes blow-up instead:
 *
 * 1. A quantifier may not be applied to a group whose body can itself vary in
 *    length or alternate. That is what makes backtracking exponential, whether
 *    the outer quantifier is `+`, `*`, or a bounded `{1,1000}`.
 * 2. The pattern may contain at most `MAX_PATTERN_QUANTIFIERS` quantifiers. Each
 *    one multiplies the ways the engine can split the input, so a run such as
 *    `a*a*b`, `a?a?a?`, or `[x]{1,64}[x]{1,64}` is refused however it is spelled.
 *
 * The address length bound and owner-only pattern authorship remain part of the
 * containment: static analysis cannot prove a regex safe in general, and a
 * crafted pattern can still be quadratic. The rules deliberately refuse some
 * patterns that would in fact be fine (`(foo|bar)+`, `^\w+(\.\w+)*@`): for an
 * address list a false rejection is a clear error message, while a false
 * acceptance stalls the delivery path. See the review notes for the residual
 * risk.
 */
/**
 * Applies a quantifier to the atom just consumed: it widens the fragment and
 * counts toward the quantifier budget.
 */
function applyQuantifier(result: ScanResult, quantifier: Quantifier): void {
    if (quantifier.applied) {
        result.variable = true;
        result.quantifiers += 1;
    }
}

export function isSafeAddressPattern(pattern: string): boolean {
    // A pattern this long is not a plausible address match, and refusing it up
    // front keeps the recursive scan below from running away on deep nesting.
    if (pattern.length > MAX_PATTERN_LENGTH) {
        return false;
    }
    let index = 0;

    /** Consumes a quantifier at the cursor, if one is present. */
    function consumeQuantifier(): Quantifier {
        const ch = pattern[index];
        if (ch === '*' || ch === '+') {
            index += 1;
            // A trailing `?` only makes it lazy; it still repeats.
            if (pattern[index] === '?') {
                index += 1;
            }
            return { applied: true };
        }
        if (ch === '?') {
            index += 1;
            return { applied: true };
        }
        if (ch === '{') {
            const close = pattern.indexOf('}', index);
            if (close !== -1) {
                const body = pattern.slice(index + 1, close).trim();
                // `{n}`, `{n,m}` and `{n,}` are quantifiers; anything else is literal.
                if (/^\d+(,\d*)?$/.test(body)) {
                    index = close + 1;
                    if (pattern[index] === '?') {
                        index += 1;
                    }
                    // `{n}` repeats exactly n times, `{n,}` has no upper bound and
                    // `{n,m}` repeats up to m. Every one of them multiplies the
                    // number of ways the engine can split the input.
                    return { applied: true };
                }
            }
        }
        return { applied: false };
    }

    /** Scans until the end of the pattern or the next unmatched `)`. */
    function scan(): ScanResult {
        const result: ScanResult = { nested: false, quantifiers: 0, alternation: false, variable: false };
        while (index < pattern.length) {
            const ch = pattern[index];

            if (ch === '\\') {
                // An escaped character is one atom; consume it and any quantifier.
                index += 2;
                applyQuantifier(result, consumeQuantifier());
                continue;
            }

            if (ch === '[') {
                index += 1;
                while (index < pattern.length && pattern[index] !== ']') {
                    index += pattern[index] === '\\' ? 2 : 1;
                }
                index += 1;
                applyQuantifier(result, consumeQuantifier());
                continue;
            }

            if (ch === '(') {
                index += 1;
                const prefix = readGroupPrefix();
                if (prefix === 'skip') {
                    // `(?i)` and friends carry no body to check.
                    continue;
                }
                const body = scan();
                const quantifier = consumeQuantifier();
                // Rule 1: any quantifier over a body that varies or alternates.
                if (quantifier.applied && (body.variable || body.alternation)) {
                    result.nested = true;
                }
                result.nested = result.nested || body.nested;
                result.quantifiers += body.quantifiers + (quantifier.applied ? 1 : 0);
                // A lookaround matches no characters, so it does not widen the
                // enclosing fragment; its own body has still been checked.
                if (prefix !== 'look') {
                    result.alternation = result.alternation || body.alternation;
                    result.variable = result.variable || body.variable || quantifier.applied;
                }
                continue;
            }

            if (ch === ')') {
                index += 1;
                return result;
            }

            if (ch === '|') {
                result.alternation = true;
                index += 1;
                continue;
            }

            index += 1;
            applyQuantifier(result, consumeQuantifier());
        }
        return result;
    }

    /**
     * Consumes the modifier after `(`, reporting `look` for a lookaround (which
     * matches no characters) and `skip` for a body-less inline flag group.
     */
    function readGroupPrefix(): 'body' | 'look' | 'skip' {
        if (pattern[index] !== '?') {
            return 'body';
        }
        index += 1;
        if (pattern[index] === ':') {
            index += 1;
            return 'body';
        }
        if (pattern[index] === '=' || pattern[index] === '!') {
            index += 1;
            return 'look';
        }
        if (pattern[index] === '<') {
            if (pattern[index + 1] === '=' || pattern[index + 1] === '!') {
                index += 2;
                return 'look';
            }
            // Named group `(?<name>`: skip only the name itself.
            index += 1;
            while (index < pattern.length && pattern[index] !== '>') {
                index += 1;
            }
            index += 1;
            return 'body';
        }
        // Inline flags: `(?i)` has no body, while `(?i:...)` does.
        while (index < pattern.length && pattern[index] !== ')' && pattern[index] !== ':') {
            index += 1;
        }
        if (pattern[index] === ':') {
            index += 1;
            return 'body';
        }
        index += 1;
        return 'skip';
    }

    const scanned = scan();
    if (scanned.nested) {
        return false;
    }
    // Rule 2: one repetition is linear, but a handful of them — `a*a*b`,
    // `a?a?a?`, `[x]{1,64}[x]{1,64}` — lets the engine try an explosive number
    // of splits. A small budget keeps ordinary globs working while cutting the
    // ambiguity off long before it matters. The address length bound and the
    // fact that only the owner writes patterns remain part of the containment;
    // see the review notes.
    return scanned.quantifiers <= MAX_PATTERN_QUANTIFIERS;
}

/** Validate an owner-entered pattern, returning an error message or null. */
export function validateAddressPattern(pattern: string): string | null {
    try {
        // Compile once to surface syntax errors before the pattern is stored.
        const compiled = new RegExp(pattern, 'i');
        if (!compiled.source) {
            return 'Invalid regular expression';
        }
    } catch {
        return 'Invalid regular expression';
    }
    // The scan is bounded and non-recursive in practice, but a guard that fails
    // must fail closed rather than reject the request with a 500.
    let safe = false;
    try {
        safe = isSafeAddressPattern(pattern);
    } catch {
        safe = false;
    }
    if (!safe) {
        return 'Pattern repeats a variable or alternating group, which can backtrack catastrophically';
    }
    return null;
}

/** Match an address against a pattern: exact (case-insensitive) or regular expression. */
export function testAddress(address: string, pattern: string): boolean {
    if (pattern.toLowerCase() === address.toLowerCase()) {
        return true;
    }
    // A pattern can only match an address, so anything longer than the RFC
    // ceiling cannot be a legitimate match; refuse to backtrack over it.
    if (address.length > MAX_TESTED_ADDRESS_LENGTH) {
        return false;
    }
    try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(address);
    } catch {
        return false;
    }
}

function matchAddress(list: string[], address: string): boolean {
    for (const item of list) {
        if (item && testAddress(address, item)) {
            return true;
        }
    }
    return false;
}

export interface AddressLists {
    white: string[];
    block: string[];
}

/**
 * Load white/black list patterns from D1, seeded by deployment variables when
 * present. Patterns that fail the safety check are dropped here as well as at
 * write time: the deployment variables are not validated by the settings API,
 * and a row stored before the check existed would otherwise still be matched
 * against every inbound delivery.
 */
export async function loadAddressLists(env: Environment): Promise<AddressLists> {
    const dao = new Dao(env.DB);
    const whiteFromDb = (await dao.listAddresses('white')).map(item => item.address);
    const blockFromDb = (await dao.listAddresses('block')).map(item => item.address);
    const seedWhite = loadArrayFromRaw(env.WHITE_LIST);
    const seedBlock = loadArrayFromRaw(env.BLOCK_LIST);
    return {
        white: usablePatterns('white', [...seedWhite, ...whiteFromDb]),
        block: usablePatterns('block', [...seedBlock, ...blockFromDb]),
    };
}

/** Drops patterns that cannot be matched safely, reporting each one once. */
function usablePatterns(type: AddressType, patterns: string[]): string[] {
    const usable: string[] = [];
    for (const pattern of patterns) {
        if (!pattern) {
            continue;
        }
        let safe = false;
        try {
            safe = isSafeAddressPattern(pattern);
        } catch {
            // A pattern that cannot be analysed must not reach the matcher, and
            // must not break the delivery path either.
            safe = false;
        }
        if (safe) {
            usable.push(pattern);
            continue;
        }
        console.error('[mail] address.pattern.skipped', type, pattern);
    }
    return usable;
}

export async function checkAddressStatus(
    addresses: string[],
    env: Environment,
): Promise<{ [key: string]: AddressCheckStatus }> {
    const { white, block } = await loadAddressLists(env);
    const result: { [key: string]: AddressCheckStatus } = {};
    for (const addr of addresses) {
        if (!addr) {
            continue;
        }
        if (matchAddress(white, addr)) {
            result[addr] = 'white';
            continue;
        }
        if (matchAddress(block, addr)) {
            result[addr] = 'block';
            continue;
        }
        result[addr] = 'no_match';
    }
    return result;
}

/**
 * The address inside a `From` header value, e.g. `Alice <alice@example.com>`.
 * Falls back to the whole value when there are no angle brackets.
 */
export function headerAddress(value: string | null | undefined): string {
    if (!value) {
        return '';
    }
    const angled = value.match(/<([^>]*)>/);
    const candidate = (angled ? angled[1] : value).trim();
    return candidate.replace(/^["']|["']$/g, '').trim();
}

/**
 * White list wins over black list.
 *
 * The lists are matched against the envelope sender and recipient, and against
 * the `From` header as well, because those are different addresses in practice:
 * mail sent through a provider (SES, SendGrid, most mailing lists) carries a
 * bounce address such as `...@send.example.com` in the envelope while the `From`
 * header shows the address a person would recognise. Matching only the envelope
 * made a rule written against the visible sender silently do nothing.
 *
 * None of these values is authenticated, so this is a usability fix rather than
 * a spoofing defence: a sender can still set either one freely.
 */
export async function isMessageBlock(message: EmailMessage, env: Environment): Promise<boolean> {
    // Only `ForwardableEmailMessage` carries the headers; `EmailMessage` is the
    // base type, so read the header defensively.
    const headers = (message as Partial<ForwardableEmailMessage>).headers;
    const fromHeader = headerAddress(headers?.get('From'));
    const res = await checkAddressStatus([message.from, fromHeader, message.to], env);
    for (const key in res) {
        if (res[key] === 'white') {
            return false;
        }
    }
    for (const key in res) {
        if (res[key] === 'block') {
            return true;
        }
    }
    return false;
}

/** Test a single address, returning every matching pattern per list. */
export async function testAddressAgainstLists(address: string, env: Environment): Promise<AddressTestResponse> {
    const { white, block } = await loadAddressLists(env);
    const matchedWhite = white.filter(pattern => pattern && testAddress(address, pattern));
    const matchedBlock = block.filter(pattern => pattern && testAddress(address, pattern));
    let status: AddressCheckStatus = 'no_match';
    if (matchedWhite.length > 0) {
        status = 'white';
    } else if (matchedBlock.length > 0) {
        status = 'block';
    }
    return { status, matchedWhite, matchedBlock };
}

export type { AddressType };
