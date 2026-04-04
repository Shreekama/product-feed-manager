import { Hono } from 'hono';
import type { Env } from '../types';
import { shopifyHmac } from '../middleware/hmac';
import { getDb } from '../db';
import { products, variants, inventoryLevels } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { invalidate as invalidateMedia } from '../services/media';

export const webhookRoutes = new Hono<{
  Bindings: Env;
  Variables: { rawBody: ArrayBuffer; shopDomain: string };
}>();

// Apply HMAC guard to all webhook routes
webhookRoutes.use('*', shopifyHmac);

// ─── POST /products-create ────────────────────────────────────────────────────

webhookRoutes.post('/products-create', async (c) => {
  const shopDomain = c.get('shopDomain');
  const rawBody = c.get('rawBody');
  const payload = JSON.parse(new TextDecoder().decode(rawBody)) as any;

  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (!store) return c.json({ ok: true });

  await upsertProduct(db, store.id, payload);
  console.log(`[${shopDomain}] products/create: ${payload.id}`);
  return c.json({ ok: true });
});

// ─── POST /products-update ────────────────────────────────────────────────────

webhookRoutes.post('/products-update', async (c) => {
  const shopDomain = c.get('shopDomain');
  const rawBody = c.get('rawBody');
  const payload = JSON.parse(new TextDecoder().decode(rawBody)) as any;

  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (!store) return c.json({ ok: true });

  // Invalidate media cache for any variants whose SKU changed
  const shopifyProductId = `gid://shopify/Product/${payload.id}`;
  const existingProduct = await db.query.products.findFirst({
    where: (p, { and: and2, eq: eq2 }) =>
      and2(eq2(p.shopifyId, shopifyProductId), eq2(p.storeId, store.id)),
    with: { variants: { columns: { shopifyId: true, sku: true } } },
  });

  if (existingProduct) {
    for (const iv of payload.variants || []) {
      const incomingSku: string | null = iv.sku || null;
      const existingVariant = existingProduct.variants.find(
        (v) => v.shopifyId === `gid://shopify/ProductVariant/${iv.id}`,
      );
      if (existingVariant && existingVariant.sku !== incomingSku && incomingSku) {
        await invalidateMedia(incomingSku, c.env);
      }
    }
  }

  await upsertProduct(db, store.id, payload);
  console.log(`[${shopDomain}] products/update: ${payload.id}`);
  return c.json({ ok: true });
});

// ─── POST /products-delete ────────────────────────────────────────────────────

webhookRoutes.post('/products-delete', async (c) => {
  const shopDomain = c.get('shopDomain');
  const rawBody = c.get('rawBody');
  const payload = JSON.parse(new TextDecoder().decode(rawBody)) as any;

  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (!store) return c.json({ ok: true });

  const shopifyProductId = `gid://shopify/Product/${payload.id}`;
  await db
    .delete(products)
    .where(
      and(eq(products.shopifyId, shopifyProductId), eq(products.storeId, store.id)),
    );

  console.log(`[${shopDomain}] products/delete: ${payload.id}`);
  return c.json({ ok: true });
});

// ─── POST /inventory-levels-update ────────────────────────────────────────────

webhookRoutes.post('/inventory-levels-update', async (c) => {
  const shopDomain = c.get('shopDomain');
  const rawBody = c.get('rawBody');
  const payload = JSON.parse(new TextDecoder().decode(rawBody)) as any;

  const db = getDb(c.env);
  const inventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  const locationId = `gid://shopify/Location/${payload.location_id}`;
  const available = payload.available ?? 0;

  // Find the variant that owns this inventory item
  const variant = await db.query.variants.findFirst({
    where: (v, { eq: eq2 }) => eq2(v.inventoryItemId, inventoryItemGid),
    columns: { id: true },
  });

  if (!variant) {
    console.warn(`[${shopDomain}] No variant for inventoryItemId: ${inventoryItemGid}`);
    return c.json({ ok: true });
  }

  // Check for existing inventory level
  const existing = await db.query.inventoryLevels.findFirst({
    where: (il, { and: and2, eq: eq2 }) =>
      and2(eq2(il.variantId, variant.id), eq2(il.locationId, locationId)),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(inventoryLevels)
      .set({ available, updatedAt: new Date().toISOString() })
      .where(eq(inventoryLevels.id, existing.id));
  } else {
    await db.insert(inventoryLevels).values({
      id: crypto.randomUUID(),
      variantId: variant.id,
      locationId,
      available,
    });
  }

  return c.json({ ok: true });
});

// ─── Shared Upsert Logic ──────────────────────────────────────────────────────

async function upsertProduct(db: any, storeId: string, payload: any): Promise<void> {
  const shopifyProductId = `gid://shopify/Product/${payload.id}`;
  const tags = payload.tags
    ? payload.tags
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean)
    : [];

  const productData = {
    shopifyId: shopifyProductId,
    storeId,
    title: payload.title,
    vendor: payload.vendor || null,
    productType: payload.product_type || null,
    handle: payload.handle || null,
    status: (payload.status || 'active').toLowerCase(),
    tags: JSON.stringify(tags),
    bodyHtml: payload.body_html || null,
    publishedAt: payload.published_at || null,
    updatedAt: new Date().toISOString(),
  };

  const existing = await db.query.products.findFirst({
    where: (p: any, { and: and2, eq: eq2 }: any) =>
      and2(eq2(p.shopifyId, shopifyProductId), eq2(p.storeId, storeId)),
    columns: { id: true },
  });

  let productId: string;
  if (existing) {
    productId = existing.id;
    await db.update(products).set(productData).where(eq(products.id, productId));
  } else {
    productId = crypto.randomUUID();
    await db.insert(products).values({ id: productId, ...productData });
  }

  // Upsert variants
  for (const v of payload.variants || []) {
    const shopifyVariantId = `gid://shopify/ProductVariant/${v.id}`;

    const variantData = {
      shopifyId: shopifyVariantId,
      productId,
      sku: v.sku || null,
      title: v.title,
      price: String(v.price || '0'),
      compareAtPrice: v.compare_at_price ? String(v.compare_at_price) : null,
      weight: v.weight || null,
      weightUnit: v.weight_unit || null,
      inventoryItemId: v.inventory_item_id
        ? `gid://shopify/InventoryItem/${v.inventory_item_id}`
        : null,
      barcode: v.barcode || null,
      taxable: v.taxable ?? true,
      requiresShipping: v.requires_shipping ?? true,
      position: v.position || 1,
      option1: v.option1 || null,
      option2: v.option2 || null,
      option3: v.option3 || null,
      updatedAt: new Date().toISOString(),
    };

    const existingVariant = await db.query.variants.findFirst({
      where: (vv: any, { and: and2, eq: eq2 }: any) =>
        and2(eq2(vv.shopifyId, shopifyVariantId), eq2(vv.productId, productId)),
      columns: { id: true },
    });

    if (existingVariant) {
      await db
        .update(variants)
        .set(variantData)
        .where(eq(variants.id, existingVariant.id));
    } else {
      await db.insert(variants).values({ id: crypto.randomUUID(), ...variantData });
    }
  }
}
