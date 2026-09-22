import { headerAddress, isSafeAddressPattern, testAddress, validateAddressPattern } from './check';

function expectMatch(address: string, pattern: string, expected: boolean): void {
    const got = testAddress(address, pattern);
    if (got !== expected) {
        throw new Error(`testAddress("${address}", "${pattern}") = ${got}, expected ${expected}`);
    }
}

function expectSafe(pattern: string, expected: boolean): void {
    const got = isSafeAddressPattern(pattern);
    if (got !== expected) {
        throw new Error(`isSafeAddressPattern("${pattern}") = ${got}, expected ${expected}`);
    }
}

function testCase() {
    expectMatch('alice@example.com', 'alice@example.com', true);
    expectMatch('alice@example.com', 'ALICE@EXAMPLE.COM', true);
    expectMatch('alice@example.com', '^alice@', true);
    expectMatch('alice@example.com', 'example\\.com$', true);
    expectMatch('alice@example.com', 'bob@example.com', false);
    expectMatch('alice@example.com', 'nomatch@other.com', false);
    // Invalid regex patterns match nothing instead of throwing.
    expectMatch('alice@example.com', '([invalid', false);
    // Wildcard-style regex patterns behave as documented.
    expectMatch('anything@spam.test', '.*@spam\\.test', true);
    // An address longer than the RFC ceiling is refused before backtracking,
    // so a catastrophic pattern cannot be fed an unbounded string.
    expectMatch(`${'a'.repeat(400)}!`, '^(a+)+@example\\.com$', false);
    console.log('testAddress ok: exact, case-insensitive, regex, invalid-regex and length-bound behavior');
}

/**
 * The ReDoS fix has two halves and both need coverage: dangerous shapes are
 * refused at write time, and ordinary patterns (including a group with a single
 * quantifier, which the heuristic must not reject) keep working.
 */
function testPatternGuard() {
    // Nested unbounded quantifiers: the classic catastrophic shapes.
    expectSafe('^(a+)+@example\\.com$', false);
    expectSafe('^(\\w+\\.?)+@example\\.com$', false);
    expectSafe('^([ab]+[ab]+)+@example\\.com$', false);
    // The traps a regex-only heuristic missed: quantified alternation and
    // double-nested groups are just as explosive.
    expectSafe('^(a|aa)+@example\\.com$', false);
    expectSafe('^((a+))+@example\\.com$', false);
    expectSafe('^(a|a?)+@example\\.com$', false);
    expectSafe('(a|aa)+@example\\.com', false);
    expectSafe('^(a+){2,}@example\\.com$', false);
    // A bounded range is still enough to explode when it repeats a variable body.
    expectSafe('(a{1,3})+@example\\.com', false);
    expectSafe('([a-z]{1,3})+@example\\.com', false);
    // ...and so is a large bounded count (`{1,1000}`), or a run of overlapping
    // quantified atoms (`a*a*a*b`), which are only quadratic but still stall.
    expectSafe('^(a+){1,1000}b$', false);
    expectSafe('^a*a*a*a*a*a*a*a*a*b$', false);
    // Quantifier runs are refused however they are spelled, including several
    // `?` or several bounded ranges, which a shape blacklist kept accepting.
    expectSafe('^a?a?a?a?a?a?a?a?a?a?b$', false);
    expectSafe('^[\\w.+-]{1,64}[\\w.+-]{1,64}[\\w.+-]{1,64}[\\w.+-]{1,64}@x$', false);
    expectSafe('^.*.*.*.*@example\\.com$', false);
    // A nested quantifier must not be hidden inside a lookaround or group header.
    expectSafe('(?=(a+)+b)a+@example\\.com', false);
    expectSafe('^(?=(a+)+$)', false);
    // A pattern long enough to be an attack rather than an address matcher.
    expectSafe(`^${'a?'.repeat(400)}b$`, false);
    // Ordinary patterns stay allowed.
    expectSafe('^alice@', true);
    expectSafe('.*@spam\\.test', true);
    expectSafe('^(abc)+@example\\.com$', true);
    expectSafe('^[a-z]+@example\\.com$', true);
    expectSafe('^noreply@.*\\.example\\.com$', true);
    expectSafe('^(alice|bob)@example\\.com$', true);
    expectSafe('alice@example.com', true);
    expectSafe('^[a-z]{2,4}@example\\.com$', true);
    expectSafe('^user\\+tag@example\\.com$', true);
    expectSafe('^\\d{1,3}@example\\.com$', true);
    expectSafe('^(?<local>[a-z]+)@example\\.com$', true);
    expectSafe('(?:foo)+@example\\.com$', true);
    expectSafe('^[^@]+@example\\.com$', true);

    if (validateAddressPattern('^(a+)+@x$') === null) {
        throw new Error('validateAddressPattern accepted a catastrophic pattern');
    }
    if (validateAddressPattern('(a|aa)+@x') === null) {
        throw new Error('validateAddressPattern accepted a quantified alternation');
    }
    if (validateAddressPattern('(a{1,3})+@x') === null) {
        throw new Error('validateAddressPattern accepted a repeated bounded range');
    }
    if (validateAddressPattern('^(a+){1,1000}b$') === null) {
        throw new Error('validateAddressPattern accepted a large bounded repeat of a variable body');
    }
    if (validateAddressPattern('^a?a?a?a?a?a?a?a?a?a?b$') === null) {
        throw new Error('validateAddressPattern accepted a run of optional quantifiers');
    }
    if (validateAddressPattern('^.*.*.*.*@x$') === null) {
        throw new Error('validateAddressPattern accepted a run of star quantifiers');
    }
    // The scan must never throw, even on deeply nested or malformed input.
    for (const hostile of ['(', '[', '\\', '(?', '(((((((((', 'a{1,2}{1,2}']) {
        isSafeAddressPattern(hostile);
        validateAddressPattern(hostile);
    }
    if (validateAddressPattern('([invalid') !== 'Invalid regular expression') {
        throw new Error('validateAddressPattern did not report an invalid regex');
    }
    if (validateAddressPattern('^alice@') !== null) {
        throw new Error('validateAddressPattern rejected a safe pattern');
    }
    console.log('validateAddressPattern ok: rejects nested, range, lookaround and multi-quantifier shapes');
}

testCase();
testPatternGuard();

/**
 * Senders behind a provider arrive with a bounce address in the envelope and the
 * real address in the From header, so a block rule must see the header too.
 */
function testHeaderAddress() {
    const cases: [string, string][] = [
        ['Alice <alice@example.com>', 'alice@example.com'],
        ['<bare@example.com>', 'bare@example.com'],
        ['plain@example.com', 'plain@example.com'],
        ['"Quoted Name" <quoted@example.com>', 'quoted@example.com'],
        ['provider+bounce@send.example.com', 'provider+bounce@send.example.com'],
    ];
    for (const [input, expected] of cases) {
        const got = headerAddress(input);
        if (got !== expected) {
            throw new Error(
                `headerAddress(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
            );
        }
    }
    console.log('headerAddress ok: extracts the address from display-name forms');
}

testHeaderAddress();
