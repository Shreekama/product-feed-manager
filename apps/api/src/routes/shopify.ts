import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../db';
import { stores, webhooks } from '../db/schema';
import { eq } from 'drizzle-orm';

export const shopifyRoutes = new Hono<{ Bindings: Env }>();

const REQUIRED_WEBHOOKS = [
  'products/create',
  'products/update',
  'products/delete',
  'inventory_levels/update',
] as const;

const API_VERSION = '2024-04';
const SCOPES = [
  'read_products',
  'write_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
].join(',');

// ─── POST /bootstrap ─────────────────────────────────────────────────────────
// One-time endpoint to register the store when bypassing the OAuth flow.
// Pass the Shopify access token in the body, or set SHOPIFY_STORE_TOKEN env var.
// Visit once: POST /api/shopify/bootstrap  (body optional if env var is set)

shopifyRoutes.post('/bootstrap', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';

  let accessToken: string | undefined;
  try {
    const body = await c.req.json<{ accessToken?: string }>();
    accessToken = body.accessToken;
  } catch { /* body is optional */ }

  // Fall back to env var if not provided in body
  accessToken = accessToken || c.env.SHOPIFY_STORE_TOKEN;

  if (!accessToken) {
    return c.json({
      error: 'No access token provided. Pass { "accessToken": "shpat_..." } in the body, or set SHOPIFY_STORE_TOKEN in your Worker environment variables.',
    }, 400);
  }

  const db = getDb(c.env);
  const existing = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (existing) {
    // Update the access token
    await db.update(stores)
      .set({ accessToken, updatedAt: new Date().toISOString() })
      .where(eq(stores.id, existing.id));
    return c.json({ ok: true, message: `Store ${shopDomain} updated.`, storeId: existing.id });
  }

  const storeId = crypto.randomUUID();
  await db.insert(stores).values({
    id: storeId,
    shopDomain,
    accessToken,
    syncStatus: 'IDLE',
  });

  return c.json({ ok: true, message: `Store ${shopDomain} registered. You can now trigger a sync.`, storeId });
});

// ─── GET /install ─────────────────────────────────────────────────────────────

shopifyRoutes.get('/install', (c) => {
  const shop = c.req.query('shop');
  if (!shop) return c.text('Missing shop parameter', 400);

  const apiKey = c.env.SHOPIFY_API_KEY;
  const redirectUri = `${c.env.APP_URL}/api/shopify/callback`;

  // Generate a nonce for CSRF protection
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${apiKey}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${nonce}`;

  return c.redirect(authUrl);
});

// ─── GET /callback ────────────────────────────────────────────────────────────

shopifyRoutes.get('/callback', async (c) => {
  const shop = c.req.query('shop');
  const code = c.req.query('code');
  const hmac = c.req.query('hmac');
  const allParams = c.req.query();

  if (!shop || !code || !hmac) {
    return c.text('Missing required OAuth parameters', 400);
  }

  // Validate HMAC
  const secret = c.env.SHOPIFY_API_SECRET;
  const { hmac: _hmac, ...rest } = allParams;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (computed !== hmac) {
    return c.text('Invalid HMAC', 401);
  }

  // Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.SHOPIFY_API_KEY,
      client_secret: secret,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return c.text('Token exchange failed', 400);
  }

  const tokenData = (await tokenRes.json()) as any;
  const accessToken: string = tokenData.access_token;
  if (!accessToken) return c.text('Token exchange failed', 400);

  // Upsert store
  const db = getDb(c.env);
  const storeId = crypto.randomUUID();
  const existing = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shop),
    columns: { id: true },
  });

  let finalStoreId: string;
  if (existing) {
    await db.update(stores).set({ accessToken, updatedAt: new Date().toISOString() }).where(eq(stores.id, existing.id));
    finalStoreId = existing.id;
  } else {
    await db.insert(stores).values({
      id: storeId,
      shopDomain: shop,
      accessToken,
      syncStatus: 'IDLE',
    });
    finalStoreId = storeId;
  }

  // Register webhooks
  const appUrl = c.env.APP_URL;
  for (const topic of REQUIRED_WEBHOOKS) {
    try {
      const address = `${appUrl}/api/webhooks/${topic.replace('/', '-').replace('_', '-')}`;
      const webhookResult = await registerShopifyWebhook(
        shop,
        accessToken,
        topic,
        address,
      );

      if (webhookResult) {
        const wId = crypto.randomUUID();
        const existingWebhook = await db.query.webhooks.findFirst({
          where: (w, { and, eq: eq2 }) =>
            and(eq2(w.storeId, finalStoreId), eq2(w.topic, topic)),
          columns: { id: true },
        });

        if (existingWebhook) {
          await db
            .update(webhooks)
            .set({ shopifyId: webhookResult, address, updatedAt: new Date().toISOString() })
            .where(eq(webhooks.id, existingWebhook.id));
        } else {
          await db.insert(webhooks).values({
            id: wId,
            storeId: finalStoreId,
            shopifyId: webhookResult,
            topic,
            address,
          });
        }
      }
    } catch (_err) {
      // Non-fatal webhook registration failure
      console.error(`Failed to register webhook ${topic}:`, _err);
    }
  }

  // Enqueue bulk sync
  await c.env.FEED_QUEUE.send({
    type: 'bulk-sync',
    shopDomain: shop,
    accessToken,
    storeId: finalStoreId,
  });

  const webUrl = c.env.WEB_URL;
  return c.redirect(`${webUrl}?shop=${shop}&installed=true`);
});

// ─── GET /sync/status ─────────────────────────────────────────────────────────

shopifyRoutes.get('/sync/status', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';
  const db = getDb(c.env);

  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true, syncStatus: true, lastSyncAt: true },
  });

  if (!store) {
    return c.json({ status: 'NOT_CONNECTED', lastSyncAt: null, productCount: 0, progress: null });
  }

  const [progress, countRow] = await Promise.all([
    c.env.MEDIA_KV.get<any>(`sync_progress:${shopDomain}`, 'json'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM products WHERE store_id = ?')
      .bind(store.id).first<{ count: number }>(),
  ]);

  return c.json({
    status: store.syncStatus,
    lastSyncAt: store.lastSyncAt || null,
    productCount: countRow?.count ?? 0,
    progress,
  });
});

// ─── POST /sync ───────────────────────────────────────────────────────────────

shopifyRoutes.post('/sync', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';

  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true, accessToken: true, syncStatus: true },
  });

  if (!store) return c.json({ error: 'Store not found' }, 404);

  if (store.syncStatus === 'SYNCING') {
    return c.json({ message: 'Sync already in progress' }, 202);
  }

  await c.env.FEED_QUEUE.send({
    type: 'bulk-sync',
    shopDomain,
    accessToken: store.accessToken,
    storeId: store.id,
  });

  return c.json({ message: 'Sync started', storeId: store.id }, 202);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerShopifyWebhook(
  shopDomain: string,
  accessToken: string,
  topic: string,
  address: string,
): Promise<string | null> {
  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }
  `;

  const res = await fetch(
    `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          topic: topic.toUpperCase().replace('/', '_'),
          webhookSubscription: { callbackUrl: address, format: 'JSON' },
        },
      }),
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as any;
  const result = data?.data?.webhookSubscriptionCreate;
  if (result?.userErrors?.length) return null;
  return result?.webhookSubscription?.id ?? null;
}
