import type { Env } from '../types';

export interface MediaResult {
  images: string[];
  videos: string[];
  primaryImage: string | null;
}

const KV_PREFIX = 'media:';

// ─── SKU Derivation ──────────────────────────────────────────────────────────

/**
 * Derive base SKU by removing the last character (size suffix).
 * Example: SKKE-LHNSTI-0001-01L → SKKE-LHNSTI-0001-01
 */
export function deriveBaseSku(sku: string): string | null {
  if (!sku || sku.trim().length < 2) return null;
  return sku.trim().slice(0, -1);
}

// ─── URL Construction ─────────────────────────────────────────────────────────

/**
 * Build image URL for a given baseSku and sequential index (1-based).
 * img_<base_sku>_01.jpg
 */
export function buildImageUrl(
  baseSku: string,
  index: number,
  baseUrl: string,
): string {
  const suffix = String(index).padStart(2, '0');
  return `${baseUrl}/img_${baseSku}_${suffix}.jpg`;
}

/**
 * Build video URL for a given baseSku and sequential index (1-based).
 * vid_<base_sku>_01.mp4
 */
export function buildVideoUrl(
  baseSku: string,
  index: number,
  baseUrl: string,
): string {
  const suffix = String(index).padStart(2, '0');
  return `${baseUrl}/vid_${baseSku}_${suffix}.mp4`;
}

// ─── KV Cache ─────────────────────────────────────────────────────────────────

async function getCached(
  baseSku: string,
  env: Env,
): Promise<MediaResult | null> {
  const raw = await env.MEDIA_KV.get(`${KV_PREFIX}${baseSku}`, 'text');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MediaResult;
  } catch {
    return null;
  }
}

async function persistCache(
  baseSku: string,
  result: MediaResult,
  env: Env,
): Promise<void> {
  const ttl = parseInt(env.MEDIA_CACHE_TTL || '21600', 10);
  await env.MEDIA_KV.put(
    `${KV_PREFIX}${baseSku}`,
    JSON.stringify(result),
    { expirationTtl: ttl },
  );
}

// ─── CDN Probing ─────────────────────────────────────────────────────────────

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function probeSequential(
  baseSku: string,
  type: 'image' | 'video',
  env: Env,
): Promise<string[]> {
  const found: string[] = [];
  const baseUrl = env.MEDIA_BASE_URL || 'https://cdn.example.com/media';
  const maxImages = parseInt(env.MEDIA_MAX_IMAGES || '20', 10);
  const max = type === 'image' ? maxImages : 5;

  for (let i = 1; i <= max; i++) {
    const url =
      type === 'image'
        ? buildImageUrl(baseSku, i, baseUrl)
        : buildVideoUrl(baseSku, i, baseUrl);

    const exists = await urlExists(url);
    if (!exists) break;
    found.push(url);
  }

  return found;
}

async function probeAndCache(baseSku: string, env: Env): Promise<MediaResult> {
  const [images, videos] = await Promise.all([
    probeSequential(baseSku, 'image', env),
    probeSequential(baseSku, 'video', env),
  ]);

  const result: MediaResult = {
    images,
    videos,
    primaryImage: images[0] ?? null,
  };

  await persistCache(baseSku, result, env);
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve all media for a given SKU.
 * Checks KV cache first, probes CDN on miss.
 */
export async function resolveForSku(
  sku: string,
  env: Env,
): Promise<MediaResult> {
  const baseSku = deriveBaseSku(sku);
  if (!baseSku) return { images: [], videos: [], primaryImage: null };

  const cached = await getCached(baseSku, env);
  if (cached) return cached;

  return probeAndCache(baseSku, env);
}

/**
 * Resolve media for multiple SKUs with bounded concurrency.
 */
export async function resolveForSkus(
  skus: string[],
  env: Env,
  concurrency = 10,
): Promise<Map<string, MediaResult>> {
  const results = new Map<string, MediaResult>();
  const unique = [...new Set(skus.filter(Boolean))];

  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map((sku) => resolveForSku(sku, env).then((r) => ({ sku, r }))),
    );
    for (const item of settled) {
      if (item.status === 'fulfilled') {
        results.set(item.value.sku, item.value.r);
      }
    }
  }

  return results;
}

/**
 * Invalidate cached media for a given SKU.
 */
export async function invalidate(sku: string, env: Env): Promise<void> {
  const baseSku = deriveBaseSku(sku);
  if (!baseSku) return;
  await env.MEDIA_KV.delete(`${KV_PREFIX}${baseSku}`);
}
