import type { D1Database } from '@cloudflare/workers-types';
import type {
    AddressRecord,
    AddressType,
    AttachmentRecord,
    EmailRecord,
    Folder,
    MailStatusRecord,
    ParsedEmail,
} from '../types';

export interface EmailListOptions {
    folder?: Folder | 'all';
    limit?: number;
    offset?: number;
    query?: string;
    starred?: boolean;
    unread?: boolean;
}

export interface EmailListResult {
    emails: EmailRecord[];
    total: number;
}

const EMAIL_COLUMNS = `id, message_id, folder, subject, sender, sender_name, recipient, cc, bcc,
    date, is_read, is_starred, body_html, body_text, raw_key, size, in_reply_to,
    references_json, thread_id, raw_headers, has_attachments, created_at`;

/**
 * List queries carry a truncated plain-text preview instead of the full bodies:
 * a page of emails would otherwise drag megabytes of HTML, and R2-offloaded
 * bodies only exist as `bodies/…` pointers in D1 (their snippet is NULL).
 */
const EMAIL_LIST_COLUMNS = `id, message_id, folder, subject, sender, sender_name, recipient, cc, bcc,
    date, is_read, is_starred, size, in_reply_to,
    references_json, thread_id, has_attachments, created_at,
    CASE WHEN body_text LIKE 'bodies/%' OR body_text LIKE 'attachments/%' THEN NULL
         ELSE substr(body_text, 1, 220) END AS snippet`;

/** D1 caps bound parameters per query, so id lists are split into chunks. */
const ID_CHUNK_SIZE = 80;

/** Emails selected for removal, keeping the pointers needed to free R2 objects. */
export interface EmailCleanupTarget {
    id: string;
    message_id: string | null;
    size: number;
    raw_key: string | null;
    body_html: string | null;
    body_text: string | null;
}

export interface AttachmentKeyRow {
    id: string;
    email_id: string;
    r2_key: string;
}

function boolToInt(value: boolean | undefined): number | null {
    if (value === undefined) {
        return null;
    }
    return value ? 1 : 0;
}

/**
 * The real RFC 2822 Message-ID of a stored mail, read from the preserved raw
 * headers. `emails.message_id` holds the delivery identity (a digest), so
 * threading needs the original header instead.
 */
function originalMessageId(record: Pick<EmailRecord, 'raw_headers'>): string | null {
    if (!record.raw_headers) {
        return null;
    }
    try {
        const headers = JSON.parse(record.raw_headers) as Record<string, unknown>;
        const value = headers['Message-ID'] ?? headers['message-id'];
        const text = typeof value === 'string' ? value.trim() : '';
        return text || null;
    } catch {
        return null;
    }
}

function chunkIds(ids: string[]): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
        chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
    }
    return chunks;
}

function placeholders(count: number): string {
    return Array.from({ length: count }).fill('?').join(', ');
}

export class Dao {
    private readonly db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    // ---------------------------------------------------------------- emails

    async insertEmail(
        email: ParsedEmail,
        options: {
            id: string;
            folder: Folder;
            rawKey?: string | null;
            size: number;
            bodyHtmlKey?: string | null;
            bodyTextKey?: string | null;
            /** Attachments actually stored, which is zero when R2 is not configured. */
            storedAttachments?: number;
        },
    ): Promise<void> {
        const now = new Date().toISOString();
        const threadId = email.references[0] || email.inReplyTo || options.id;
        await this.db
            .prepare(
                `INSERT INTO emails (
                id, message_id, folder, subject, sender, sender_name, recipient, cc, bcc,
                date, is_read, is_starred, body_html, body_text, raw_key, size, in_reply_to,
                references_json, thread_id, raw_headers, has_attachments, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
                options.id,
                email.messageId,
                options.folder,
                email.subject,
                email.from,
                email.fromName,
                email.to,
                email.cc,
                email.bcc,
                email.date,
                options.bodyHtmlKey ?? email.html,
                options.bodyTextKey ?? email.text,
                options.rawKey ?? null,
                options.size,
                email.inReplyTo,
                JSON.stringify(email.references),
                threadId,
                email.rawHeaders,
                (options.storedAttachments ?? email.attachments.length) > 0 ? 1 : 0,
                now,
            )
            .run();
    }

    async insertAttachments(emailId: string, attachments: AttachmentRecord[]): Promise<void> {
        if (attachments.length === 0) {
            return;
        }
        const statements = attachments.map(att =>
            this.db
                .prepare(
                    `INSERT INTO attachments (id, email_id, filename, mimetype, size, content_id, disposition, r2_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                    att.id,
                    emailId,
                    att.filename,
                    att.mimetype,
                    att.size,
                    att.content_id,
                    att.disposition,
                    att.r2_key,
                ),
        );
        await this.db.batch(statements);
    }

