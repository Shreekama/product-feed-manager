import type { Env } from '../types';
import { getDb } from '../db';
import { stores } from '../db/schema';
import { eq } from 'drizzle-orm';

// A sync whose progress hasn't moved in this long is treated as dead (e.g. its
// queue message exhausted its retries) and may be restarted.
const STALE_SYNC_MS = 30 * 60 * 1000;

/**
 * Mark the store as SYNCING and enqueue a Shopify bulk sync.
 * Shared by the manual "Sync" button and the scheduled product sync.
 */
export async function startBulkSync(
  env: Env,
  shopDomain: string,
): Promise<{ started: boolean; storeId: string }> {
  const db = getDb(env);

  let store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true, syncStatus: true },
  });

  // Auto-create store record on first sync — token is fetched inflight, not stored
  if (!store) {
    const storeId = crypto.randomUUID();
    await db.insert(stores).values({ id: storeId, shopDomain, accessToken: '', syncStatus: 'IDLE' });
    store = { id: storeId, syncStatus: 'IDLE' };
  }

  if (store.syncStatus === 'SYNCING') {
    const progress = await env.MEDIA_KV.get<any>(`sync_progress:${shopDomain}`, 'json');
    const lastUpdate = new Date(progress?.updatedAt ?? 0).getTime();
    if (Date.now() - lastUpdate < STALE_SYNC_MS) {
      return { started: false, storeId: store.id };
    }
    console.warn(`[${shopDomain}] Previous sync looks stuck, restarting`);
  }

  // Set SYNCING immediately so the UI sees it on the next poll (queue runs async)
  const startedAt = new Date().toISOString();
  await Promise.all([
    db.update(stores).set({ syncStatus: 'SYNCING', updatedAt: startedAt }).where(eq(stores.id, store.id)),
    env.MEDIA_KV.put(
      `sync_progress:${shopDomain}`,
      JSON.stringify({ phase: 'submitting', processed: 0, startedAt, updatedAt: startedAt }),
      { expirationTtl: 86400 },
    ),
  ]);

  await env.FEED_QUEUE.send({
    type: 'bulk-sync',
    shopDomain,
    storeId: store.id,
  });

  return { started: true, storeId: store.id };
}
