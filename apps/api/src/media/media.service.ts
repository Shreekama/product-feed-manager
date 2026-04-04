import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as https from 'https';
import * as http from 'http';

export interface MediaResult {
  images: string[];   // ordered: _01, _02, _03 …
  videos: string[];   // ordered: _01, _02 …
  primaryImage: string | null;
}

/**
 * SKU-based deterministic media fetching service.
 *
 * SKU format:  SKKE-LHNSTI-0001-01L  (20 chars; last char = size, irrelevant for images)
 * Base SKU:    SKKE-LHNSTI-0001-01   (remove last char)
 *
 * Image naming: img_<base_sku>_01.jpg, img_<base_sku>_02.jpg …
 * Video naming: vid_<base_sku>_01.mp4
 *
 * Algorithm:
 *  1. Derive baseSku from variant SKU
 *  2. Check DB cache (MediaCache table) — return if fresh
 *  3. Probe CDN starting at _01, increment until 404 / max reached
 *  4. Persist result to cache with TTL
 *  5. Return ordered URLs
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  private readonly baseUrl: string;
  private readonly cacheTtlSec: number;
  private readonly maxImages: number;

  // In-memory lock map to prevent concurrent probes for the same baseSku
  private readonly probeInProgress = new Map<string, Promise<MediaResult>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('media.baseUrl', 'https://cdn.example.com/media');
    this.cacheTtlSec = config.get<number>('media.cacheTtl', 21600);
    this.maxImages = config.get<number>('media.maxImages', 20);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Resolve all media for a given SKU.
   * Handles caching, concurrent deduplication, and CDN probing.
   */
  async resolveForSku(sku: string): Promise<MediaResult> {
    const baseSku = this.deriveBaseSku(sku);
    if (!baseSku) return this.emptyResult();

    // Check DB cache first
    const cached = await this.getCached(baseSku);
    if (cached) return cached;

    // Deduplicate concurrent probes for the same baseSku
    if (this.probeInProgress.has(baseSku)) {
      return this.probeInProgress.get(baseSku)!;
    }

    const probePromise = this.probeAndCache(baseSku).finally(() => {
      this.probeInProgress.delete(baseSku);
    });

    this.probeInProgress.set(baseSku, probePromise);
    return probePromise;
  }

  /**
   * Resolve media for multiple SKUs in parallel (bounded concurrency).
   */
  async resolveForSkus(
    skus: string[],
    concurrency = 10,
  ): Promise<Map<string, MediaResult>> {
    const results = new Map<string, MediaResult>();
    const unique = [...new Set(skus.filter(Boolean))];

    // Process in chunks to bound concurrency
    for (let i = 0; i < unique.length; i += concurrency) {
      const chunk = unique.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        chunk.map((sku) => this.resolveForSku(sku).then((r) => ({ sku, r }))),
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
   * Invalidate cached media for a given SKU (e.g., after SKU change).
   */
  async invalidate(sku: string) {
    const baseSku = this.deriveBaseSku(sku);
    if (!baseSku) return;
    await this.prisma.mediaCache.deleteMany({ where: { baseSku } });
    this.logger.log(`Media cache invalidated for baseSku: ${baseSku}`);
  }

  /**
   * Update variant's cached media column for fast feed generation.
   */
  async warmVariantCache(variantId: string, sku: string) {
    const media = await this.resolveForSku(sku);
    await this.prisma.variant.update({
      where: { id: variantId },
      data: {
        mediaCache: media as any,
        mediaCachedAt: new Date(),
      },
    });
  }

  // ─── SKU Derivation ────────────────────────────────────────────────────────

  /**
   * Derive base SKU by removing the last character (size suffix).
   * Returns null for invalid/empty SKUs.
   *
   * Example: SKKE-LHNSTI-0001-01L → SKKE-LHNSTI-0001-01
   */
  deriveBaseSku(sku: string): string | null {
    if (!sku || sku.trim().length < 2) return null;
    return sku.trim().slice(0, -1);
  }

  // ─── URL Construction ──────────────────────────────────────────────────────

  /**
   * Build image URL for a given baseSku and sequential index (1-based).
   * img_<base_sku>_01.jpg
   */
  buildImageUrl(baseSku: string, index: number): string {
    const suffix = String(index).padStart(2, '0');
    return `${this.baseUrl}/img_${baseSku}_${suffix}.jpg`;
  }

  /**
   * Build video URL for a given baseSku and sequential index (1-based).
   * vid_<base_sku>_01.mp4
   */
  buildVideoUrl(baseSku: string, index: number): string {
    const suffix = String(index).padStart(2, '0');
    return `${this.baseUrl}/vid_${baseSku}_${suffix}.mp4`;
  }

  // ─── Cache ─────────────────────────────────────────────────────────────────

  private async getCached(baseSku: string): Promise<MediaResult | null> {
    const entry = await this.prisma.mediaCache.findUnique({
      where: { baseSku },
    });

    if (!entry) return null;
    if (new Date() > entry.expiresAt) {
      // Expired — delete and re-probe
      await this.prisma.mediaCache.delete({ where: { baseSku } });
      return null;
    }

    return {
      images: entry.images,
      videos: entry.videos,
      primaryImage: entry.images[0] || null,
    };
  }

  private async persistCache(baseSku: string, result: MediaResult) {
    const expiresAt = new Date(Date.now() + this.cacheTtlSec * 1000);
    await this.prisma.mediaCache.upsert({
      where: { baseSku },
      create: {
        baseSku,
        images: result.images,
        videos: result.videos,
        expiresAt,
      },
      update: {
        images: result.images,
        videos: result.videos,
        cachedAt: new Date(),
        expiresAt,
      },
    });
  }

  // ─── CDN Probing ───────────────────────────────────────────────────────────

  private async probeAndCache(baseSku: string): Promise<MediaResult> {
    const [images, videos] = await Promise.all([
      this.probeSequential(baseSku, 'image'),
      this.probeSequential(baseSku, 'video'),
    ]);

    const result: MediaResult = {
      images,
      videos,
      primaryImage: images[0] || null,
    };

    // Persist even if empty (so we don't keep probing missing assets)
    await this.persistCache(baseSku, result);
    return result;
  }

  /**
   * Probe URLs sequentially starting at _01 until 404 or max reached.
   * Returns the list of found URLs in order.
   */
  private async probeSequential(
    baseSku: string,
    type: 'image' | 'video',
  ): Promise<string[]> {
    const found: string[] = [];
    const max = type === 'image' ? this.maxImages : 5;

    for (let i = 1; i <= max; i++) {
      const url =
        type === 'image'
          ? this.buildImageUrl(baseSku, i)
          : this.buildVideoUrl(baseSku, i);

      const exists = await this.urlExists(url);
      if (!exists) break; // Stop on first miss — sequential naming convention

      found.push(url);
      this.logger.debug(`Found ${type}: ${url}`);
    }

    return found;
  }

  /**
   * HEAD request to check if a URL exists (200 = exists, anything else = not found).
   * Gracefully handles network errors as "not found".
   */
  private urlExists(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;

        const req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'HEAD',
            timeout: 5000,
          },
          (res) => {
            resolve(res.statusCode === 200);
            res.resume(); // drain
          },
        );

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  private emptyResult(): MediaResult {
    return { images: [], videos: [], primaryImage: null };
  }
}