    async getEmail(id: string): Promise<EmailRecord | null> {
        return (
            (await this.db.prepare(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE id = ?`).bind(id).first<EmailRecord>()) ??
            null
        );
    }

    async getEmailByMessageId(messageId: string): Promise<EmailRecord | null> {
        return (
            (await this.db
                .prepare(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE message_id = ? ORDER BY date DESC LIMIT 1`)
                .bind(messageId)
                .first<EmailRecord>()) ?? null
        );
    }

    async listEmails(options: EmailListOptions = {}): Promise<EmailListResult> {
        const conditions: string[] = [];
        const bindings: unknown[] = [];
        const folder = options.folder ?? 'inbox';
        if (folder !== 'all') {
            conditions.push('folder = ?');
            bindings.push(folder);
        }
        if (options.query) {
            // Search matches inline bodies only; bodies offloaded to R2 are not
            // present in D1 and are silently out of scope for `q`.
            conditions.push(
                `(subject LIKE ? ESCAPE '\\' OR sender LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')`,
            );
            const like = `%${options.query.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
            bindings.push(like, like, like);
        }
        if (options.starred !== undefined) {
            conditions.push('is_starred = ?');
            bindings.push(boolToInt(options.starred));
        }
        if (options.unread !== undefined) {
            conditions.push('is_read = ?');
            bindings.push(options.unread ? 0 : 1);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
        const offset = Math.max(options.offset ?? 0, 0);

        const countRow = await this.db
            .prepare(`SELECT COUNT(*) AS total FROM emails ${where}`)
            .bind(...bindings)
            .first<{ total: number }>();

        const rows = await this.db
            .prepare(`SELECT ${EMAIL_LIST_COLUMNS} FROM emails ${where} ORDER BY date DESC LIMIT ? OFFSET ?`)
            .bind(...bindings, limit, offset)
            .all<EmailRecord>();

        return {
            emails: rows.results ?? [],
            total: countRow?.total ?? 0,
        };
    }

    async updateEmailFlags(
        id: string,
        flags: { isRead?: boolean; isStarred?: boolean; folder?: Folder },
    ): Promise<void> {
        const sets: string[] = [];
        const bindings: unknown[] = [];
        if (flags.isRead !== undefined) {
            sets.push('is_read = ?');
            bindings.push(boolToInt(flags.isRead));
        }
        if (flags.isStarred !== undefined) {
            sets.push('is_starred = ?');
            bindings.push(boolToInt(flags.isStarred));
        }
        if (flags.folder !== undefined) {
            sets.push('folder = ?');
            bindings.push(flags.folder);
        }
        if (sets.length === 0) {
            return;
        }
        bindings.push(id);
        await this.db
            .prepare(`UPDATE emails SET ${sets.join(', ')} WHERE id = ?`)
            .bind(...bindings)
            .run();
    }

    async deleteEmailsByIds(ids: string[]): Promise<void> {
        for (const part of chunkIds(ids)) {
            await this.db
                .prepare(`DELETE FROM emails WHERE id IN (${placeholders(part.length)})`)
                .bind(...part)
                .run();
        }
    }

    // -------------------------------------------------------- cleanup scans

    /** Non-starred emails received before the cutoff (ISO time), or all of them when null. */
    async findCleanupTargets(before: string | null, limit: number): Promise<EmailCleanupTarget[]> {
        const sql = `SELECT id, message_id, size, raw_key, body_html, body_text FROM emails ${before ? 'WHERE created_at < ? AND is_starred = 0' : 'WHERE is_starred = 0'} ORDER BY created_at LIMIT ?`;
        const rows = before
            ? await this.db.prepare(sql).bind(before, limit).all<EmailCleanupTarget>()
            : await this.db.prepare(sql).bind(limit).all<EmailCleanupTarget>();
        return rows.results ?? [];
    }

    async countCleanupTargets(before: string | null): Promise<number> {
        const row = before
            ? await this.db
                  .prepare('SELECT COUNT(*) AS total FROM emails WHERE created_at < ? AND is_starred = 0')
                  .bind(before)
                  .first<{ total: number }>()
            : await this.db
                  .prepare('SELECT COUNT(*) AS total FROM emails WHERE is_starred = 0')
                  .first<{ total: number }>();
        return row?.total ?? 0;
    }

    /** Attachment rows belonging to non-starred emails inside the cleanup range. */
    async findAttachmentsBefore(before: string | null, limit: number): Promise<AttachmentKeyRow[]> {
        const sql = `SELECT a.id, a.email_id, a.r2_key FROM attachments a JOIN emails e ON e.id = a.email_id ${before ? 'WHERE e.created_at < ? AND e.is_starred = 0' : 'WHERE e.is_starred = 0'} LIMIT ?`;
        const rows = before
            ? await this.db.prepare(sql).bind(before, limit).all<AttachmentKeyRow>()
            : await this.db.prepare(sql).bind(limit).all<AttachmentKeyRow>();
        return rows.results ?? [];
    }

    async countAttachmentsBefore(before: string | null): Promise<number> {
        const sql = `SELECT COUNT(*) AS total FROM attachments a JOIN emails e ON e.id = a.email_id ${before ? 'WHERE e.created_at < ? AND e.is_starred = 0' : 'WHERE e.is_starred = 0'}`;
        const row = before
            ? await this.db.prepare(sql).bind(before).first<{ total: number }>()
            : await this.db.prepare(sql).first<{ total: number }>();
        return row?.total ?? 0;
    }

    async findAttachmentKeys(emailIds: string[]): Promise<Pick<AttachmentRecord, 'id' | 'r2_key'>[]> {
        const result: Pick<AttachmentRecord, 'id' | 'r2_key'>[] = [];
        for (const part of chunkIds(emailIds)) {
            const rows = await this.db
                .prepare(`SELECT id, r2_key FROM attachments WHERE email_id IN (${placeholders(part.length)})`)
                .bind(...part)
                .all<Pick<AttachmentRecord, 'id' | 'r2_key'>>();
            result.push(...(rows.results ?? []));
        }
        return result;
    }

    async deleteAttachmentsByIds(ids: string[]): Promise<void> {
        for (const part of chunkIds(ids)) {
            await this.db
                .prepare(`DELETE FROM attachments WHERE id IN (${placeholders(part.length)})`)
                .bind(...part)
                .run();
        }
    }

    /** Drop has_attachments on range emails whose attachments are all gone. */
    async clearAttachmentFlags(before: string | null): Promise<void> {
        const sql = `UPDATE emails SET has_attachments = 0
            WHERE has_attachments = 1
              AND NOT EXISTS (SELECT 1 FROM attachments WHERE email_id = emails.id)
            ${before ? 'AND created_at < ?' : ''}`;
        if (before) {
            await this.db.prepare(sql).bind(before).run();
        } else {
            await this.db.prepare(sql).run();
        }
    }

    async countUnread(folder: Folder | 'all'): Promise<number> {
        const row =
            folder === 'all'
                ? await this.db
                      .prepare('SELECT COUNT(*) AS total FROM emails WHERE is_read = 0')
                      .first<{ total: number }>()
                : await this.db
                      .prepare('SELECT COUNT(*) AS total FROM emails WHERE folder = ? AND is_read = 0')
                      .bind(folder)
                      .first<{ total: number }>();
        return row?.total ?? 0;
    }

    // ----------------------------------------------------------- attachments

    async getAttachments(emailId: string): Promise<AttachmentRecord[]> {
        const rows = await this.db
            .prepare('SELECT * FROM attachments WHERE email_id = ?')
            .bind(emailId)
            .all<AttachmentRecord>();
        return rows.results ?? [];
    }

    async getAttachment(id: string): Promise<AttachmentRecord | null> {
        return (
            (await this.db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<AttachmentRecord>()) ?? null
        );
    }

    // ------------------------------------------------------------- addresses

    async listAddresses(type?: AddressType): Promise<AddressRecord[]> {
        const rows = type
            ? await this.db
                  .prepare('SELECT * FROM addresses WHERE type = ? ORDER BY created_at DESC')
                  .bind(type)
                  .all<AddressRecord>()
            : await this.db.prepare('SELECT * FROM addresses ORDER BY created_at DESC').all<AddressRecord>();
        return rows.results ?? [];
    }

    async addAddress(address: string, type: AddressType, note?: string): Promise<AddressRecord> {
        const existing = await this.db
            .prepare('SELECT * FROM addresses WHERE address = ? AND type = ?')
            .bind(address, type)
            .first<AddressRecord>();
        if (existing) {
            return existing;
        }
        const record: AddressRecord = {
            id: crypto.randomUUID(),
            address,
            type,
            note: note ?? null,
            created_at: new Date().toISOString(),
        };
        await this.db
            .prepare('INSERT INTO addresses (id, address, type, note, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(record.id, record.address, record.type, record.note, record.created_at)
            .run();
        return record;
    }

    async removeAddress(id: string): Promise<void> {
        await this.db.prepare('DELETE FROM addresses WHERE id = ?').bind(id).run();
    }

    async removeAddressByValue(address: string, type: AddressType): Promise<void> {
        await this.db.prepare('DELETE FROM addresses WHERE address = ? AND type = ?').bind(address, type).run();
    }

    // -------------------------------------------------------------- settings

    async getSetting(key: string): Promise<string | null> {
        const row = await this.db
            .prepare('SELECT value FROM settings WHERE key = ?')
            .bind(key)
            .first<{ value: string }>();
        return row?.value ?? null;
    }

    async getSettings(): Promise<Record<string, string>> {
        const rows = await this.db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
        const result: Record<string, string> = {};
        for (const row of rows.results ?? []) {
            result[row.key] = row.value;
        }
        return result;
    }

    async setSetting(key: string, value: string): Promise<void> {
        await this.db
            .prepare(
                `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            )
            .bind(key, value, new Date().toISOString())
            .run();
    }

