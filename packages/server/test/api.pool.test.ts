import type { Environment, ParsedEmail, SenderRuleResponse } from '../src/types';
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Dao } from '../src/db';
import { fetchHandler } from '../src/handler/fetch';
import { resetStorage, testEnv } from './helpers';

const db = (env as unknown as { DB: Environment['DB'] }).DB;
const bucket = (env as unknown as { BUCKET: NonNullable<Environment['BUCKET']> }).BUCKET;

beforeEach(resetStorage);

function parsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
    return {
        messageId: 'msg-1@test',
        from: 'sender@example.com',
        fromName: null,
        to: 'inbox@example.com',
        cc: null,
        bcc: null,
        subject: 'Hello',
        text: 'body',
        html: null,
        inReplyTo: null,
        references: [],
        date: new Date().toISOString(),
        rawHeaders: null,
        attachments: [],
        ...overrides,
    };
}

/** Bearer-authenticated request as the web principal. */
async function asOwner(path: string, init: RequestInit = {}): Promise<Response> {
    const configuration = testEnv({ WEB_PASSWORD: 'pw' });
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

describe('address pattern validation', () => {
    // Regression: patterns are matched against every inbound delivery, so a
    // catastrophic shape had to be refused before it could be stored.
    it('rejects a nested-quantifier pattern', async () => {
        const response = await asOwner('/api/addresses', {
            method: 'POST',
            body: JSON.stringify({ address: '^(a+)+@example\\.com$', type: 'block' }),
        });
        expect(response.status).toBe(400);
        expect(await count('addresses')).toBe(0);
    });

    it('rejects an unparsable pattern', async () => {
        const response = await asOwner('/api/addresses', {
            method: 'POST',
            body: JSON.stringify({ address: '([invalid', type: 'block' }),
        });
        expect(response.status).toBe(400);
        expect(await count('addresses')).toBe(0);
    });

    it('accepts ordinary addresses and safe patterns', async () => {
        for (const address of ['spam@example.com', '.*@spam\\.test', '^(abc)+@example\\.com$']) {
            const response = await asOwner('/api/addresses', {
                method: 'POST',
                body: JSON.stringify({ address, type: 'block' }),
            });
            expect(response.status).toBe(200);
        }
        expect(await count('addresses')).toBe(3);
    });
});

describe('attachment response hardening', () => {
    it('serves attachments with nosniff and a sandboxed policy', async () => {
        const dao = new Dao(db);
        await dao.insertEmail(parsedEmail(), { id: 'mail-1', folder: 'inbox', size: 10 });
        await dao.insertAttachments('mail-1', [
            {
                id: 'att-1',
                email_id: 'mail-1',
                filename: 'note.txt',
                // Sender-controlled mimetype, as stored from the MIME headers.
                mimetype: 'text/html',
                size: 4,
                content_id: null,
                disposition: 'attachment',
                r2_key: 'attachments/mail-1/att-1/note.txt',
            },
        ]);
        await bucket.put('attachments/mail-1/att-1/note.txt', 'evil');

        const response = await asOwner('/api/emails/mail-1/attachments/att-1');

        expect(response.status).toBe(200);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toBe('sandbox');
        expect(response.headers.get('content-disposition')).toContain('attachment');
    });
});

async function count(table: string): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
    return row?.total ?? 0;
}

describe('sender rule from a mail', () => {
    let seq = 0;
    /** Inserts a mail from `sender` and returns its (url-safe) id. */
    async function seedSender(sender: string, folder = 'inbox'): Promise<string> {
        const dao = new Dao(db);
        const id = `mail-${(seq += 1)}`;
        await dao.insertEmail(parsedEmail({ messageId: `seed-${id}`, from: sender }), {
            id,
            folder: folder as 'inbox' | 'spam',
            size: 10,
        });
        return id;
    }

    it('blocks the sender and files the mail as spam', async () => {
        const id = await seedSender('spammer@example.com');
        const response = await asOwner(`/api/emails/${id}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action: 'block' }),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as SenderRuleResponse;
        expect(body.address).toBe('spammer@example.com');
        expect(body.changed).toBe(true);
        expect(body.folder).toBe('spam');

        const rule = await db
            .prepare(`SELECT type FROM addresses WHERE address = 'spammer@example.com'`)
            .first<{ type: string }>();
        expect(rule?.type).toBe('block');
        const mail = await db.prepare(`SELECT folder FROM emails WHERE id = ?`).bind(id).first<{ folder: string }>();
        expect(mail?.folder).toBe('spam');
    });

    it('trusts the sender and brings the mail back to the inbox', async () => {
        const id = await seedSender('friend@example.com', 'spam');
        const response = await asOwner(`/api/emails/${id}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action: 'trust' }),
        });

        expect(response.status).toBe(200);
        const rule = await db
            .prepare(`SELECT type FROM addresses WHERE address = 'friend@example.com'`)
            .first<{ type: string }>();
        expect(rule?.type).toBe('white');
        const mail = await db.prepare(`SELECT folder FROM emails WHERE id = ?`).bind(id).first<{ folder: string }>();
        expect(mail?.folder).toBe('inbox');
    });

    it('reports when the rule already existed instead of duplicating it', async () => {
        await new Dao(db).addAddress('spammer@example.com', 'block');
        const id = await seedSender('spammer@example.com');

        const response = await asOwner(`/api/emails/${id}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action: 'block' }),
        });
        const body = (await response.json()) as SenderRuleResponse;

        expect(body.changed).toBe(false);
        expect(await count('addresses')).toBe(1);
    });

    it('unwraps a display-name sender', async () => {
        const id = await seedSender('Real Name <real@example.com>');
        const response = await asOwner(`/api/emails/${id}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action: 'block' }),
        });
        const body = (await response.json()) as SenderRuleResponse;
        expect(body.address).toBe('real@example.com');
    });

    it('rejects an unknown action and an unusable sender', async () => {
        const id = await seedSender('nobody@example.com');
        const bad = await asOwner(`/api/emails/${id}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action: 'delete-everything' }),
        });
        expect(bad.status).toBe(400);

        const emptyId = await seedSender('');
        const empty = await asOwner(`/api/emails/${emptyId}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action: 'block' }),
        });
        expect(empty.status).toBe(400);
    });

    it('requires authentication', async () => {
        const id = await seedSender('spammer@example.com');
        const response = await fetchHandler(
            new Request(`https://worker.test/api/emails/${id}/address-rule`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'block' }),
            }),
            testEnv({ WEB_PASSWORD: 'pw' }),
        );
        expect(response.status).toBe(401);
    });
});
