import type { Environment } from '../src/types';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dao } from '../src/db';
import { emailHandler } from '../src/handler/email';
import { testAddress } from '../src/mail/check';
import { buildEmail, mockTelegramFetch, resetStorage, testEnv } from './helpers';

const db = (env as unknown as { DB: Environment['DB'] }).DB;

let telegram: ReturnType<typeof mockTelegramFetch>;
beforeEach(async () => {
    await resetStorage();
    telegram = mockTelegramFetch();
});
afterEach(() => telegram.restore());

async function rowCount(): Promise<number> {
    const row = await db.prepare('SELECT COUNT(*) AS total FROM emails').first<{ total: number }>();
    return row?.total ?? 0;
}

async function deliver(built: ReturnType<typeof buildEmail>, configuration: Environment = testEnv()): Promise<void> {
    const ctx = createExecutionContext();
    await emailHandler(built.message, configuration, ctx);
    await waitOnExecutionContext(ctx);
}

const ATTACHMENT_MIME = [
    '--sep',
    'Content-Type: text/plain',
    '',
    'body',
    '--sep',
    'Content-Type: application/octet-stream; name="file.txt"',
    'Content-Disposition: attachment; filename="file.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    'aGVsbG8=',
    '--sep--',
].join('\r\n');

const MIME_HEADERS = {
    'MIME-Version': '1.0',
    'Content-Type': 'multipart/mixed; boundary="sep"',
};

/** Multipart mail carrying one attachment of `bytes` decoded size. */
function bigAttachmentMime(bytes: number): string {
    const base64 = Buffer.alloc(bytes, 0x41).toString('base64');
    return [
        '--sep',
        'Content-Type: text/plain',
        '',
        'hello body',
        '--sep',
        'Content-Type: application/octet-stream; name="big.bin"',
        'Content-Disposition: attachment; filename="big.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        base64.match(/.{1,76}/g)!.join('\r\n'),
        '--sep--',
        '',
    ].join('\r\n');
}

