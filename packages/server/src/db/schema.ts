import type { D1Database } from '@cloudflare/workers-types';

/**
 * The schema this worker's queries require, as the columns and keys it actually
 * touches.
 *
 * A ledger check (`d1_migrations`) is not enough on its own: the original
 * `telegram_messages` drift happened because `0001_init.sql` was edited *after*
 * being applied, so the ledger reported it as applied while the table kept its
 * old single-column primary key. Only inspecting the live structure catches
 * that.
 */
export interface TableRequirement {
    columns: string[];
    /** Columns that must form the primary key, in any order. */
    primaryKey?: string[];
}

export const REQUIRED_SCHEMA: Record<string, TableRequirement> = {
    emails: {
        columns: [
            'id',
            'message_id',
            'folder',
            'subject',
            'sender',
            'sender_name',
            'recipient',
            'cc',
            'bcc',
            'date',
            'is_read',
            'is_starred',
            'body_html',
            'body_text',
            'raw_key',
            'size',
            'in_reply_to',
            'references_json',
            'thread_id',
            'raw_headers',
            'has_attachments',
            'created_at',
        ],
    },
    attachments: {
        columns: ['id', 'email_id', 'filename', 'mimetype', 'size', 'content_id', 'disposition', 'r2_key'],
    },
    addresses: { columns: ['id', 'address', 'type', 'note', 'created_at'] },
    settings: { columns: ['key', 'value', 'updated_at'] },
    // `stored` comes from 0002 and the composite key from 0003; a database with
    // the pre-split single-column key fails `saveTelegramMessage` on every push.
    mail_status: { columns: ['message_id', 'telegram', 'forwards', 'updated_at', 'stored'] },
    telegram_messages: {
        columns: ['telegram_message_id', 'chat_id', 'email_id', 'created_at'],
        primaryKey: ['chat_id', 'telegram_message_id'],
    },
    telegram_starts: { columns: ['chat_id', 'created_at'] },
};

/**
 * What a live database is missing, as human-readable problems.
 *
 * The probes go out as one `batch`, so a cold isolate pays a single round trip
 * rather than one per table — the check runs on the delivery path, where each
 * round trip is real CPU on top of parsing the mail.
 */
export async function findSchemaProblems(db: D1Database): Promise<string[]> {
    const tables = Object.keys(REQUIRED_SCHEMA);
    let results: { results?: { name: string; pk: number }[] }[];
    try {
        results = await db.batch(tables.map(table => db.prepare(`PRAGMA table_info(${table})`)));
    } catch {
        return ['schema probe failed'];
    }

    const problems: string[] = [];
    tables.forEach((table, index) => {
        const requirement = REQUIRED_SCHEMA[table];
        const columns = (results[index]?.results ?? []) as { name: string; pk: number }[];
        if (columns.length === 0) {
            problems.push(`table ${table}: missing`);
            return;
        }
        const present = new Set(columns.map(column => column.name));
        const missing = requirement.columns.filter(column => !present.has(column));
        if (missing.length > 0) {
            problems.push(`table ${table}: missing column(s) ${missing.join(', ')}`);
        }
        if (requirement.primaryKey) {
            const actual = columns
                .filter(column => column.pk > 0)
                .toSorted((a, b) => a.pk - b.pk)
                .map(column => column.name);
            const expected = [...requirement.primaryKey];
            const same = actual.length === expected.length && expected.every(column => actual.includes(column));
            if (!same) {
                problems.push(
                    `table ${table}: primary key is (${actual.join(', ') || 'none'}), expected (${expected.join(', ')})`,
                );
            }
        }
    });
    return problems;
}

// One check and one warning per isolate: the schema cannot change while the
// isolate serves requests, and the probes are only worth paying for once.
const checks = new WeakMap<D1Database, Promise<string[]>>();
const warned = new WeakSet<D1Database>();

/**
 * Logs once per isolate when the database does not match the schema the code
 * requires.
 *
 * Diagnostic only — it does not throw and does not change delivery behaviour.
 * Skipping the work would lose the message, whereas letting the delivery fail
 * means Email Routing retries it and the retry succeeds once the migration is
 * applied.
 */
export async function warnIfSchemaOutdated(db: D1Database): Promise<void> {
    let check = checks.get(db);
    if (!check) {
        check = findSchemaProblems(db);
        checks.set(db, check);
    }
    const problems = await check;
    if (problems.length === 0 || warned.has(db)) {
        return;
    }
    warned.add(db);
    console.error(
        '[db] schema.outdated',
        problems.join('; '),
        '— apply migrations with `pnpm db:migrate:remote` (or `pnpm deploy`, which migrates first)',
    );
}
