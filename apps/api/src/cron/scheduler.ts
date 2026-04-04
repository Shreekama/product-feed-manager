import { Cron } from 'croner';
import { getDb } from '../db';
import { feedRuns, feedSchedules } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { Env } from '../types';

export const schedulerHandler: ExportedHandlerScheduledHandler<Env> = async (
  _event,
  env,
  _ctx,
) => {
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

    if (feed.status !== 'ACTIVE') {
      console.log(`Scheduler: skipping non-active feed "${feed.name}"`);
      continue;
    }

    try {
      const runId = crypto.randomUUID();
      await db.insert(feedRuns).values({
        id: runId,
        feedId: feed.id,
        status: 'PENDING',
      });

      await env.FEED_QUEUE.send({
        type: 'feed-job',
        feedId: feed.id,
        runId,
        storeId: feed.storeId,
      });

      const nextRunAt = computeNextRun(schedule.cronExpr);
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

function computeNextRun(cronExpr: string): string {
  try {
    const cron = new Cron(cronExpr);
    const next = cron.nextRun();
    if (!next) throw new Error('No next run');
    return next.toISOString();
  } catch {
    // If cron is invalid, schedule 1 hour from now as fallback
    return new Date(Date.now() + 3_600_000).toISOString();
  }
}
