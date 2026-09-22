import type { Environment } from '../src/types';
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dao } from '../src/db';
import { fetchHandler } from '../src/handler/fetch';
import { resetStorage, testEnv } from './helpers';

const db = (env as unknown as { DB: Environment['DB'] }).DB;

beforeEach(resetStorage);

/** Bearer-authenticated request as the web principal, with env overrides. */
async function asOwner(path: string, init: RequestInit = {}, overrides: Partial<Environment> = {}): Promise<Response> {
    const configuration = testEnv({ WEB_PASSWORD: 'pw', ...overrides });
    const login = await fetchHandler(
        new Request('https://worker.test/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'pw' }),
        }),
        configuration,
    );
    const { token } = (await login.json()) as { token: string };
    return fetchHandler(
        new Request(`https://worker.test${path}`, {
            ...init,
            headers: { Authorization: `web ${token}`, 'content-type': 'application/json', ...init.headers },
        }),
        configuration,
    );
}

interface ResendMock {
    readonly bodies: string[];
}

let restoreFetch: (() => void) | null = null;

afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
});

/** Intercepts the Resend send call and records request bodies. */
function mockResendFetch(ok = true): ResendMock {
    const bodies: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''));
        return ok ? Response.json({ id: 'out-1' }) : Response.json({ message: 'Domain not verified' }, { status: 403 });
    }) as typeof fetch;
    restoreFetch = () => {
        globalThis.fetch = original;
    };
    return { bodies };
}

async function countSent(): Promise<number> {
    const row = await db
        .prepare(`SELECT COUNT(*) AS total FROM emails WHERE folder = 'sent'`)
        .first<{ total: number }>();
    return row?.total ?? 0;
}

const RESEND = { RESEND_API_KEY: 're-test-key' };

function sendBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        from: 'me@own.test',
        to: 'friend@example.com',
        subject: 'Hello',
        text: 'Plain body',
        ...overrides,
    });
}

describe('POST /api/emails/send', () => {
    it('sends through Resend with cc/bcc and attachments, and files a Sent copy', async () => {
        const mock = mockResendFetch();
        const response = await asOwner(
            '/api/emails/send',
            {
                method: 'POST',
                body: JSON.stringify({
                    from: 'Me <me@own.test>',
                    to: 'a@example.com, b@example.com',
                    cc: 'c@example.com',
                    bcc: 'd@example.com',
                    subject: 'With attachment',
                    text: 'See attached',
                    attachments: [{ filename: 'note.txt', mimetype: 'text/plain', content: btoa('hello'), size: 5 }],
                }),
            },
            RESEND,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(mock.bodies).toHaveLength(1);
        const sent = JSON.parse(mock.bodies[0]) as {
            from: string;
            to: string[];
            cc: string[];
            bcc: string[];
            subject: string;
            text: string;
            attachments: { filename: string; content: string }[];
        };
        expect(sent.from).toBe('Me <me@own.test>');
        expect(sent.to).toEqual(['a@example.com', 'b@example.com']);
        expect(sent.cc).toEqual(['c@example.com']);
        expect(sent.bcc).toEqual(['d@example.com']);
        expect(sent.attachments[0]).toMatchObject({ filename: 'note.txt', content: btoa('hello') });

        const dao = new Dao(db);
        const copy = await dao.listEmails({ folder: 'sent' });
        expect(copy.total).toBe(1);
        expect(copy.emails[0].sender).toBe('Me <me@own.test>');
        expect(copy.emails[0].recipient).toBe('a@example.com, b@example.com');
        expect(copy.emails[0].subject).toBe('With attachment');
    });

    it('keeps the sent copy consistent with the reply flow', async () => {
        mockResendFetch();
        const dao = new Dao(db);
        await asOwner('/api/emails/send', { method: 'POST', body: sendBody({ text: 'body' }) }, RESEND);
        const sent = await dao.listEmails({ folder: 'sent' });
        expect(sent.emails[0].cc).toBeNull();
        expect(sent.emails[0].bcc).toBeNull();
    });

    it('requires the Resend key', async () => {
        const response = await asOwner('/api/emails/send', { method: 'POST', body: sendBody() });
        expect(response.status).toBe(400);
        expect(await countSent()).toBe(0);
    });

    it('requires authentication', async () => {
        const response = await fetchHandler(
            new Request('https://worker.test/api/emails/send', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: sendBody(),
            }),
            testEnv({ WEB_PASSWORD: 'pw', ...RESEND }),
        );
        expect(response.status).toBe(401);
    });

    it('rejects malformed addresses and missing fields before calling Resend', async () => {
        const mock = mockResendFetch();
        for (const body of [
            sendBody({ from: '' }),
            sendBody({ from: 'a@x.test, b@x.test' }),
            sendBody({ to: 'not-an-address' }),
            sendBody({ cc: 'also-bad' }),
            sendBody({ subject: '   ' }),
            sendBody({ text: '' }),
        ]) {
            const response = await asOwner('/api/emails/send', { method: 'POST', body }, RESEND);
            expect(response.status).toBe(400);
        }
        expect(mock.bodies).toHaveLength(0);
        expect(await countSent()).toBe(0);
    });

    it('surfaces Resend failures and stores no copy', async () => {
        mockResendFetch(false);
        const response = await asOwner('/api/emails/send', { method: 'POST', body: sendBody() }, RESEND);
        expect(response.status).toBe(500);
        expect(((await response.json()) as { error: string }).error).toContain('Domain not verified');
        expect(await countSent()).toBe(0);
    });

    it('rejects attachments beyond the Resend budget', async () => {
        const mock = mockResendFetch();
        // Decodes to 41,999,998 bytes — above the 41,943,040 (40 MB) limit.
        const oversized = 'A'.repeat(56_000_000);
        const response = await asOwner(
            '/api/emails/send',
            {
                method: 'POST',
                body: sendBody({
                    attachments: [{ filename: 'big.bin', mimetype: 'application/octet-stream', content: oversized }],
                }),
            },
            RESEND,
        );
        expect(response.status).toBe(413);
        expect(mock.bodies).toHaveLength(0);
        expect(await countSent()).toBe(0);
    });
});
