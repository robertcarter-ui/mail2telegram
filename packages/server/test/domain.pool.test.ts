import type { Environment } from '../src/types';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS, loadDiscoveredDomain, loadWebhookSecret } from '../src/db/settings';
import { emailHandler } from '../src/handler/email';
import { fetchHandler } from '../src/handler/fetch';
import { buildEmail, mockTelegramFetch, resetStorage, testEnv } from './helpers';

const db = (env as unknown as { DB: Environment['DB'] }).DB;

let telegram: ReturnType<typeof mockTelegramFetch>;
beforeEach(async () => {
    await resetStorage();
    telegram = mockTelegramFetch();
});
afterEach(() => telegram.restore());

describe('domain discovery', () => {
    it('remembers the /init request host when DOMAIN is not configured', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        const response = await fetchHandler(new Request('https://discovered.example/init'), configuration);
        expect(response.status).toBe(200);

        expect(await loadDiscoveredDomain(configuration)).toBe('discovered.example');
    });

    it('keeps the DOMAIN variable instead of storing the request host', async () => {
        const configuration = testEnv({ DOMAIN: 'configured.example' });
        await fetchHandler(new Request('https://other.example/init'), configuration);

        expect(await loadDiscoveredDomain(configuration)).toBeNull();
    });

    it('delivers notifications with the remembered host when DOMAIN is unset', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        await fetchHandler(new Request('https://discovered.example/init'), configuration);

        const ctx = createExecutionContext();
        await emailHandler(buildEmail({ messageId: '<link@test>' }).message, configuration, ctx);
        await waitOnExecutionContext(ctx);

        // Three of the calls are the /init registrations; the push is the one
        // carrying the Mini App link.
        expect(telegram.bodies.some(body => body.includes('https://discovered.example/#/mail/'))).toBe(true);
    });

    it('omits the Mini App button when no host is known at all', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        const ctx = createExecutionContext();
        await emailHandler(buildEmail({ messageId: '<nolink@test>' }).message, configuration, ctx);
        await waitOnExecutionContext(ctx);

        // The notification is still delivered, just without a web_app button.
        expect(telegram.calls).toBe(1);
        expect(telegram.bodies[0]).not.toContain('web_app');
    });

    it('keeps the remembered host stable across repeated /init calls', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        await fetchHandler(new Request('https://discovered.example/init'), configuration);
        await fetchHandler(new Request('https://discovered.example/init'), configuration);

        const row = await db
            .prepare('SELECT value FROM settings WHERE key = ?')
            .bind(SETTING_KEYS.workerDomain)
            .first<{ value: string }>();
        expect(row?.value).toBe('discovered.example');
    });

    // Regression: /init is public and used to accept the request Host on every
    // call, so an anonymous caller could repoint webhook and Mini App links at
    // an arbitrary origin after the real host had been discovered.
    it('does not let an anonymous /init repoint an already discovered host', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        await fetchHandler(new Request('https://real.example/init'), configuration);
        await fetchHandler(new Request('https://attacker.example/init'), configuration);

        expect(await loadDiscoveredDomain(configuration)).toBe('real.example');
    });

    it('does not register an attacker host in the webhook url', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        await fetchHandler(new Request('https://real.example/init'), configuration);
        telegram.bodies.length = 0;
        await fetchHandler(new Request('https://attacker.example/init'), configuration);

        expect(telegram.bodies.some(body => body.includes('attacker.example'))).toBe(false);
        expect(telegram.bodies.some(body => body.includes('https://real.example/'))).toBe(true);
    });

    // The owner must still be able to move the deployment to a new hostname
    // (e.g. workers.dev -> custom domain): that rebind is authenticated.
    it('lets an authenticated owner move the remembered host', async () => {
        const configuration = testEnv({ DOMAIN: '', WEB_PASSWORD: 'pw' });
        await fetchHandler(new Request('https://old.example/init'), configuration);

        const login = await fetchHandler(
            new Request('https://old.example/api/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password: 'pw' }),
            }),
            configuration,
        );
        const { token } = (await login.json()) as { token: string };

        telegram.bodies.length = 0;
        await fetchHandler(
            new Request('https://new.example/init', { headers: { Authorization: `web ${token}` } }),
            configuration,
        );

        expect(await loadDiscoveredDomain(configuration)).toBe('new.example');
        expect(telegram.bodies.some(body => body.includes('https://new.example/'))).toBe(true);
    });

    it('registers a random secret_token and verifies it on updates', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        await fetchHandler(new Request('https://real.example/init'), configuration);

        const secret = await loadWebhookSecret(configuration);
        expect(secret).toBeTruthy();
        expect(telegram.bodies.some(body => body.includes(String(secret)))).toBe(true);

        const update = JSON.stringify({ update_id: 1 });
        const post = (headers: Record<string, string>) =>
            fetchHandler(
                new Request('https://real.example/telegram/test-token/webhook', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...headers },
                    body: update,
                }),
                configuration,
            );

        expect((await post({})).status).toBe(403);
        expect((await post({ 'X-Telegram-Bot-Api-Secret-Token': 'wrong' })).status).toBe(403);
        expect((await post({ 'X-Telegram-Bot-Api-Secret-Token': String(secret) })).status).toBe(200);
    });

    it('reuses the stored secret on a later /init', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        await fetchHandler(new Request('https://real.example/init'), configuration);
        const first = await loadWebhookSecret(configuration);

        await fetchHandler(new Request('https://real.example/init'), configuration);

        expect(await loadWebhookSecret(configuration)).toBe(first);
    });

    // Regression: the secret used to be persisted before Telegram accepted the
    // registration, so a failed setWebhook left D1 holding a value Telegram
    // never signed with — rejecting every update with 403.
    it('does not persist a secret that Telegram rejected', async () => {
        const configuration = testEnv({ DOMAIN: '' });
        telegram.rejectNext();
        await fetchHandler(new Request('https://real.example/init'), configuration);

        expect(await loadWebhookSecret(configuration)).toBeNull();
    });
});
