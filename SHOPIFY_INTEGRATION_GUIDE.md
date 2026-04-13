# Shopify Product Fetch — Claude Code Instructions

This guide tells Claude Code exactly how to connect to Shopify and fetch products,
based on the patterns used in this codebase. Paste this into a new project's
`CLAUDE.md` or hand it directly to Claude Code as a prompt.

---

## Overview

The approach uses:
- **No official Shopify SDK** — raw `fetch()` with GraphQL
- **Shopify Bulk Operations API** for large product syncs (most efficient)
- **OAuth 2.0** for authentication (or a bootstrap token for development)
- **Webhooks** for real-time product updates
- **HMAC-SHA256** to validate all webhook payloads

---

## 1. Environment Variables

Create a `.env` (or equivalent secrets store) with:

```env
SHOPIFY_API_KEY=your_shopify_api_key          # From Shopify Partner Dashboard
SHOPIFY_API_SECRET=your_shopify_api_secret    # Used to sign/verify HMAC
SHOPIFY_SCOPES=read_products,read_inventory,read_locations
SHOPIFY_HOST=your-app.ngrok.io                # Public host for OAuth redirect URI
SHOPIFY_STORE_TOKEN=shpss_...                 # Optional: skip OAuth in dev/bootstrap mode
```

The shop domain (e.g. `mystore.myshopify.com`) is typically passed at runtime
per request or stored in the database after OAuth.

---

## 2. Authenticate — OAuth Flow

### Step 1: Initiate OAuth (`GET /install?shop=mystore.myshopify.com`)

