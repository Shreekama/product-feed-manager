import { Hono } from 'hono';
import { Cron } from 'croner';
import type { Env } from '../types';
import { getDb } from '../db';
import { feeds, feedSchedules, feedRuns } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

const SHOP_DOMAIN = 'd7f63b.myshopify.com';

export const feedRoutes = new Hono<{
  Bindings: Env;
  Variables: { shopDomain: string; storeId: string };
}>();

// Resolve store from hardcoded domain — standalone app, no Shopify session token needed
feedRoutes.use('*', async (c, next) => {
  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, SHOP_DOMAIN),
    columns: { id: true },
  });
  if (!store) return c.json({ error: 'Store not configured. Run a sync first.' }, 404);
  c.set('shopDomain', SHOP_DOMAIN);
  c.set('storeId', store.id);
  await next();
});

// ─── GET /dashboard ───────────────────────────────────────────────────────────

feedRoutes.get('/dashboard', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);

  const allFeeds = await db.query.feeds.findMany({
    where: (f, { eq: eq2 }) => eq2(f.storeId, storeId),
    with: {
      schedule: true,
      runs: {
        orderBy: (r, { desc: desc2 }) => [desc2(r.startedAt)],
        limit: 1,
      },
    },
  });

  const dashboard = allFeeds.map((f) => ({
    id: f.id,
    name: f.name,
    platform: f.platform,
    country: f.country,
    outputType: f.outputType,
    status: f.status,
    lastRun: f.runs[0] ?? null,
    nextRun: f.schedule?.nextRunAt ?? null,
    scheduleActive: f.schedule?.isActive ?? false,
  }));

  return c.json(dashboard);
});

// ─── GET / ─────────────────────────────────────────────────────────────────────

feedRoutes.get('/', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);

  const result = await db.query.feeds.findMany({
    where: (f, { eq: eq2 }) => eq2(f.storeId, storeId),
    with: {
      schedule: true,
      runs: {
        orderBy: (r, { desc: desc2 }) => [desc2(r.startedAt)],
        limit: 1,
      },
    },
    orderBy: (f, { desc: desc2 }) => [desc2(f.createdAt)],
  });

  return c.json(result);
});

// ─── POST / ────────────────────────────────────────────────────────────────────

feedRoutes.post('/', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);
  const body = await c.req.json<any>();

  const { schedule, columnMappings, filterRules, ...feedData } = body;

  const feedId = crypto.randomUUID();

  await db.insert(feeds).values({
    id: feedId,
    storeId,
    name: feedData.name,
    platform: feedData.platform || 'GOOGLE',
    country: feedData.country || 'US',
    outputType: feedData.outputType || 'CSV',
    googleSheetId: feedData.googleSheetId ?? null,
    googleSheetTab: feedData.googleSheetTab ?? null,
    columnMappings: JSON.stringify(columnMappings || []),
    filterRules: JSON.stringify(filterRules || []),
    status: feedData.status || 'ACTIVE',
  });

  // schedule.enabled === false (or a missing cronExpr) means "no schedule".
  if (schedule && schedule.enabled !== false && schedule.cronExpr) {
    const timezone = schedule.timezone || 'UTC';
    const nextRunAt = computeNextRun(schedule.cronExpr, timezone);
    await db.insert(feedSchedules).values({
      id: crypto.randomUUID(),
      feedId,
      cronExpr: schedule.cronExpr,
      timezone,
      nextRunAt,
    });
  }

  const created = await db.query.feeds.findFirst({
    where: (f, { eq: eq2 }) => eq2(f.id, feedId),
    with: { schedule: true },
  });

  return c.json(created, 201);
});

// ─── GET /:id ──────────────────────────────────────────────────────────────────

feedRoutes.get('/:id', async (c) => {
  const storeId = c.get('storeId');
  const feedId = c.req.param('id');
  const db = getDb(c.env);

  const feed = await db.query.feeds.findFirst({
    where: (f, { and: and2, eq: eq2 }) =>
      and2(eq2(f.id, feedId), eq2(f.storeId, storeId)),
    with: {
      schedule: true,
      runs: {
        orderBy: (r, { desc: desc2 }) => [desc2(r.startedAt)],
        limit: 10,
      },
    },
  });

  if (!feed) return c.json({ error: 'Feed not found' }, 404);
  return c.json(feed);
});

// ─── PUT /:id ──────────────────────────────────────────────────────────────────

