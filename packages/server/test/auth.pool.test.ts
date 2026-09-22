import type { AuthLoginResponse, MeResponse } from '../src/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchHandler } from '../src/handler/fetch';
import { resetStorage, testEnv } from './helpers';

const SECRET = 'secret pass';

beforeEach(resetStorage);

function call(path: string, headers: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
    return fetchHandler(
        new Request(`https://worker.test${path}`, { ...init, headers }),
        testEnv({ WEB_PASSWORD: SECRET }),
    );
}

/** Posts the login endpoint; `password` must be JSON-serializable (any Unicode). */
function login(password: string, env = testEnv({ WEB_PASSWORD: SECRET })): Promise<Response> {
    return fetchHandler(
        new Request('https://worker.test/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password }),
        }),
        env,
    );
}

/**
 * Builds initData with a hash that genuinely validates against the test bot
 * token: `secret = HMAC('WebAppData', token)`, `hash = HMAC(secret, fields)`.
 * Only the `hash` field is verified, `signature` is optional.
 */
async function signedInitData(token: string, userId: number): Promise<string> {
    const encoder = new TextEncoder();
    const user = JSON.stringify({ id: userId, first_name: 'Tester' });
    const authDate = `${Math.floor(Date.now() / 1000)}`;
    const checkString = [`auth_date=${authDate}`, `user=${user}`].toSorted().join('\n');
    const webAppKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode('WebAppData'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const secret = await crypto.subtle.sign('HMAC', webAppKey, encoder.encode(token));
    const secretKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hash = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(checkString));
    const hex = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return new URLSearchParams({ auth_date: authDate, user, hash: hex }).toString();
}

/** Mirrors the server token algorithm, so expiry and tampering can be simulated. */
async function hmacHex(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return [...new Uint8Array(mac)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('web password auth', () => {
    it('advertises whether password access is enabled', async () => {
        const off = await fetchHandler(new Request('https://worker.test/api/auth'), testEnv());
        expect(off.status).toBe(200);
        expect(await off.json()).toEqual({ passwordEnabled: false });

        const on = await fetchHandler(new Request('https://worker.test/api/auth'), testEnv({ WEB_PASSWORD: SECRET }));
        expect(on.status).toBe(200);
        expect(await on.json()).toEqual({ passwordEnabled: true });
    });

    it('rejects API calls without credentials', async () => {
        const response = await call('/api/me', {});
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid authorization type');
    });

    it('rejects unknown authorization schemes', async () => {
        const response = await call('/api/me', { Authorization: 'bearer secret' });
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid authorization type');
    });

    it('rejects the raw password scheme: the header is token-only now', async () => {
        const response = await call('/api/me', { Authorization: `password ${SECRET}` });
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid authorization type');
    });

    it('rejects login when no password is configured', async () => {
        const response = await login('whatever', testEnv());
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Password access is disabled');
    });

    it('rejects login with a wrong password', async () => {
        const response = await login('wrong');
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid password');
    });

    it('rejects login with a malformed body', async () => {
        const response = await fetchHandler(
            new Request('https://worker.test/api/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: 'not-json',
            }),
            testEnv({ WEB_PASSWORD: SECRET }),
        );
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid request body');
    });

    it('issues a token for a correct password, spaces and non-ASCII included', async () => {
        // Regression for RF-004: the password travels in the JSON body, so the
        // worker accepts any Unicode value as `WEB_PASSWORD`.
        const password = '密碼 spaces 😀 included';
        const { token } = (await (
            await login(password, testEnv({ WEB_PASSWORD: password }))
        ).json()) as AuthLoginResponse;
        expect(token.split('.')).toHaveLength(3);
        const response = await fetchHandler(
            new Request('https://worker.test/api/me', { headers: { Authorization: `web ${token}` } }),
            testEnv({ WEB_PASSWORD: password }),
        );
        expect(response.status).toBe(200);
    });

    it('accepts API calls with the issued web token', async () => {
        const { token } = (await (await login(SECRET)).json()) as AuthLoginResponse;
        const response = await call('/api/me', { Authorization: `web ${token}` });
        expect(response.status).toBe(200);
        const body = (await response.json()) as MeResponse;
        expect(body.user).toEqual({ id: 0, first_name: 'Web' });
    });

    it('rejects a tampered web token', async () => {
        const { token } = (await (await login(SECRET)).json()) as AuthLoginResponse;
        const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
        const response = await call('/api/me', { Authorization: `web ${tampered}` });
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid web token');
    });

    it('rejects an expired web token', async () => {
        const expiry = Date.now() - 1000;
        const nonce = 'nonce';
        const mac = await hmacHex(SECRET, `${expiry}.${nonce}`);
        const response = await call('/api/me', { Authorization: `web ${expiry}.${nonce}.${mac}` });
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid web token');
    });

    it('accepts signed Mini App initData for an allowed user', async () => {
        const initData = await signedInitData('test-token', 1001);
        const response = await call('/api/me', { Authorization: `tma ${initData}` });
        expect(response.status).toBe(200);
        const body = (await response.json()) as MeResponse;
        expect(body.user.id).toBe(1001);
    });

    it('rejects signed Mini App initData from a chat outside TELEGRAM_ID', async () => {
        const initData = await signedInitData('test-token', 9999);
        const response = await call('/api/me', { Authorization: `tma ${initData}` });
        expect(response.status).toBe(403);
        expect(((await response.json()) as { error: string }).error).toBe('Permission denied');
    });

    it('rejects unsigned Mini App initData', async () => {
        const response = await call('/api/me', { Authorization: 'tma user=%7B%22id%22%3A1001%7D&hash=deadbeef' });
        expect(response.status).toBe(401);
    });

    // Regression: an empty TELEGRAM_TOKEN collapses the initData verification
    // key to the public constant HMAC('WebAppData', ''), so a forged signature
    // used to validate and the allowlist alone decided access.
    it('rejects Mini App initData when the bot token is empty or missing', async () => {
        for (const token of ['', undefined]) {
            const env = testEnv({ TELEGRAM_TOKEN: token as unknown as string, TELEGRAM_ID: '1001' });
            const response = await fetchHandler(
                new Request('https://worker.test/api/me', { headers: { Authorization: 'tma nonsense=1&hash=00' } }),
                env,
            );
            expect(response.status).toBe(401);
            expect(((await response.json()) as { error: string }).error).toBe('Invalid authorization type');
        }
    });

    it('rejects a forged initData that validates under the empty-token key', async () => {
        // Same HMAC scheme as `signedInitData`, but keyed by the public constant
        // an attacker can compute offline when the bot token is ''.
        const forged = await signedInitData('', 1001);
        const response = await fetchHandler(
            new Request('https://worker.test/api/me', { headers: { Authorization: `tma ${forged}` } }),
            testEnv({ TELEGRAM_TOKEN: '', TELEGRAM_ID: '1001' }),
        );
        expect(response.status).toBe(401);
    });
});
