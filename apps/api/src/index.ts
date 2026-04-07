import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { MIGRATION_SQL, ALTER_TABLE_SQL } from './db/migration';
import { getDb } from './db';
import { shopifyRoutes } from './routes/shopify';
import { webhookRoutes } from './routes/webhooks';
import { productRoutes } from './routes/products';
import { feedRoutes } from './routes/feeds';
import { mediaRoutes } from './routes/media';
import { authRoutes } from './routes/auth';
import { feedQueueConsumer } from './queue/consumer';
import { schedulerHandler } from './cron/scheduler';

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => c.env.WEB_URL,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.route('/api/shopify', shopifyRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/products', productRoutes);
app.route('/api/feeds', feedRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/auth', authRoutes);

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// ─── Activity logs ─────────────────────────────────────────────────────────────
app.get('/api/logs', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';
  const db = getDb(c.env);

  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true, lastSyncAt: true, syncStatus: true },
  });

  if (!store) return c.json({ events: [] });

  // Sync progress from KV
  const syncProgress = await c.env.MEDIA_KV.get<any>(`sync_progress:${shopDomain}`, 'json');

  // All feed runs joined with feed name via raw SQL (simpler than drizzle inArray for D1)
  const { results: runs } = await c.env.DB.prepare(`
    SELECT fr.id, fr.feed_id, fr.status, fr.records_processed, fr.records_skipped,
           fr.output_url, fr.error_message, fr.started_at, fr.completed_at, fr.duration_ms,
           f.name as feed_name, f.platform
    FROM feed_runs fr
    JOIN feeds f ON fr.feed_id = f.id
    WHERE f.store_id = ?
    ORDER BY fr.started_at DESC
    LIMIT 50
  `).bind(store.id).all<any>();

  type LogEvent = { type: string; time: string; message: string; status: string; detail?: string };
  const events: LogEvent[] = [];

  // Current sync state
  if (syncProgress) {
    const phase = syncProgress.phase as string;
    const msg = phase === 'done'
      ? `Sync completed — ${syncProgress.processed ?? 0} products imported`
      : phase === 'failed'
      ? `Sync failed: ${syncProgress.error ?? 'unknown error'}`
      : phase === 'processing'
      ? `Sync processing — ${syncProgress.processed ?? 0} products`
      : phase === 'waiting'
      ? 'Shopify preparing bulk export…'
      : 'Sync submitting to Shopify…';
    events.push({
      type: 'sync',
      time: syncProgress.updatedAt || syncProgress.startedAt,
      message: msg,
      status: phase === 'done' ? 'success' : phase === 'failed' ? 'error' : 'info',
    });
  }

  // Last successful sync from store record (only if different from progress)
  if (store.lastSyncAt && (!syncProgress || syncProgress.phase !== 'done')) {
    events.push({
      type: 'sync',
      time: store.lastSyncAt,
      message: 'Sync completed successfully',
      status: 'success',
    });
  }

  // Feed run events
  for (const run of runs) {
    const dur = run.duration_ms ? ` in ${(run.duration_ms / 1000).toFixed(1)}s` : '';
    const records = run.records_processed != null ? ` — ${run.records_processed} rows` : '';
    const msg = run.status === 'SUCCESS'
      ? `Feed "${run.feed_name}" (${run.platform}) completed${records}${dur}`
      : run.status === 'FAILED'
      ? `Feed "${run.feed_name}" failed: ${run.error_message ?? 'unknown'}`
      : run.status === 'RUNNING'
      ? `Feed "${run.feed_name}" running…`
      : `Feed "${run.feed_name}" queued`;
    events.push({
      type: 'feed',
      time: run.completed_at || run.started_at,
      message: msg,
      status: run.status === 'SUCCESS' ? 'success' : run.status === 'FAILED' ? 'error' : 'info',
      detail: run.output_url ?? undefined,
    });
  }

  events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return c.json({ events: events.slice(0, 100) });
});

// ─── One-time DB setup ────────────────────────────────────────────────────────
// Visit /api/setup once in your browser to create all tables.
app.get('/api/setup', async (c) => {
  const results: string[] = [];
  const errors: string[] = [];

  // 1. Run CREATE TABLE / CREATE INDEX statements as a batch
  const stmts = MIGRATION_SQL.split(';').map(s => s.trim()).filter(Boolean);
  try {
    await c.env.DB.batch(stmts.map(sql => c.env.DB.prepare(sql)));
    results.push(`Base schema: ${stmts.length} statements OK`);
  } catch (err: any) {
    errors.push(`Base schema error: ${err.message}`);
  }

  // 2. Run ALTER TABLE statements one-by-one, ignoring "duplicate column" errors
  let altered = 0;
  for (const sql of ALTER_TABLE_SQL) {
    try {
      await c.env.DB.prepare(sql).run();
      altered++;
    } catch (err: any) {
      const msg = err.message || '';
      // Ignore "duplicate column name" and "already exists" — means column/index already there
      if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
        errors.push(`ALTER: ${msg} — SQL: ${sql.slice(0, 80)}`);
      }
    }
  }
  results.push(`Schema evolution: ${altered}/${ALTER_TABLE_SQL.length} ALTER statements applied`);

  return c.json({ ok: errors.length === 0, results, errors });
});

// ─── Serve frontend static files / SPA fallback for all non-API routes ───────
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 404) {
    // SPA fallback: unknown paths (e.g. /feeds/abc123) get index.html
    // and client-side routing takes over.
    return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString()));
  }
  return res;
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  const status = (err as any).status ?? 500;
  const message = err.message || 'Internal server error';
  return c.json({ error: message }, status);
});

export default {
  fetch: app.fetch,
  queue: feedQueueConsumer,
  scheduled: schedulerHandler,
};
