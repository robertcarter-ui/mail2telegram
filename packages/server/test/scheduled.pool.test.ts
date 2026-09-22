import type { Environment, ParsedEmail } from '../src/types';
import { createScheduledController, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Dao } from '../src/db';
import { scheduledHandler } from '../src/handler/scheduled';
import { resetStorage, testEnv } from './helpers';

const db = (env as unknown as { DB: Environment['DB'] }).DB;

beforeEach(resetStorage);

const parsed: ParsedEmail = {
    messageId: 'old@test',
    from: 'sender@example.com',
    fromName: null,
    to: 'inbox@example.com',
    cc: null,
    bcc: null,
    subject: 'Old mail',
    text: 'body',
    html: null,
    inReplyTo: null,
    references: [],
    date: new Date().toISOString(),
    rawHeaders: null,
    attachments: [],
};

/** The cron removes mail older than the retention, together with its journal. */
describe('scheduled cleanup', () => {
    it('purges expired mail, its chat mapping and its delivery journal', async () => {
        const dao = new Dao(db);
        await dao.insertEmail(parsed, { id: 'old-id', folder: 'inbox', size: 64 });
        await db.prepare('UPDATE emails SET created_at = ?').bind('2020-01-01T00:00:00.000Z').run();
        await dao.saveTelegramMessage(400, 5, 'old-id');
        // The journal key is the stored delivery identity (emails.message_id).
        await dao.upsertMailStatus('old@test', { telegram: true, forwards: [] });

        await scheduledHandler(createScheduledController(), testEnv({ AUTO_CLEANUP_DAYS: '1' }));

        expect(await count('emails')).toBe(0);
        expect(await count('mail_status')).toBe(0);
        expect(await count('telegram_messages')).toBe(0);
    });

    it('keeps mail when auto cleanup is disabled', async () => {
        const dao = new Dao(db);
        await dao.insertEmail(parsed, { id: 'keep-id', folder: 'inbox', size: 64 });
        await db.prepare('UPDATE emails SET created_at = ?').bind('2020-01-01T00:00:00.000Z').run();

        await scheduledHandler(createScheduledController(), testEnv({ AUTO_CLEANUP_DAYS: '0' }));

        expect(await count('emails')).toBe(1);
    });
});

async function count(table: string): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
    return row?.total ?? 0;
}