describe('delivery journal identity', () => {
    it('collapses a redelivery of the same Message-ID into one row and one push', async () => {
        await deliver(buildEmail({ messageId: '<same@test>', body: 'hello' }));
        await deliver(buildEmail({ messageId: '<same@test>', body: 'hello' }));

        expect(await rowCount()).toBe(1);
        expect(telegram.calls).toBe(1);
    });

    it('stores distinct messages that reuse one Message-ID with a different size', async () => {
        await deliver(buildEmail({ messageId: '<reused@test>', body: 'short' }));
        await deliver(buildEmail({ messageId: '<reused@test>', body: 'a much longer body' }));

        expect(await rowCount()).toBe(2);
        expect(telegram.calls).toBe(2);
    });

    // Regression: identity used to be `Message-ID|rawSize`, so a different sender
    // reusing the same header and size silently dropped the second message from
    // storage and Telegram. The two senders are the same length on purpose, so the
    // sizes match and only the envelope sender distinguishes the deliveries.
    it('keeps equal-length mail from two senders that happens to share a Message-ID', async () => {
        await deliver(buildEmail({ messageId: '<collide@test>', from: 'alice@example.com', body: 'same body' }));
        await deliver(buildEmail({ messageId: '<collide@test>', from: 'bobby@example.com', body: 'same body' }));

        expect(await rowCount()).toBe(2);
        expect(telegram.calls).toBe(2);
    });

    // Documented trade-off of keying on the header: one sender reusing its own
    // Message-ID for two same-sized messages is indistinguishable from a
    // redelivery, so the second is treated as one. Cross-sender collision (the
    // original bug) stays impossible, and size differences are still kept.
    it('treats a same-sender, same-size, same-Message-ID repeat as a redelivery', async () => {
        await deliver(buildEmail({ messageId: '<self@test>', body: 'aaaa' }));
        await deliver(buildEmail({ messageId: '<self@test>', body: 'bbbb' }));

        expect(await rowCount()).toBe(1);
        expect(telegram.calls).toBe(1);
    });

    // Regression for the no-Message-ID path: a random fallback id made every
    // redelivery a brand-new message.
    it('keys follow-up mail by the resolved identity, not a fresh random id', async () => {
        await deliver(buildEmail({ body: 'no header here' }));
        // Same bytes delivered again: the content-hash identity makes the second
        // delivery resolve to the same journal entry and stored row.
        await deliver(buildEmail({ body: 'no header here' }));

        expect(await rowCount()).toBe(1);
        expect(telegram.calls).toBe(1);
    });

    // The fallback must stay content-sensitive, or two different header-less
    // mails of the same size from one sender would swallow each other.
    it('keeps two different header-less mails of the same size', async () => {
        await deliver(buildEmail({ body: 'aaaa' }));
        await deliver(buildEmail({ body: 'bbbb' }));

        expect(await rowCount()).toBe(2);
        expect(telegram.calls).toBe(2);
    });

    // The point of the per-step journal: a retry after a crash resumes from the
    // last completed step instead of redoing the delivery.
    it('resumes a delivery whose row was stored but not yet notified', async () => {
        const built = buildEmail({ messageId: '<resume@test>', body: 'hello' });
        await deliver(built);
        expect(await rowCount()).toBe(1);
        expect(telegram.calls).toBe(1);

        // The crash window between persist and notify: row stored, telegram unset.
        await db.prepare('UPDATE mail_status SET telegram = 0').run();

        await deliver(buildEmail({ messageId: '<resume@test>', body: 'hello' }));

        // No second row, and the missing push is delivered.
        expect(await rowCount()).toBe(1);
        expect(telegram.calls).toBe(2);
    });

    // A fully completed delivery must be a no-op on redelivery.
    it('does nothing when the delivery is already stored and notified', async () => {
        await deliver(buildEmail({ messageId: '<done@test>', body: 'hello' }));
        expect(telegram.calls).toBe(1);

        await deliver(buildEmail({ messageId: '<done@test>', body: 'hello' }));

        expect(await rowCount()).toBe(1);
        expect(telegram.calls).toBe(1);
    });

    // The journal can outlive its row (a cleanup that removed the mail but not its
    // entry). The retry must store the mail again rather than fail forever.
    it('stores the mail again when the journal outlived its row', async () => {
        await deliver(buildEmail({ messageId: '<orphan@test>', body: 'hello' }));
        await db.prepare('DELETE FROM emails').run();
        await db.prepare('UPDATE mail_status SET stored = 1, telegram = 0').run();

        await deliver(buildEmail({ messageId: '<orphan@test>', body: 'hello' }));

        expect(await rowCount()).toBe(1);
    });

    it('reports stored state in the journal after a successful delivery', async () => {
        await deliver(buildEmail({ messageId: '<stored-flag@test>', body: 'hello' }));

        const row = await db
            .prepare('SELECT telegram, stored FROM mail_status')
            .first<{ telegram: number; stored: number }>();
        expect(row?.stored).toBe(1);
        expect(row?.telegram).toBe(1);
    });

    it('reclassifies an existing row when a redelivery is no longer blocked', async () => {
        // A block policy without `reject`/`telegram` still persists the mail, as
        // spam. Simulate the crash window so the redelivery reuses the row.
        const blocked = testEnv({ BLOCK_POLICY: 'forward' });
        await new Dao(db).addAddress('sender@example.com', 'block');
        await deliver(buildEmail({ messageId: '<blocked@test>', body: 'same bytes' }), blocked);

        const before = await db.prepare('SELECT folder FROM emails').first<{ folder: string }>();
        expect(before?.folder).toBe('spam');

        await db.prepare('DELETE FROM mail_status').run();
        await new Dao(db).removeAddressByValue('sender@example.com', 'block');
        await deliver(buildEmail({ messageId: '<blocked@test>', body: 'same bytes' }));

        const after = await db.prepare('SELECT folder FROM emails').first<{ folder: string }>();
        expect(after?.folder).toBe('inbox');
        expect(await rowCount()).toBe(1);
    });
});

describe('attachment size limit', () => {
    it('skips an oversized attachment when the limit is positive', async () => {
        const built = buildEmail({
            messageId: '<att-skip@test>',
            extraHeaders: MIME_HEADERS,
            rawBody: ATTACHMENT_MIME,
        });
        await deliver(built, testEnv({ ATTACHMENT_MAX_SIZE: '1' }));
        expect(await attachmentCount()).toBe(0);
    });

    it('treats a limit of zero as unlimited', async () => {
        const built = buildEmail({
            messageId: '<att-zero@test>',
            extraHeaders: MIME_HEADERS,
            rawBody: ATTACHMENT_MIME,
        });
        await deliver(built, testEnv({ ATTACHMENT_MAX_SIZE: '0' }));
        expect(await attachmentCount()).toBe(1);
    });

    // Regression: a mail larger than maxEmailSize gets its stream truncated, and
    // attachments follow the body in the MIME parts, so the parser produced a
    // fragment that was stored as if it were the whole file.
    it('does not store a fragment of an attachment from a truncated mail', async () => {
        const built = buildEmail({
            messageId: '<att-trunc@test>',
            extraHeaders: MIME_HEADERS,
            rawBody: bigAttachmentMime(2 * 1024 * 1024),
        });
        // Default maxEmailSize is 512KB, so the 2MB body is cut mid-attachment.
        await deliver(built);

        expect(await attachmentCount()).toBe(0);
        const row = await db.prepare('SELECT has_attachments FROM emails').first<{ has_attachments: number }>();
        expect(row?.has_attachments).toBe(0);
    });

    it('stores the whole attachment when the mail fits under the limit', async () => {
        const built = buildEmail({
            messageId: '<att-fit@test>',
            extraHeaders: MIME_HEADERS,
            rawBody: bigAttachmentMime(256 * 1024),
        });
        await deliver(built, testEnv({ MAX_EMAIL_SIZE: `${4 * 1024 * 1024}` }));

        expect(await attachmentCount()).toBe(1);
        const row = await db.prepare('SELECT size FROM attachments').first<{ size: number }>();
        expect(row?.size).toBe(256 * 1024);
    });
});

