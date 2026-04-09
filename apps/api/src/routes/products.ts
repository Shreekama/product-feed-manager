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
  const productType = c.req.query('productType');
  const excludeFromFeeds = c.req.query('excludeFromFeeds');
  const inStock = c.req.query('inStock') === 'true';
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(products.storeId, storeId)];

  if (vendor) conditions.push(sql`lower(${products.vendor}) = lower(${vendor})`);
  if (status) conditions.push(eq(products.status, status));
  if (productType) conditions.push(sql`lower(${products.productType}) = lower(${productType})`);
  if (excludeFromFeeds !== undefined) conditions.push(eq(products.excludeFromFeeds, excludeFromFeeds === 'true'));

  const allProducts = await db.query.products.findMany({
    where: and(...conditions),
    with: {
      variants: { orderBy: (v, { asc }) => [asc(v.position)] },
      images:   { orderBy: (img, { asc }) => [asc(img.position)] },
      metafields: true,
      collections: { with: { collection: true } },
    },
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
  });

  let filtered = allProducts;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((p) =>
      p.title.toLowerCase().includes(s) ||
      (p.vendor?.toLowerCase().includes(s) ?? false) ||
      p.variants.some((v) => v.sku?.toLowerCase().includes(s)),
    );
  }

  // inStock: use inventoryQuantity directly (inventoryLevels not loaded)
  if (inStock) {
    filtered = filtered.filter((p) => p.variants.some((v) => (v.inventoryQuantity ?? 0) > 0));
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return c.json({ data: paginated, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
});

// ─── GET /vendors ──────────────────────────────────────────────────────────────

productRoutes.get('/vendors', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);

  const result = await db.query.products.findMany({
    where: (p, { and: a, eq: e, isNotNull }) => a(e(p.storeId, storeId), isNotNull(p.vendor)),
    columns: { vendor: true },
    orderBy: (p, { asc }) => [asc(p.vendor)],
  });

  return c.json([...new Set(result.map((r) => r.vendor).filter(Boolean) as string[])]);
});

// ─── GET /product-types ────────────────────────────────────────────────────────

productRoutes.get('/product-types', async (c) => {
  const storeId = c.get('storeId');
  const db = getDb(c.env);

  const result = await db.query.products.findMany({
    where: (p, { and: a, eq: e, isNotNull }) => a(e(p.storeId, storeId), isNotNull(p.productType)),
    columns: { productType: true },
    orderBy: (p, { asc }) => [asc(p.productType)],
  });

  const types = [...new Set(
    result.map((r) => r.productType).filter((t): t is string => Boolean(t)),
  )];

  return c.json(types);
});

// ─── GET /:id ──────────────────────────────────────────────────────────────────

productRoutes.get('/:id', async (c) => {
  const storeId = c.get('storeId');
  const productId = c.req.param('id');
  const db = getDb(c.env);

  const product = await db.query.products.findFirst({
    where: (p, { and: a, eq: e }) => a(e(p.id, productId), e(p.storeId, storeId)),
    with: {
      variants: { orderBy: (v, { asc }) => [asc(v.position)] },
      images:   { orderBy: (img, { asc }) => [asc(img.position)] },
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
    where: (p, { and: a, eq: e }) => a(e(p.id, productId), e(p.storeId, storeId)),
    columns: { id: true },
  });

  if (!existing) return c.json({ error: 'Product not found' }, 404);

  await db.update(products)
    .set({ excludeFromFeeds: Boolean(body.exclude), updatedAt: new Date().toISOString() })
    .where(eq(products.id, productId));

  return c.json({ ok: true, exclude: Boolean(body.exclude) });
});
