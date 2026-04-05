import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../db';
import { deriveBaseSku } from '../services/media';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

// ─── GET /resolve?sku= ────────────────────────────────────────────────────────
// Returns Shopify CDN image URLs for a variant SKU (query params already stripped).

mediaRoutes.get('/resolve', async (c) => {
  const sku = c.req.query('sku');
  if (!sku) return c.json({ error: 'Missing sku parameter' }, 400);

  const db = getDb(c.env);

  // Find the variant by SKU
  const variant = await db.query.variants.findFirst({
    where: (v, { eq }) => eq(v.sku, sku),
    columns: { id: true, sku: true, imageSrc: true, productId: true },
  });

  if (!variant) {
    return c.json({ sku, baseSku: deriveBaseSku(sku), images: [], primaryImage: null });
  }

  // Fetch all product images sorted by position
  const productImgs = await db.query.productImages.findMany({
    where: (pi, { eq }) => eq(pi.productId, variant.productId),
    orderBy: (pi, { asc }) => [asc(pi.position)],
    columns: { src: true, altText: true, width: true, height: true, position: true },
  });

  const images = productImgs.map((img) => img.src);
  const primaryImage = variant.imageSrc || images[0] || null;

  return c.json({
    sku,
    baseSku: deriveBaseSku(sku),
    primaryImage,
    images,
    imageDetails: productImgs,
  });
});
