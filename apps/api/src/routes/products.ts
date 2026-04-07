import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../db';
import { products } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

const SHOP_DOMAIN = 'd7f63b.myshopify.com';

export const productRoutes = new Hono<{
  Bindings: Env;
  Variables: { shopDomain: string; storeId: string };
}>();

// Resolve storeId from the hardcoded shop domain — no Shopify session token needed
// since this is a standalone management UI, not an embedded Shopify app.
productRoutes.use('*', async (c, next) => {
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

// ─── GET / ─────────────────────────────────────────────────────────────────────

productRoutes.get('/', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);

  const search = c.req.query('search');
  const vendor = c.req.query('vendor');
  const status = c.req.query('status');
  const excludeFromFeeds = c.req.query('excludeFromFeeds');
  const inStock = c.req.query('inStock') === 'true';
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = (page - 1) * limit;

  // Build conditions
  const conditions: any[] = [eq(products.storeId, storeId)];

  if (vendor) {
    conditions.push(sql`lower(${products.vendor}) = lower(${vendor})`);
  }
  if (status) {
    conditions.push(eq(products.status, status));
  }
  if (excludeFromFeeds !== undefined) {
    conditions.push(eq(products.excludeFromFeeds, excludeFromFeeds === 'true'));
  }

  // Fetch all matching products (D1 doesn't support complex joins easily for counting)
  const allProducts = await db.query.products.findMany({
    where: and(...conditions),
    with: {
      variants: {
        orderBy: (v, { asc }) => [asc(v.position)],
      },
      images: {
        orderBy: (img, { asc }) => [asc(img.position)],
      },
      metafields: true,
      collections: {
        with: { collection: true },
      },
    },
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
  });

  // Apply search filter in JS (D1 SQLite has limited full-text search)
  let filtered = allProducts;
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = allProducts.filter((p) => {
      const inTitle = p.title.toLowerCase().includes(searchLower);
      const inVendor = p.vendor?.toLowerCase().includes(searchLower) ?? false;
      const inSku = p.variants.some((v) =>
        v.sku?.toLowerCase().includes(searchLower),
      );
      return inTitle || inVendor || inSku;
    });
  }

  // Apply inStock filter
  if (inStock) {
    filtered = filtered.filter((p) =>
      p.variants.some((v) =>
        v.inventoryLevels.some((il) => il.available > 0),
      ),
    );
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return c.json({
    data: paginated,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /vendors ──────────────────────────────────────────────────────────────

productRoutes.get('/vendors', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);

  const result = await db.query.products.findMany({
    where: (p, { and: and2, eq: eq2, isNotNull }) =>
      and2(eq2(p.storeId, storeId), isNotNull(p.vendor)),
    columns: { vendor: true },
    orderBy: (p, { asc }) => [asc(p.vendor)],
  });

  const vendors = [
    ...new Set(result.map((r) => r.vendor).filter((v): v is string => Boolean(v))),
  ];

  return c.json(vendors);
});

// ─── GET /:id ──────────────────────────────────────────────────────────────────

productRoutes.get('/:id', async (c) => {
  const storeId = c.get('storeId');
  const productId = c.req.param('id');
  const db = getDb(c.env);

  const product = await db.query.products.findFirst({
    where: (p, { and: and2, eq: eq2 }) =>
      and2(eq2(p.id, productId), eq2(p.storeId, storeId)),
    with: {
      variants: {
        with: { inventoryLevels: true },
        orderBy: (v, { asc }) => [asc(v.position)],
      },
      metafields: true,
      collections: { with: { collection: true } },
    },
  });

  if (!product) return c.json({ error: 'Product not found' }, 404);
  return c.json(product);
});

// ─── PATCH /:id/exclude ────────────────────────────────────────────────────────

productRoutes.patch('/:id/exclude', async (c) => {
  const storeId = c.get('storeId');
  const productId = c.req.param('id');
  const db = getDb(c.env);

  const body = await c.req.json<{ exclude: boolean }>();

  const existing = await db.query.products.findFirst({
    where: (p, { and: and2, eq: eq2 }) =>
      and2(eq2(p.id, productId), eq2(p.storeId, storeId)),
    columns: { id: true },
  });

  if (!existing) return c.json({ error: 'Product not found' }, 404);

  await db
    .update(products)
    .set({
      excludeFromFeeds: Boolean(body.exclude),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(products.id, productId));

  return c.json({ ok: true, exclude: Boolean(body.exclude) });
});
