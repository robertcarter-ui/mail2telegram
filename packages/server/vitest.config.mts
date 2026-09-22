import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Worker-runtime tests (Miniflare). Only the load-bearing paths are covered:
 * D1 Dao semantics, the inbound-email delivery journal, and cleanup. The
 * pure-logic suites stay in `src/test.ts` and run under plain `tsx`.
 *
 * Bindings are declared here rather than read from `wrangler.jsonc`, which is
 * gitignored and absent in CI.
 */
export default defineConfig({
    plugins: [
        cloudflareTest(async () => {
            const migrations = await readD1Migrations(path.join(root, 'migrations'));
            return {
                miniflare: {
                    compatibilityDate: '2026-08-04',
                    d1Databases: { DB: 'test-db' },
                    r2Buckets: ['BUCKET'],
                    bindings: { TEST_MIGRATIONS: migrations },
                },
            };
        }),
    ],
    test: {
        setupFiles: [path.join(root, 'test/setup.ts')],
        include: ['test/**/*.pool.test.ts'],
    },
});
