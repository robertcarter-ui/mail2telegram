/**
 * Injects deployment ids into a gitignored `wrangler.deploy.jsonc`.
 *
 * Reads the tracked, public `wrangler.jsonc` for structure, which holds
 * provisionable placeholders instead of real resource ids. Each resource id
 * resolves in order:
 *   1. the DEPLOY_* environment variable (how CI and manual deploys inject ids),
 *   2. the id already in `wrangler.deploy.jsonc` (a hand-written or
 *      button-provisioned deploy config is left usable),
 *   3. the binding in the tracked config.
 * Taking structure from the tracked file and ids from the deploy file keeps a
 * hand-written config working while still picking up new keys.
 *
 * The provisionable default means "not configured": an empty D1 id fails the
 * build, and a missing R2 binding is dropped.
 *
 * Required:
 *   DEPLOY_D1_DATABASE_ID (or a real d1_databases[0].database_id in
 *   wrangler.deploy.jsonc / wrangler.jsonc)
 * Optional (defaults below):
 *   DEPLOY_D1_DATABASE_NAME   (default: mail2telegram)
 *   DEPLOY_R2_BUCKET_NAME     (falls back to the deploy config, then the
 *                              tracked config; unset everywhere disables
 *                              attachments)
 *   DEPLOY_R2_PREVIEW_BUCKET_NAME
 *
 * Runtime variables (TELEGRAM_ID, TELEGRAM_TOKEN; DOMAIN is optional) are not
 * handled here; set them in the dashboard under Settings → Variables and
 * Secrets.
 *
 * Usage: node scripts/build-config.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = `${root}wrangler.jsonc`;
const targetPath = `${root}wrangler.deploy.jsonc`;

function fail(message) {
    console.error(`[build-config] ${message}`);
    process.exit(1);
}

function stripJsonComments(input) {
    let output = '';
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = 0; i < input.length; i += 1) {
        const char = input[i];
        const next = input[i + 1];
        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
                output += char;
            }
            continue;
        }
        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }
        if (!inString && char === '/' && next === '/') {
            inLineComment = true;
            i += 1;
            continue;
        }
        if (!inString && char === '/' && next === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }
        // Inside a string an escaped quote (`\\"`) must not toggle the string,
        // so copy the escape sequence verbatim.
        if (inString && char === '\\') {
            output += char + (next ?? '');
            i += 1;
            continue;
        }
        if (char === '"' && input[i - 1] !== '\\') {
            inString = !inString;
        }
        output += char;
    }
    return output;
}

let config;
try {
    config = JSON.parse(stripJsonComments(readFileSync(sourcePath, 'utf8')));
} catch (error) {
    fail(`failed to read ${sourcePath}: ${error.message}`);
}

/** The existing deploy config, when one is present and readable. */
function readExistingDeployConfig() {
    if (!existsSync(targetPath)) {
        return null;
    }
    try {
        return JSON.parse(stripJsonComments(readFileSync(targetPath, 'utf8')));
    } catch (error) {
        console.error(`[build-config] ignoring unreadable ${targetPath}: ${error.message}`);
        return null;
    }
}

// `local` (and an empty value) marks a provisionable placeholder binding.
function isPlaceholder(value) {
    return !value || value === 'local';
}

const existing = readExistingDeployConfig();

const explicitDatabaseId = process.env.DEPLOY_D1_DATABASE_ID;
const existingDatabaseId = existing?.d1_databases?.[0]?.database_id;
const configDatabaseId = config.d1_databases?.[0]?.database_id;
// An id already in the deploy config is a real one this deployment was set up
// with, so it outranks the tracked placeholder. An explicit DEPLOY_* wins.
const databaseId =
    explicitDatabaseId || (isPlaceholder(existingDatabaseId) ? undefined : existingDatabaseId) || configDatabaseId;
if (isPlaceholder(databaseId)) {
    // This message is read from a CI log, so name the fix and show which
    // DEPLOY_* variables did arrive (names only) to point at the missing one.
    const seen = Object.keys(process.env)
        .filter(key => key.startsWith('DEPLOY_'))
        .toSorted();
    fail(
        'DEPLOY_D1_DATABASE_ID is required (or set a real d1_databases[0].database_id in wrangler.deploy.jsonc).\n' +
            '  On Cloudflare Workers Builds, add it under Settings -> Build -> Build variables and secrets.\n' +
            '  GitHub repository variables are a different store and are not visible here.\n' +
            (seen.length > 0
                ? `  DEPLOY_* variables currently set: ${seen.join(', ')}`
                : '  No DEPLOY_* variables are set in this environment.'),
    );
}

const databaseName =
    process.env.DEPLOY_D1_DATABASE_NAME ||
    existing?.d1_databases?.[0]?.database_name ||
    config.d1_databases?.[0]?.database_name ||
    'mail2telegram';
// Rebuilt from scratch, so carry migrations_dir across: it lives in the server
// package, and dropping it would send `d1 migrations apply` looking in the
// repo-root `migrations/` directory, which no longer exists.
const migrationsDir = config.d1_databases?.[0]?.migrations_dir ?? existing?.d1_databases?.[0]?.migrations_dir;
config.d1_databases = [
    {
        binding: 'DB',
        database_name: databaseName,
        database_id: databaseId,
        ...(migrationsDir ? { migrations_dir: migrationsDir } : {}),
    },
];

const existingBucket = existing?.r2_buckets?.find(item => item.binding === 'BUCKET');
const bucketName =
    process.env.DEPLOY_R2_BUCKET_NAME ||
    (isPlaceholder(existingBucket?.bucket_name) ? undefined : existingBucket?.bucket_name) ||
    config.r2_buckets?.find(item => item.binding === 'BUCKET')?.bucket_name;
if (!isPlaceholder(bucketName)) {
    const bucket = {
        binding: 'BUCKET',
        bucket_name: bucketName,
    };
    const previewBucket = process.env.DEPLOY_R2_PREVIEW_BUCKET_NAME || existingBucket?.preview_bucket_name;
    if (previewBucket) {
        bucket.preview_bucket_name = previewBucket;
    }
    config.r2_buckets = [bucket];
} else {
    delete config.r2_buckets;
}

writeFileSync(targetPath, `${JSON.stringify(config, null, 4)}\n`);
console.log(
    `[build-config] wrote ${targetPath} from ${sourcePath} (d1=${databaseName}, r2=${!isPlaceholder(bucketName) ? bucketName : 'disabled'})`,
);