```typescript
app.get('/install', (c) => {
  const shop = c.req.query('shop');
  const nonce = crypto.randomUUID(); // CSRF token — store in session/KV
  const redirectUri = `https://${c.env.SHOPIFY_HOST}/callback`;

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${c.env.SHOPIFY_API_KEY}` +
    `&scope=${c.env.SHOPIFY_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${nonce}`;

  return c.redirect(authUrl);
});
```

### Step 2: Handle Callback (`GET /callback`)

```typescript
app.get('/callback', async (c) => {
  const { code, shop, state, hmac } = c.req.query();

  // 1. Validate HMAC — remove hmac from params, sort keys, SHA256 sign with API_SECRET
  const params = Object.fromEntries(
    Object.entries(c.req.query()).filter(([k]) => k !== 'hmac')
  );
  const message = Object.keys(params).sort()
    .map((k) => `${k}=${params[k]}`).join('&');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(c.env.SHOPIFY_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected !== hmac) return c.text('Invalid HMAC', 403);

  // 2. Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.SHOPIFY_API_KEY,
      client_secret: c.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  const { access_token } = await tokenRes.json<{ access_token: string }>();

  // 3. Persist: store { shopDomain: shop, accessToken: access_token } in your DB
  await saveStoreToken(shop, access_token, c.env.DB);

  return c.text('Installed!');
});
```

### Bootstrap Mode (dev / single-store)

Skip OAuth entirely — accept a pre-generated token directly:

```typescript
app.post('/bootstrap', async (c) => {
  const { shopDomain, accessToken } = await c.req.json();
  const token = accessToken || c.env.SHOPIFY_STORE_TOKEN;
  await saveStoreToken(shopDomain, token, c.env.DB);
  return c.json({ ok: true });
});
```

---

## 3. Make Authenticated GraphQL Requests

All Shopify Admin API calls go to:
```
POST https://{shopDomain}/admin/api/2024-04/graphql.json
Headers:
  Content-Type: application/json
  X-Shopify-Access-Token: {accessToken}
```

Helper with retry + rate-limit handling:

```typescript
async function shopifyGraphql(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retries = 3
): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(
      `https://${shopDomain}/admin/api/2024-04/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (res.status === 429) {
      // Respect rate limit header
      const retryAfter = Number(res.headers.get('retry-after') || 2);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify GraphQL error: ${res.status}`);

    const json = await res.json<{ data: unknown; errors?: unknown[] }>();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error('Max retries exceeded');
}
```

---

## 4. Fetch Products — Bulk Operations API (Recommended)

For stores with many products (hundreds+), use Shopify's Bulk Operations API.
It is a 3-step async process: **submit → poll → download**.

### Step 1: Submit the Bulk Query

```typescript
const BULK_QUERY = `
  mutation {
    bulkOperationRunQuery(
      query: """
      {
        products {
          edges {
            node {
              id
              title
              handle
              vendor
              productType
              status
              tags
              bodyHtml
              publishedAt
              variants {
                edges {
                  node {
                    id
                    sku
                    title
                    price
                    compareAtPrice
                    barcode
                    taxable
                    availableForSale
                    inventoryQuantity
                    position
                  }
                }
              }
              images {
                edges {
                  node {
                    id
                    url
                    altText
                    width
                    height
                  }
                }
              }
              metafields {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        }
      }
      """
    ) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const data = await shopifyGraphql(shopDomain, accessToken, BULK_QUERY) as any;
const operationId = data.bulkOperationRunQuery.bulkOperation.id;
```

### Step 2: Poll for Completion

```typescript
const POLL_QUERY = `
  query {
    currentBulkOperation {
      id
      status
      errorCode
      objectCount
      url
    }
  }
`;

async function waitForBulkOperation(shopDomain: string, accessToken: string) {
  const MAX_ATTEMPTS = 72; // ~12 minutes at 10s intervals
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const data = await shopifyGraphql(shopDomain, accessToken, POLL_QUERY) as any;
    const op = data.currentBulkOperation;
    if (op.status === 'COMPLETED') return op.url as string;
    if (op.status === 'FAILED' || op.status === 'CANCELED')
      throw new Error(`Bulk operation ${op.status}: ${op.errorCode}`);
  }
  throw new Error('Bulk operation timed out');
}
```

### Step 3: Download and Parse the JSONL File

Shopify returns a JSONL file where each line is a node. Child nodes include
a `__parentId` field linking them to their parent product.

```typescript
async function processBulkResult(downloadUrl: string) {
  const res = await fetch(downloadUrl);
  const text = await res.text();

  const products = new Map<string, any>();
  const variants: any[] = [];
  const images: any[] = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const node = JSON.parse(line);

    if (node.__parentId) {
      // Child node — route by type
      if (node.id?.includes('/ProductVariant/')) {
        variants.push({ ...node, productId: node.__parentId });
      } else if (node.id?.includes('/MediaImage/') || node.url) {
        images.push({ ...node, productId: node.__parentId });
      }
    } else {
      // Top-level product node
      products.set(node.id, node);
    }
  }

  return { products: [...products.values()], variants, images };
}
```

### Full Sync Orchestration

```typescript
async function syncProducts(shopDomain: string, accessToken: string) {
  // 1. Submit
  const data = await shopifyGraphql(shopDomain, accessToken, BULK_QUERY) as any;
  const opId = data.bulkOperationRunQuery.bulkOperation.id;

  // 2. Poll
  const downloadUrl = await waitForBulkOperation(shopDomain, accessToken);

  // 3. Process
  const { products, variants, images } = await processBulkResult(downloadUrl);

  // 4. Persist to your database
  await upsertProducts(products);
  await upsertVariants(variants);
  await upsertImages(images);
}
```

---

## 5. Fetch Products — Simple Paginated REST (Small Stores)

For small stores or quick lookups, use the REST API with cursor pagination:

```typescript
async function fetchAllProductsRest(shopDomain: string, accessToken: string) {
  const products: any[] = [];
  let url: string | null =
    `https://${shopDomain}/admin/api/2024-04/products.json?limit=250&fields=id,title,handle,variants,images,status`;

  while (url) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    const data = await res.json<{ products: any[] }>();
    products.push(...data.products);

    // Parse Link header for next page cursor
    const link = res.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    url = next;
  }

  return products;
}
```

---

## 6. Real-Time Updates — Webhooks

### Register Webhooks After OAuth

```typescript
const WEBHOOK_TOPICS = [
  'products/create',
  'products/update',
  'products/delete',
];

