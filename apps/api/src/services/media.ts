import type { Env } from '../types';

// ─── SKU Derivation ───────────────────────────────────────────────────────────

/**
 * Derive base SKU by removing the last character (size suffix).
 * Example: SKKE-LHNSTI-0001-01L → SKKE-LHNSTI-0001-01
 */
export function deriveBaseSku(sku: string): string | null {
  if (!sku || sku.trim().length < 2) return null;
  return sku.trim().slice(0, -1);
}

// ─── KV Cache (kept for session/sync progress use) ────────────────────────────

/**
 * Invalidate any cached media entry for a given SKU (no-op if not cached).
 */
export async function invalidate(sku: string, env: Env): Promise<void> {
  const baseSku = deriveBaseSku(sku);
  if (!baseSku) return;
  await env.MEDIA_KV.delete(`media:${baseSku}`);
}