    /** Stores a setting only when the key is absent, leaving any value in place. */
    async setSettingIfAbsent(key: string, value: string): Promise<void> {
        await this.db
            .prepare(
                `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO NOTHING`,
            )
            .bind(key, value, new Date().toISOString())
            .run();
    }

    async setSettings(entries: Record<string, string>): Promise<void> {
        const now = new Date().toISOString();
        const statements = Object.entries(entries).map(([key, value]) =>
            this.db
                .prepare(
                    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                )
                .bind(key, value, now),
        );
        if (statements.length > 0) {
            await this.db.batch(statements);
        }
    }

    /**
     * Persists an outgoing mail in the Sent folder. Used both for replies sent
     * from a notification and for mails composed in the Mini App, so the folder
     * reflects everything the owner sent through Resend.
     */
    async recordSentEmail(params: {
        from: string;
        to: string;
        cc?: string | null;
        bcc?: string | null;
        subject: string;
        text: string;
        inReplyTo?: string | null;
    }): Promise<void> {
        const quotedId = params.inReplyTo || null;
        await this.insertEmail(
            {
                messageId: crypto.randomUUID(),
                from: params.from,
                fromName: null,
                to: params.to,
                cc: params.cc ?? null,
                bcc: params.bcc ?? null,
                subject: params.subject,
                text: params.text,
                html: null,
                inReplyTo: quotedId,
                references: quotedId ? [quotedId] : [],
                date: new Date().toISOString(),
                rawHeaders: null,
                attachments: [],
            },
            {
                id: crypto.randomUUID(),
                folder: 'sent',
                size: params.text.length,
            },
        );
    }