async function registerWebhooks(shopDomain: string, accessToken: string, host: string) {
  for (const topic of WEBHOOK_TOPICS) {
    await shopifyGraphql(shopDomain, accessToken, `
      mutation {
        webhookSubscriptionCreate(
          topic: ${topic.replace('/', '_').toUpperCase()}
          webhookSubscription: {
            format: JSON
            callbackUrl: "https://${host}/webhooks/${topic.replace('/', '-')}"
          }
        ) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }
    `);
  }
}
```

### Handle Webhook Payloads

```typescript
// Middleware: validate HMAC before processing any webhook
async function validateWebhookHmac(c: Context, next: Next) {
  const rawBody = await c.req.text();
  const hmacHeader = c.req.header('x-shopify-hmac-sha256');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(c.env.SHOPIFY_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (computed !== hmacHeader) return c.text('Unauthorized', 401);
  await next();
}

// Webhook handlers
app.post('/webhooks/products-create', validateWebhookHmac, async (c) => {
  const product = await c.req.json();
  await upsertProduct(product);
  return c.text('OK');
});

app.post('/webhooks/products-update', validateWebhookHmac, async (c) => {
  const product = await c.req.json();
  await upsertProduct(product);
  return c.text('OK');
});

app.post('/webhooks/products-delete', validateWebhookHmac, async (c) => {
  const { id } = await c.req.json();
  await deleteProduct(id);
  return c.text('OK');
});
```

---

## 7. Recommended Database Schema

```sql
CREATE TABLE stores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shopify_id   TEXT NOT NULL,
  store_id     INTEGER NOT NULL REFERENCES stores(id),
  title        TEXT,
  handle       TEXT,
  vendor       TEXT,
  product_type TEXT,
  status       TEXT,         -- active | draft | archived
  tags         TEXT,         -- JSON array stored as string
  body_html    TEXT,
  published_at TEXT,
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(shopify_id, store_id)
);

CREATE TABLE variants (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  shopify_id         TEXT NOT NULL,
  product_id         INTEGER NOT NULL REFERENCES products(id),
  sku                TEXT,
  title              TEXT,
  price              TEXT,
  compare_at_price   TEXT,
  barcode            TEXT,
  inventory_quantity INTEGER DEFAULT 0,
  available_for_sale INTEGER DEFAULT 1,
  position           INTEGER,
  UNIQUE(shopify_id, product_id)
);

CREATE TABLE product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shopify_id TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  url        TEXT,
  alt_text   TEXT,
  width      INTEGER,
  height     INTEGER,
  position   INTEGER,
  UNIQUE(shopify_id, product_id)
);
```

---

## 8. Key Implementation Decisions

| Decision | What this app does | Why |
|---|---|---|
| SDK | No `@shopify/shopify-api` — raw `fetch()` | Fewer deps, works in edge runtimes (Cloudflare Workers) |
| API style | GraphQL Bulk Operations for sync | Handles 100k+ products in one call |
| Pagination (REST) | `Link` header cursor | REST API max 250/page |
| Auth storage | Access token in DB per store | Supports multi-store |
| Token cache | KV store, 24h TTL | Avoid hitting Shopify token endpoint on every request |
| Webhook security | HMAC-SHA256 on raw body | Required by Shopify — validate before parsing |
| Real-time sync | Webhooks for creates/updates/deletes | Near-instant instead of polling |
| Bulk result | Stream JSONL line-by-line | Avoids loading full file into memory |

---

## 9. Shopify App Setup Checklist

1. Go to [Shopify Partners Dashboard](https://partners.shopify.com) → Apps → Create App
2. Set **App URL**: `https://{your-host}`
3. Set **Allowed redirect URLs**: `https://{your-host}/callback`
4. Copy **API Key** → `SHOPIFY_API_KEY`
5. Copy **API Secret** → `SHOPIFY_API_SECRET`
6. For development, use [ngrok](https://ngrok.com) and set `SHOPIFY_HOST` to your ngrok URL
7. Install the app on a development store via `/install?shop={store}.myshopify.com`