describe('block policy', () => {
    it('rejects without storing when the policy is reject', async () => {
        await new Dao(db).addAddress('sender@example.com', 'block');
        const built = buildEmail({ body: 'blocked, no header' });
        await deliver(built, testEnv({ BLOCK_POLICY: 'reject' }));

        expect(built.rejected).toEqual(['Blocked']);
        expect(await rowCount()).toBe(0);
        expect(telegram.calls).toBe(0);
    });

    // The identity change reads `message.raw` before the forward loop, so
    // forwarding must still run and still be deduplicated across redeliveries.
    it('still forwards to the configured list, once per address', async () => {
        const configuration = testEnv({ FORWARD_LIST: 'backup@example.com' });

        const first = buildEmail({ messageId: '<fwd@test>', body: 'hello' });
        await deliver(first, configuration);
        expect(first.forwarded).toEqual(['backup@example.com']);

        // Same bytes again: the journal suppresses the repeat forward.
        const second = buildEmail({ messageId: '<fwd@test>', body: 'hello' });
        await deliver(second, configuration);
        expect(second.forwarded).toEqual([]);
    });

    // Regression for the ReDoS guard: the deployment variables never pass
    // through the settings API, so an unsafe pattern there used to reach the
    // matcher on every delivery regardless of the write-time check. The pattern
    // below DOES match the test sender (`sender@example.com`) if the guard is
    // removed, so the assertion discriminates the fixed code from the broken one.
    it('ignores an unsafe pattern supplied through BLOCK_LIST', async () => {
        // The raw pattern does match the sender, so removing the guard would
        // make it block; the guard dropping it is what keeps the mail accepted.
        expect(testAddress('sender@example.com', '^(s+)+ender@.*')).toBe(true);

        const built = buildEmail({ body: 'body' });
        await deliver(built, testEnv({ BLOCK_LIST: '["^(s+)+ender@.*"]', BLOCK_POLICY: 'reject' }));

        expect(built.rejected).toEqual([]);
        expect(await rowCount()).toBe(1);
    });

    // Regression: only the envelope sender was matched, so a rule written
    // against the visible From address silently did nothing. Mail through a
    // provider (SES and friends) puts a bounce address in the envelope.
    it('blocks on the From header when the envelope sender differs', async () => {
        const dao = new Dao(db);
        await dao.addAddress('real.sender@example.com', 'block');
        const built = buildEmail({
            messageId: '<envelope-differs@test>',
            from: 'bounce@send.provider.test',
            extraHeaders: { From: 'Real Sender <real.sender@example.com>' },
            body: 'body',
        });
        await deliver(built, testEnv({ BLOCK_POLICY: 'telegram' }));

        const row = await db.prepare('SELECT folder FROM emails').first<{ folder: string }>();
        expect(row?.folder).toBe('spam');
    });

    it('still blocks on the envelope sender', async () => {
        const dao = new Dao(db);
        await dao.addAddress('bounce@send.provider.test', 'block');
        const built = buildEmail({
            messageId: '<envelope-match@test>',
            from: 'bounce@send.provider.test',
            body: 'body',
        });
        await deliver(built, testEnv({ BLOCK_POLICY: 'telegram' }));

        const row = await db.prepare('SELECT folder FROM emails').first<{ folder: string }>();
        expect(row?.folder).toBe('spam');
    });

    it('loads an equivalent safe pattern from BLOCK_LIST', async () => {
        // Control for the test above: a safe pattern from the same source does
        // reach the matcher and blocks the delivery.
        const built = buildEmail({ body: 'body' });
        await deliver(built, testEnv({ BLOCK_LIST: '["^sender@"]', BLOCK_POLICY: 'reject' }));

        expect(built.rejected).toEqual(['Blocked']);
        expect(await rowCount()).toBe(0);
    });
});

async function attachmentCount(): Promise<number> {
    const row = await db.prepare('SELECT COUNT(*) AS total FROM attachments').first<{ total: number }>();
    return row?.total ?? 0;
}