    /** Stores a reply sent through Resend so it shows up in the Sent folder. */
    async recordSentReply(original: EmailRecord, text: string): Promise<void> {
        const subject = original.subject.startsWith('Re: ') ? original.subject : `Re: ${original.subject}`;
        // `message_id` is the delivery identity, not a real Message-ID, so it
        // must not be quoted as one in `in_reply_to` / `references` (which feed
        // `thread_id`). The sender's actual header is preserved in
        // `raw_headers`, which is where the threading value comes from.
        await this.recordSentEmail({
            from: original.recipient,
            to: original.sender,
            subject,
            text,
            inReplyTo: originalMessageId(original),
        });
    }

    // ----------------------------------------------------- telegram mapping

    async saveTelegramMessage(telegramMessageId: number, chatId: number | string, emailId: string): Promise<void> {
        // Telegram message ids are per-chat, so the conflict target must include
        // the chat; a global id key would let one chat overwrite another's row.
        await this.db
            .prepare(
                `INSERT INTO telegram_messages (telegram_message_id, chat_id, email_id, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (chat_id, telegram_message_id) DO UPDATE SET email_id = excluded.email_id`,
            )
            .bind(`${telegramMessageId}`, `${chatId}`, emailId, new Date().toISOString())
            .run();
    }

    async getEmailIdByTelegramMessage(
        chatId: number | string,
        telegramMessageId: number | string,
    ): Promise<string | null> {
        // Telegram message ids are per-chat, so the chat must match the chat the
        // notification was actually sent to.
        const row = await this.db
            .prepare('SELECT email_id FROM telegram_messages WHERE telegram_message_id = ? AND chat_id = ?')
            .bind(`${telegramMessageId}`, `${chatId}`)
            .first<{ email_id: string }>();
        return row?.email_id ?? null;
    }

