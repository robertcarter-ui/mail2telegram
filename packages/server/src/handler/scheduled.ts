import type { ScheduledController } from '@cloudflare/workers-types';
import type { Environment } from '../types';
import { Dao } from '../db';
import { purgeEmails } from '../db/cleanup';
import { loadSettings } from '../db/settings';

/**
 * Daily cron: permanently remove non-starred mail older than the auto cleanup
 * retention, together with its attachments and stored bodies. A retention of
 * zero or less keeps mail forever.
 */
export async function scheduledHandler(_event: ScheduledController, env: Environment): Promise<void> {
    const settings = await loadSettings(env);
    if (settings.autoCleanupDays <= 0) {
        return;
    }
    const cutoff = new Date(Date.now() - settings.autoCleanupDays * 86400_000).toISOString();
    const result = await purgeEmails(new Dao(env.DB), env.BUCKET, cutoff);
    if (result.emails > 0 || result.attachments > 0) {
        console.log(
            `[cron] cleanup removed ${result.emails} emails and ${result.attachments} attachments (older than ${cutoff})`,
        );
    }
    // The pass is capped, so a large backlog needs several daily runs.
    if (result.remaining > 0) {
        console.log(`[cron] cleanup ${result.remaining} emails still in range; the next run continues`);
    }
}
