import type { Environment } from '../src/types';
import type * as Telegram from 'telegram-bot-api-types';
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dao } from '../src/db';
import { loadSettings, saveSettings } from '../src/db/settings';
import { renderEmailDebugMode } from '../src/mail';
import { telegramWebhookHandler } from '../src/telegram';
import { mockTelegramFetch, resetStorage, testEnv } from './helpers';

const db = (env as unknown as { DB: Environment['DB'] }).DB;

let telegram: ReturnType<typeof mockTelegramFetch>;
beforeEach(async () => {
    await resetStorage();
    telegram = mockTelegramFetch();
});
afterEach(() => telegram.restore());

/** One stored mail so the render handlers have something to fetch. */
async function seedEmail(): Promise<string> {
    const dao = new Dao(db);
    await dao.insertEmail(
        {
            messageId: 'seed@test',
            from: 'sender@example.com',
            fromName: null,
            to: 'inbox@example.com',
            cc: null,
            bcc: null,
            subject: 'Seed',
            text: 'seeded body',
            html: null,
            inReplyTo: null,
            references: [],
            date: new Date().toISOString(),
            rawHeaders: null,
            attachments: [],
        },
        { id: 'seed-id', folder: 'inbox', size: 10 },
    );
    return 'seed-id';
}

function callbackUpdate(chatId: number, data: string): Request {
    return new Request('https://worker.test/telegram/test-token/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            update_id: 1,
            callback_query: {
                id: 'cb-1',
                chat_instance: 'ci-1',
                from: { id: 42, is_bot: false, first_name: 'Stranger' },
                data,
                message: { message_id: 77, date: 0, chat: { id: chatId, type: 'group' } },
            },
        } satisfies Telegram.Update),
    });
}

describe('telegram callback authorization', () => {
    // Regression: the command path checked isAllowedChat but the callback path
    // did not, so a chat removed from TELEGRAM_ID kept full button authority
    // over the notifications it had already received.
    it('ignores callbacks from a chat outside TELEGRAM_ID', async () => {
        await seedEmail();
        const configuration = testEnv({ TELEGRAM_ID: '111' });

        await telegramWebhookHandler(callbackUpdate(999, 'p:seed-id'), configuration);

        expect(telegram.calls).toBe(0);
    });

    it('still serves callbacks from an allowed chat', async () => {
        await seedEmail();
        const configuration = testEnv({ TELEGRAM_ID: '111' });

        await telegramWebhookHandler(callbackUpdate(111, 'p:seed-id'), configuration);

        expect(telegram.calls).toBe(1);
    });

    it('does not run the debug dump when DEBUG is off', async () => {
        await seedEmail();
        const configuration = testEnv({ TELEGRAM_ID: '111', DEBUG: 'false' });

        await telegramWebhookHandler(callbackUpdate(111, 'd:seed-id'), configuration);

        expect(telegram.calls).toBe(0);
    });

    it('runs the debug dump for an allowed chat when DEBUG is on', async () => {
        await seedEmail();
        const configuration = testEnv({ TELEGRAM_ID: '111', DEBUG: 'true' });

        await telegramWebhookHandler(callbackUpdate(111, 'd:seed-id'), configuration);

        expect(telegram.calls).toBe(1);
    });
});

describe('debug dump redaction', () => {
    // The dump is rendered into a chat, which can hold members beyond the
    // owner, so the stored provider credential must never appear in it.
    it('does not include the stored api key', async () => {
        const configuration = testEnv({ DEBUG: 'true' });
        await saveSettings(new Dao(db), { openaiApiKey: 'sk-super-secret-value' });
        const dao = new Dao(db);
        await dao.insertEmail(
            {
                messageId: 'redact@test',
                from: 'sender@example.com',
                fromName: null,
                to: 'inbox@example.com',
                cc: null,
                bcc: null,
                subject: 'Redact',
                text: 'body',
                html: null,
                inReplyTo: null,
                references: [],
                date: new Date().toISOString(),
                rawHeaders: null,
                attachments: [],
            },
            { id: 'redact-id', folder: 'inbox', size: 10 },
        );
        const stored = (await dao.getEmail('redact-id'))!;

        const rendered = await renderEmailDebugMode(stored, configuration, await loadSettings(configuration));

        expect(rendered.text).not.toContain('sk-super-secret-value');
        expect(rendered.text).toContain('<redacted>');
    });

    it('drops credentials embedded in the base url', async () => {
        const configuration = testEnv({ DEBUG: 'true' });
        for (const baseUrl of [
            'https://user:token@api.example/v1',
            'https://sk-username-only@api.example/v1',
            'https://api.example/v1?api_key=QUERY_SECRET',
        ]) {
            await saveSettings(new Dao(db), { openaiBaseUrl: baseUrl });
            const dao = new Dao(db);
            const id = `url-${Math.random().toString(36).slice(2)}`;
            await dao.insertEmail(
                {
                    messageId: 'url@test',
                    from: 'sender@example.com',
                    fromName: null,
                    to: 'inbox@example.com',
                    cc: null,
                    bcc: null,
                    subject: 'Url',
                    text: 'body',
                    html: null,
                    inReplyTo: null,
                    references: [],
                    date: new Date().toISOString(),
                    rawHeaders: null,
                    attachments: [],
                },
                { id, folder: 'inbox', size: 10 },
            );
            const stored = (await dao.getEmail(id))!;

            const rendered = await renderEmailDebugMode(stored, configuration, await loadSettings(configuration));

            expect(rendered.text).not.toContain('user:token');
            expect(rendered.text).not.toContain('sk-username-only');
            expect(rendered.text).not.toContain('QUERY_SECRET');
            expect(rendered.text).toContain('api.example');
        }
    });
});