    /** Drop the chat mappings of emails that are being removed. */
    async deleteTelegramMessagesByEmailIds(emailIds: string[]): Promise<void> {
        for (const part of chunkIds(emailIds)) {
            await this.db
                .prepare(`DELETE FROM telegram_messages WHERE email_id IN (${placeholders(part.length)})`)
                .bind(...part)
                .run();
        }
    }

    // -------------------------------------------------------- /start marker

    /**
     * Claim the one-time /start setup prompt for a chat. The insert-only
     * conflict clause makes this atomic: the first caller writes the row and
     * gets `true`, later callers match the primary key, change nothing and get
     * `false`, so concurrent /start updates cannot both report "first".
     */
    async claimFirstStart(chatId: number | string): Promise<boolean> {
        const result = await this.db
            .prepare(
                `INSERT INTO telegram_starts (chat_id, created_at) VALUES (?, ?)
             ON CONFLICT (chat_id) DO NOTHING`,
            )
            .bind(`${chatId}`, new Date().toISOString())
            .run();
        return (result.meta.changes ?? 0) > 0;
    }

    // ----------------------------------------------------------- mail status

    async getMailStatus(messageId: string): Promise<MailStatusRecord | null> {
        return (
            (await this.db
                .prepare('SELECT * FROM mail_status WHERE message_id = ?')
                .bind(messageId)
                .first<MailStatusRecord>()) ?? null
        );
    }

    /**
     * Drop delivery-journal rows for purged mail. The key is the delivery
     * identity stored in `emails.message_id` (see `emailHandler`), so the journal
     * does not outlive the mail it tracks.
     */
    async deleteMailStatusByJournalKeys(keys: string[]): Promise<void> {
        if (keys.length === 0) {
            return;
        }
        for (const part of chunkIds(keys)) {
            await this.db
                .prepare(`DELETE FROM mail_status WHERE message_id IN (${placeholders(part.length)})`)
                .bind(...part)
                .run();
        }
    }

    async upsertMailStatus(
        messageId: string,
        status: { telegram?: boolean; forwards?: string[]; stored?: boolean },
    ): Promise<void> {
        const existing = await this.getMailStatus(messageId);
        const telegram = status.telegram ?? existing?.telegram === 1;
        const forwards = status.forwards ?? (existing ? (JSON.parse(existing.forwards) as string[]) : []);
        const stored = status.stored ?? existing?.stored === 1;
        await this.db
            .prepare(
                `INSERT INTO mail_status (message_id, telegram, forwards, stored, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (message_id) DO UPDATE SET telegram = excluded.telegram, forwards = excluded.forwards, stored = excluded.stored, updated_at = excluded.updated_at`,
            )
            .bind(messageId, telegram ? 1 : 0, JSON.stringify(forwards), stored ? 1 : 0, new Date().toISOString())
            .run();
    }

    /**
     * Records that this delivery is being handled and returns the journal entry,
     * without disturbing progress an earlier attempt already made. The insert is
     * atomic, so concurrent attempts converge on one row and each reads back the
     * same state.
     *
     * This claims the journal entry only. Two truly concurrent attempts can still
     * both reach the persist step, because `emails` has no unique constraint on
     * `message_id`; a redelivery that overlaps the original is rare and the cost
     * is a duplicate row rather than lost mail.
     */
    async claimMailStatus(messageId: string): Promise<MailStatusRecord> {
        await this.db
            .prepare(
                'INSERT INTO mail_status (message_id, telegram, forwards, stored, updated_at) VALUES (?, 0, ?, 0, ?) ON CONFLICT (message_id) DO NOTHING',
            )
            .bind(messageId, '[]', new Date().toISOString())
            .run();
        const row = await this.getMailStatus(messageId);
        if (!row) {
            throw new Error('Failed to claim mail status');
        }
        return row;
    }
}

export function loadArrayFromRaw(raw: string | null | undefined): string[] {
    if (!raw) {
        return [];
    }
    try {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
            return list.map(item => `${item}`).filter(Boolean);
        }
    } catch {
        // fall through
    }
    return [];
}
