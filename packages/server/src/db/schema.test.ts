import { readdirSync, readFileSync } from 'node:fs';
// The global `URL` belongs to the worker runtime typings; this Node-side test
// must use Node's own class so it matches `fileURLToPath`.
import { URL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { REQUIRED_SCHEMA } from './schema';

/**
 * `REQUIRED_SCHEMA` is what tells an operator their database is behind, so it
 * has to describe what the migrations actually produce. This applies every
 * migration to an in-memory database and checks the declaration against the
 * result, which fails on a typo, a forgotten table, or a new migration that is
 * not reflected here.
 */
function testRequiredSchemaMatchesMigrations(): void {
    const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const files = readdirSync(dir)
        .filter(name => name.endsWith('.sql'))
        .toSorted();

    const db = new DatabaseSync(':memory:');
    for (const file of files) {
        db.exec(readFileSync(`${dir}${file}`, 'utf8'));
    }

    const problems: string[] = [];
    for (const [table, requirement] of Object.entries(REQUIRED_SCHEMA)) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[];
        if (columns.length === 0) {
            problems.push(`${table}: does not exist after migrations`);
            continue;
        }
        const present = new Set(columns.map(column => column.name));
        const missing = requirement.columns.filter(column => !present.has(column));
        if (missing.length > 0) {
            problems.push(`${table}: REQUIRED_SCHEMA lists unknown column(s) ${missing.join(', ')}`);
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
                    `${table}: migration produces PK (${actual.join(', ')}), schema.ts declares (${expected.join(', ')})`,
                );
            }
        }
    }

    // A table the migrations create but the declaration omits would go unchecked.
    const declared = new Set(Object.keys(REQUIRED_SCHEMA));
    const created = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[])
        .map(row => row.name)
        .filter(name => !name.startsWith('sqlite_') && !name.startsWith('_cf_') && name !== 'd1_migrations');
    const undeclared = created.filter(name => !declared.has(name));
    if (undeclared.length > 0) {
        problems.push(`migrations create undeclared table(s): ${undeclared.join(', ')}`);
    }

    if (problems.length > 0) {
        throw new Error(`REQUIRED_SCHEMA is out of sync with migrations/: ${problems.join('; ')}`);
    }
    console.log(`schema ok: REQUIRED_SCHEMA matches migrations/ (${files.length} files, ${created.length} tables)`);
}

testRequiredSchemaMatchesMigrations();
