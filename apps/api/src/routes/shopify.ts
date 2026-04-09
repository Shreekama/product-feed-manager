import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../db';
import { stores, webhooks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getShopifyToken } from '../services/shopify-auth';

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

// ─── GET /debug ───────────────────────────────────────────────────────────────
// Shows token request result + last sync error in full detail.

shopifyRoutes.get('/debug', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';

  // 1. Try getting a token
  let tokenResult: any;
  try {
    const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: c.env.SHOPIFY_API_KEY,
        client_secret: c.env.SHOPIFY_API_SECRET,
        grant_type: 'client_credentials',
      }),
    });
    const body = await res.text();
    tokenResult = { status: res.status, ok: res.ok, body };
  } catch (err: any) {
    tokenResult = { error: err.message };
  }

  // 2. Last sync progress from KV
  const progress = await c.env.MEDIA_KV.get(`sync_progress:${shopDomain}`, 'json');

  // 3. Store record
  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true, syncStatus: true, lastSyncAt: true },
  });

  return c.json({ tokenResult, lastSyncProgress: progress, store });
});

// ─── GET /install ─────────────────────────────────────────────────────────────

shopifyRoutes.get('/install', (c) => {
  const shop = c.req.query('shop');
  if (!shop) return c.text('Missing shop parameter', 400);

  const apiKey = c.env.SHOPIFY_API_KEY;
  // Derive redirect URI from actual request origin so it matches regardless of APP_URL env var
  const redirectUri = new URL(c.req.url).origin + '/api/shopify/callback';

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

  if (!shop || !code || !hmac) {
    return c.json({ error: 'Missing required OAuth parameters', params: { shop: !!shop, code: !!code, hmac: !!hmac } }, 400);
  }

  // Validate HMAC — key must be API secret, not API key
  const secret = c.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[shopify/callback] SHOPIFY_API_SECRET is not set in Worker secrets');
    return c.json({ error: 'SHOPIFY_API_SECRET not configured' }, 500);
  }

  // Build message: all params except hmac, sorted alphabetically, joined as key=value&...
  // Use the raw query string to avoid any URL-decoding inconsistencies
  const rawSearch = new URL(c.req.url).search.slice(1); // strip leading '?'
  const rawPairs = rawSearch.split('&');
  const filteredPairs = rawPairs
    .filter(pair => !pair.startsWith('hmac='))
    .sort();
  const message = filteredPairs.join('&');

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

  console.log(`[shopify/callback] HMAC check — computed:${computed.slice(0,8)}… received:${hmac.slice(0,8)}… message:${message.slice(0,120)}`);

  if (computed !== hmac) {
    return c.json({
      error: 'Invalid HMAC — SHOPIFY_API_SECRET may be wrong or token copied with whitespace',
      hint: `computed starts with: ${computed.slice(0, 8)}, received starts with: ${hmac.slice(0, 8)}`,
    }, 401);
  }

  // Exchange code for access token (offline token → shpss_...)
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
    const body = await tokenRes.text();
    console.error(`[shopify/callback] Token exchange failed ${tokenRes.status}: ${body}`);
    return c.json({ error: `Token exchange failed (${tokenRes.status})`, detail: body }, 400);
  }

  const tokenData = (await tokenRes.json()) as any;
  const accessToken: string = tokenData.access_token;
  if (!accessToken) {
    return c.json({ error: 'Token exchange returned no access_token', detail: tokenData }, 400);
  }
  console.log(`[shopify/callback] Got access token for ${shop}: ${accessToken.slice(0, 8)}…`);

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
  const appUrl = new URL(c.req.url).origin;
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

  // Enqueue bulk sync — token fetched inflight by consumer
  await c.env.FEED_QUEUE.send({
    type: 'bulk-sync',
    shopDomain: shop,
    storeId: finalStoreId,
  });

  const webUrl = c.env.WEB_URL;
  return c.redirect(`${webUrl}?shop=${shop}&installed=true`);
});

// ─── GET /test ────────────────────────────────────────────────────────────────
// Quick token validation — calls the cheapest possible Shopify API query.

shopifyRoutes.get('/test', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';

  let token: string;
  try {
    token = await getShopifyToken(shopDomain, c.env);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }

  const res = await fetch(`https://${shopDomain}/admin/api/2024-04/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ shop { name } }', variables: {} }),
  });

  const body = await res.text();
  if (!res.ok) return c.json({ ok: false, status: res.status, body }, res.status as any);

  let data: any;
  try { data = JSON.parse(body); } catch { return c.json({ ok: false, error: 'Non-JSON response', body }); }
  if (data.errors?.length) return c.json({ ok: false, errors: data.errors });

  return c.json({ ok: true, shop: data.data?.shop?.name, tokenPrefix: token.slice(0, 8) + '…' });
});

// ─── POST /sync/cancel ────────────────────────────────────────────────────────

shopifyRoutes.post('/sync/cancel', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';
  const db = getDb(c.env);

  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (!store) return c.json({ ok: false, error: 'Store not found' }, 404);

  await Promise.all([
    db.update(stores).set({ syncStatus: 'IDLE', updatedAt: new Date().toISOString() }).where(eq(stores.id, store.id)),
    c.env.MEDIA_KV.delete(`sync_progress:${shopDomain}`),
  ]);

  return c.json({ ok: true, message: 'Sync cancelled — status reset to IDLE' });
});

// ─── GET /store-settings ──────────────────────────────────────────────────────

shopifyRoutes.get('/store-settings', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';
  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { primaryDomain: true },
  });
  return c.json({ primaryDomain: store?.primaryDomain || '' });
});

// ─── PUT /store-settings ──────────────────────────────────────────────────────

shopifyRoutes.put('/store-settings', async (c) => {
  const shopDomain = 'd7f63b.myshopify.com';
  const db = getDb(c.env);
  const { primaryDomain } = await c.req.json<{ primaryDomain: string }>();

  // Normalise: strip protocol and trailing slash
  const cleaned = (primaryDomain || '').replace(/^https?:\/\//, '').replace(/\/$/, '').trim();

  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true },
  });
  if (!store) return c.json({ error: 'Store not found' }, 404);

  await db.update(stores)
    .set({ primaryDomain: cleaned || null, updatedAt: new Date().toISOString() })
    .where(eq(stores.id, store.id));

  return c.json({ primaryDomain: cleaned });
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
    return c.json({ status: 'IDLE', lastSyncAt: null, productCount: 0, progress: null });
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
    return c.json({ message: 'Sync already in progress' }, 202);
  }

  // Set SYNCING immediately so the UI sees it on the next poll (queue runs async)
  const startedAt = new Date().toISOString();
  await Promise.all([
    db.update(stores).set({ syncStatus: 'SYNCING', updatedAt: startedAt }).where(eq(stores.id, store.id)),
    c.env.MEDIA_KV.put(
      `sync_progress:${shopDomain}`,
      JSON.stringify({ phase: 'submitting', processed: 0, startedAt, updatedAt: startedAt }),
      { expirationTtl: 86400 },
    ),
  ]);

  await c.env.FEED_QUEUE.send({
    type: 'bulk-sync',
    shopDomain,
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
