import { Cron } from 'croner';
import { getDb } from '../db';
import { feedRuns, feedSchedules } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { Env } from '../types';
import { startBulkSync } from '../services/sync';

// Must match the product-sync entry in wrangler.toml [triggers].crons.
// 03:00 and 15:00 UTC (08:30 / 20:30 IST) — the evening run lands ahead of
// the 21:00 / 22:00 IST feed schedules so feeds go out with fresh data.
export const PRODUCT_SYNC_CRON = '0 3,15 * * *';

export const schedulerHandler: ExportedHandlerScheduledHandler<Env> = async (
  event,
  env,
  _ctx,
) => {
  if (event.cron === PRODUCT_SYNC_CRON) {
    await runProductSync(env);
    return;
  }

  const db = getDb(env);
  const now = new Date().toISOString();

  const dueSchedules = await db.query.feedSchedules.findMany({
    where: (s, { and, eq: eq2, lte }) =>
      and(eq2(s.isActive, true), lte(s.nextRunAt, now)),
    with: {
      feed: {
        columns: { id: true, name: true, storeId: true, status: true },
      },
    },
  });

  if (!dueSchedules.length) return;

  console.log(`Scheduler: found ${dueSchedules.length} due feed(s)`);

  for (const schedule of dueSchedules) {
    const feed = schedule.feed;

    // Only archived feeds are excluded — mirror the "Run Now" endpoint, which
    // blocks ARCHIVED only. Comparing case-insensitively so a feed stored as
    // "active" (or any non-archived status) still runs on schedule.
    if ((feed.status || '').toUpperCase() === 'ARCHIVED') {
      console.log(`Scheduler: skipping archived feed "${feed.name}"`);
      // Still advance the schedule so it doesn't stay perpetually "due".
      await db
        .update(feedSchedules)
        .set({ nextRunAt: computeNextRun(schedule.cronExpr, schedule.timezone), updatedAt: new Date().toISOString() })
        .where(eq(feedSchedules.id, schedule.id));
      continue;
    }

    try {
      const runId = crypto.randomUUID();
      await db.insert(feedRuns).values({
        id: runId,
        feedId: feed.id,
        status: 'PENDING',
        startedAt: new Date().toISOString(),
      });

      await env.FEED_QUEUE.send({
        type: 'feed-job',
        feedId: feed.id,
        runId,
        storeId: feed.storeId,
      });

      const nextRunAt = computeNextRun(schedule.cronExpr, schedule.timezone);
      await db
        .update(feedSchedules)
        .set({ nextRunAt, updatedAt: new Date().toISOString() })
        .where(eq(feedSchedules.id, schedule.id));

      console.log(
        `Scheduler: enqueued feed "${feed.name}" (runId: ${runId}), next: ${nextRunAt}`,
      );
    } catch (err) {
      console.error(`Scheduler: failed to enqueue feed "${feed.name}":`, err);
    }
  }
};

async function runProductSync(env: Env): Promise<void> {
  const allStores = await getDb(env).query.stores.findMany({
    columns: { shopDomain: true },
  });

  for (const { shopDomain } of allStores) {
    try {
      const { started } = await startBulkSync(env, shopDomain);
      console.log(`Scheduler: product sync for ${shopDomain} ${started ? 'enqueued' : 'already running'}`);
    } catch (err) {
      console.error(`Scheduler: failed to start product sync for ${shopDomain}:`, err);
    }
  }
}

function computeNextRun(cronExpr: string, timezone?: string | null): string {
  try {
    const cron = new Cron(cronExpr, timezone ? { timezone } : undefined);
    const next = cron.nextRun();
    if (!next) throw new Error('No next run');
    return next.toISOString();
  } catch {
    // If cron is invalid, schedule 1 hour from now as fallback
    return new Date(Date.now() + 3_600_000).toISOString();
  }
}