feedRoutes.put('/:id', async (c) => {
  const storeId = c.get('storeId');
  const feedId = c.req.param('id');
  const db = getDb(c.env);

  const existing = await db.query.feeds.findFirst({
    where: (f, { and: and2, eq: eq2 }) =>
      and2(eq2(f.id, feedId), eq2(f.storeId, storeId)),
    columns: { id: true },
  });

  if (!existing) return c.json({ error: 'Feed not found' }, 404);

  const body = await c.req.json<any>();
  const { schedule, columnMappings, filterRules, ...rest } = body;

  const updateData: any = { updatedAt: new Date().toISOString() };
  if (rest.name !== undefined) updateData.name = rest.name;
  if (rest.platform !== undefined) updateData.platform = rest.platform;
  if (rest.country !== undefined) updateData.country = rest.country;
  if (rest.outputType !== undefined) updateData.outputType = rest.outputType;
  if (rest.googleSheetId !== undefined) updateData.googleSheetId = rest.googleSheetId;
  if (rest.googleSheetTab !== undefined) updateData.googleSheetTab = rest.googleSheetTab;
  if (rest.status !== undefined) updateData.status = rest.status;
  if (columnMappings !== undefined) updateData.columnMappings = JSON.stringify(columnMappings);
  if (filterRules !== undefined) updateData.filterRules = JSON.stringify(filterRules);

  await db.update(feeds).set(updateData).where(eq(feeds.id, feedId));

  if (schedule) {
    const disabled = schedule.enabled === false || !schedule.cronExpr;

    if (disabled) {
      // User turned the schedule off — remove it so the scheduler stops picking it up.
      await db.delete(feedSchedules).where(eq(feedSchedules.feedId, feedId));
    } else {
      const timezone = schedule.timezone || 'UTC';
      const nextRunAt = computeNextRun(schedule.cronExpr, timezone);
      const existingSchedule = await db.query.feedSchedules.findFirst({
        where: (s, { eq: eq2 }) => eq2(s.feedId, feedId),
        columns: { id: true },
      });

      if (existingSchedule) {
        await db
          .update(feedSchedules)
          .set({
            cronExpr: schedule.cronExpr,
            timezone,
            nextRunAt,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(feedSchedules.id, existingSchedule.id));
      } else {
        await db.insert(feedSchedules).values({
          id: crypto.randomUUID(),
          feedId,
          cronExpr: schedule.cronExpr,
          timezone,
          nextRunAt,
        });
      }
    }
  }

  const updated = await db.query.feeds.findFirst({
    where: (f, { eq: eq2 }) => eq2(f.id, feedId),
    with: { schedule: true },
  });

  return c.json(updated);
});

// ─── DELETE /:id ───────────────────────────────────────────────────────────────

feedRoutes.delete('/:id', async (c) => {
  const storeId = c.get('storeId');
  const feedId = c.req.param('id');
  const db = getDb(c.env);

  const existing = await db.query.feeds.findFirst({
    where: (f, { and: and2, eq: eq2 }) =>
      and2(eq2(f.id, feedId), eq2(f.storeId, storeId)),
    columns: { id: true },
  });

  if (!existing) return c.json({ error: 'Feed not found' }, 404);

  await db.delete(feeds).where(eq(feeds.id, feedId));
  return c.json({ deleted: true });
});

// ─── POST /:id/run ─────────────────────────────────────────────────────────────

feedRoutes.post('/:id/run', async (c) => {
  const storeId = c.get('storeId');
  const feedId = c.req.param('id');
  const db = getDb(c.env);

  const feed = await db.query.feeds.findFirst({
    where: (f, { and: and2, eq: eq2 }) =>
      and2(eq2(f.id, feedId), eq2(f.storeId, storeId)),
    columns: { id: true, status: true },
  });

  if (!feed) return c.json({ error: 'Feed not found' }, 404);
  if (feed.status === 'ARCHIVED') {
    return c.json({ error: 'Cannot run an archived feed' }, 400);
  }

  const runId = crypto.randomUUID();
  await db.insert(feedRuns).values({
    id: runId,
    feedId,
    status: 'PENDING',
    startedAt: new Date().toISOString(),
  });

  await c.env.FEED_QUEUE.send({
    type: 'feed-job',
    feedId,
    runId,
    storeId,
  });

  return c.json({ runId, message: 'Feed run enqueued' }, 202);
});

// ─── GET /:id/runs ─────────────────────────────────────────────────────────────

feedRoutes.get('/:id/runs', async (c) => {
  const storeId = c.get('storeId');
  const feedId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const db = getDb(c.env);

  // Verify ownership
  const feed = await db.query.feeds.findFirst({
    where: (f, { and: and2, eq: eq2 }) =>
      and2(eq2(f.id, feedId), eq2(f.storeId, storeId)),
    columns: { id: true },
  });

  if (!feed) return c.json({ error: 'Feed not found' }, 404);

  const runs = await db.query.feedRuns.findMany({
    where: (r, { eq: eq2 }) => eq2(r.feedId, feedId),
    orderBy: (r, { desc: desc2 }) => [desc2(r.startedAt)],
    limit,
  });

  return c.json(runs);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeNextRun(cronExpr: string, timezone?: string | null): string {
  try {
    const cron = new Cron(cronExpr, timezone ? { timezone } : undefined);
    const next = cron.nextRun();
    if (!next) throw new Error('No next run');
    return next.toISOString();
  } catch {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }
}
