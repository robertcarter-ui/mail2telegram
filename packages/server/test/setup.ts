import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { D1Database } from '@cloudflare/workers-types';
import { applyD1Migrations, env } from 'cloudflare:test';

const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

// Each test runs against isolated storage, so the schema is (re)applied for the
// current isolate before the first test touches D1. Vitest setup files support
// top-level await; there is no other hook that runs early enough.
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
