import { Hono } from 'hono';
import type { Env } from '../types';
import {
  resolveForSku,
  buildImageUrl,
  buildVideoUrl,
  deriveBaseSku,
} from '../services/media';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

// ─── GET /resolve?sku= ────────────────────────────────────────────────────────

mediaRoutes.get('/resolve', async (c) => {
  const sku = c.req.query('sku');
  if (!sku) return c.json({ error: 'Missing sku parameter' }, 400);

  const result = await resolveForSku(sku, c.env);
  return c.json(result);
});

// ─── GET /preview-urls?sku=&count= ────────────────────────────────────────────
// Generate URLs without probing CDN

mediaRoutes.get('/preview-urls', (c) => {
  const sku = c.req.query('sku');
  if (!sku) return c.json({ error: 'Missing sku parameter' }, 400);

  const count = Math.min(parseInt(c.req.query('count') || '5', 10), 20);
  const baseUrl = c.env.MEDIA_BASE_URL || 'https://cdn.example.com/media';

  const baseSku = deriveBaseSku(sku);
  if (!baseSku) return c.json({ error: 'Invalid SKU' }, 400);

  const images: string[] = [];
  const videos: string[] = [];

  for (let i = 1; i <= count; i++) {
    images.push(buildImageUrl(baseSku, i, baseUrl));
    if (i <= 5) {
      videos.push(buildVideoUrl(baseSku, i, baseUrl));
    }
  }

  return c.json({ baseSku, images, videos });
});
