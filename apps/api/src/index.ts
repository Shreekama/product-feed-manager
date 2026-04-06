import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { MIGRATION_SQL, ALTER_TABLE_SQL } from './db/migration';
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
