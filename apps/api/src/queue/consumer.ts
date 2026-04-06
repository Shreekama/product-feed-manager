import type { Env } from '../types';
import { getDb } from '../db';
import { stores, products, variants, inventoryLevels, metafields, productImages, feedRuns, feedSchedules } from '../db/schema';
import { eq } from 'drizzle-orm';
import { buildRow, type ColumnMapping } from '../services/feed-mapping';
import { getShopifyToken } from '../services/shopify-auth';

/** Strip everything from '?' onwards in a Shopify CDN URL */
function stripQuery(url: string | null | undefined): string {
  if (!url) return '';
  const q = url.indexOf('?');
  return q !== -1 ? url.slice(0, q) : url;
}
import { generateCsv } from '../generators/csv';
import { generateXml } from '../generators/xml';
import { generateSheets } from '../generators/sheets';
import { Cron } from 'croner';

export const feedQueueConsumer: ExportedHandlerQueueHandler<Env> = async (
  batch,
  env,
) => {
  for (const msg of batch.messages) {
    const { type, ...data } = msg.body as any;
    try {
      if (type === 'bulk-sync') {
        await handleBulkSync(data, env);
      } else if (type === 'feed-job') {
        await handleFeedJob(data, env);
      }
      msg.ack();
    } catch (err) {
      console.error(`Queue message failed [${type}]:`, err);
      msg.retry();
    }
  }
};

// ─── Bulk Sync Handler ────────────────────────────────────────────────────────

const PROGRESS_TTL = 3600; // 1 hour

async function setProgress(env: Env, shopDomain: string, data: object) {
  await env.MEDIA_KV.put(
    `sync_progress:${shopDomain}`,
    JSON.stringify({ ...data, updatedAt: new Date().toISOString() }),
    { expirationTtl: PROGRESS_TTL },
  );
}

async function handleBulkSync(
  data: { shopDomain: string; storeId: string; accessToken?: string },
  env: Env,
): Promise<void> {
  const { shopDomain, storeId } = data;
  const db = getDb(env);
  const startedAt = new Date().toISOString();

  console.log(`[${shopDomain}] Starting bulk sync`);

  await Promise.all([
    db.update(stores).set({ syncStatus: 'SYNCING', updatedAt: startedAt }).where(eq(stores.id, storeId)),
    setProgress(env, shopDomain, { phase: 'submitting', processed: 0, startedAt }),
  ]);

  try {
    // Fetch token inside try so failures are caught and surfaced to KV progress
    const accessToken = await getShopifyToken(shopDomain, env);

    const operationId = await submitBulkOperation(shopDomain, accessToken);
    await setProgress(env, shopDomain, { phase: 'waiting', processed: 0, startedAt });

    const downloadUrl = await pollBulkOperation(shopDomain, accessToken, operationId);

    if (!downloadUrl) {
      console.warn(`[${shopDomain}] Bulk op returned no data`);
      await setProgress(env, shopDomain, { phase: 'done', processed: 0, startedAt });
      await markSyncDone(db, storeId);
      return;
    }

    await setProgress(env, shopDomain, { phase: 'processing', processed: 0, startedAt });
    const processed = await processJsonlStream(downloadUrl, storeId, db, env, shopDomain, startedAt);
    await setProgress(env, shopDomain, { phase: 'done', processed, startedAt });
    await markSyncDone(db, storeId);
    console.log(`[${shopDomain}] Bulk sync completed — ${processed} products`);
  } catch (err: any) {
    console.error(`[${shopDomain}] Bulk sync failed:`, err);
    await Promise.all([
      db.update(stores).set({ syncStatus: 'FAILED', updatedAt: new Date().toISOString() }).where(eq(stores.id, storeId)),
      setProgress(env, shopDomain, { phase: 'failed', error: err.message, startedAt }),
    ]);
    throw err;
  }
}

async function submitBulkOperation(
  shopDomain: string,
  accessToken: string,
): Promise<string> {
  const mutation = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products {
            edges {
              node {
                id title vendor productType handle status tags bodyHtml publishedAt
                images {
                  edges {
                    node {
                      id url altText width height
                    }
                  }
                }
                variants {
                  edges {
                    node {
                      id sku title price compareAtPrice barcode
                      taxable position availableForSale inventoryQuantity
                      image { url altText }
                      selectedOptions { name value }
                      inventoryItem { id }
                    }
                  }
                }
                metafields {
                  edges { node { id namespace key value type } }
                }
              }
            }
          }
        }
        """
      ) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }
  `;

  const res = await shopifyGraphql(shopDomain, accessToken, mutation, {});
  const { bulkOperation, userErrors } = res.bulkOperationRunQuery;

  if (userErrors?.length) {
    throw new Error(`Bulk op failed: ${JSON.stringify(userErrors)}`);
  }

  return bulkOperation.id;
}

async function pollBulkOperation(
  shopDomain: string,
  accessToken: string,
  _operationId: string,
): Promise<string | null> {
  const statusQuery = `
    query {
      currentBulkOperation {
        id status errorCode url objectCount
      }
    }
  `;

  const maxAttempts = 120; // 6 minutes at 3s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(3000);
    const result = await shopifyGraphql(shopDomain, accessToken, statusQuery, {});
    const op = result.currentBulkOperation;

    if (op.status === 'COMPLETED') return op.url;
    if (['FAILED', 'CANCELED'].includes(op.status)) {
      throw new Error(`Bulk op ${op.status}: ${op.errorCode}`);
    }
  }

  throw new Error('Bulk operation timed out');
}

async function processJsonlStream(
  downloadUrl: string,
  storeId: string,
  db: any,
  env: Env,
  shopDomain: string,
  startedAt: string,
): Promise<number> {
  const res = await fetch(downloadUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch bulk result: ${res.status}`);
  }

  const productBuffer: any[] = [];
  const variantBuffer: Array<{ raw: any; parentShopifyId: string }> = [];
  const metafieldBuffer: any[] = [];
  const imageBuffer: any[] = []; // product images

  const productMap = new Map<string, string>(); // shopifyProductId → dbId
  let totalProcessed = 0;

  // Stream JSONL using TextDecoderStream
  const reader = res.body
    .pipeThrough(new TextDecoderStream())
    .getReader();

  let buffer = '';
  const BATCH_SIZE = 200;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let node: any;
      try {
        node = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (node.title !== undefined && node.vendor !== undefined && !node.__parentId) {
        productBuffer.push(mapProductNode(node, storeId));
      } else if (node.sku !== undefined && node.__parentId) {
        variantBuffer.push({ raw: node, parentShopifyId: node.__parentId });
      } else if (node.namespace !== undefined && node.__parentId) {
        metafieldBuffer.push(node);
      } else if (node.url !== undefined && node.__parentId) {
        // Product image node
        imageBuffer.push(node);
      }

      if (productBuffer.length >= BATCH_SIZE) {
        const batch = productBuffer.splice(0);
        await upsertProductBatch(batch, productMap, db);
        totalProcessed += batch.length;
        await setProgress(env, shopDomain, { phase: 'processing', processed: totalProcessed, startedAt });
      }
    }
  }

  // Flush remaining line in buffer
  if (buffer.trim()) {
    try {
      const node = JSON.parse(buffer.trim());
      if (node.title !== undefined && !node.__parentId) {
        productBuffer.push(mapProductNode(node, storeId));
      }
    } catch { /* ignore */ }
  }

  if (productBuffer.length > 0) {
    await upsertProductBatch(productBuffer, productMap, db);
    totalProcessed += productBuffer.length;
  }

  await upsertVariantBatch(variantBuffer, storeId, productMap, db);
  await upsertMetafieldBatch(metafieldBuffer, productMap, db);
  await upsertImageBatch(imageBuffer, productMap, db);
  return totalProcessed;
}

function mapProductNode(node: any, storeId: string) {
  const tags = Array.isArray(node.tags)
    ? JSON.stringify(node.tags)
    : JSON.stringify(typeof node.tags === 'string' ? node.tags.split(', ').filter(Boolean) : []);

  return {
    shopifyId: node.id,
    storeId,
    title: node.title,
    vendor: node.vendor || null,
    productType: node.productType || null,
    handle: node.handle || null,
    status: (node.status || 'ACTIVE').toLowerCase(),
    tags,
    bodyHtml: node.bodyHtml || null,
    publishedAt: node.publishedAt || null,
  };
}

async function upsertProductBatch(
  productNodes: any[],
  productMap: Map<string, string>,
  db: any,
): Promise<void> {
  for (const p of productNodes) {
    const existing = await db.query.products.findFirst({
      where: (prod: any, { and: a, eq: e }: any) =>
        a(e(prod.shopifyId, p.shopifyId), e(prod.storeId, p.storeId)),
      columns: { id: true },
    });

    let productId: string;
    if (existing) {
      productId = existing.id;
      await db.update(products).set({ ...p, updatedAt: new Date().toISOString() }).where(eq(products.id, productId));
    } else {
      productId = crypto.randomUUID();
      await db.insert(products).values({ id: productId, ...p });
    }

    productMap.set(p.shopifyId, productId);
  }
}

async function upsertVariantBatch(
  variantBuffer: Array<{ raw: any; parentShopifyId: string }>,
  _storeId: string,
  productMap: Map<string, string>,
  db: any,
): Promise<void> {
  for (const { raw, parentShopifyId } of variantBuffer) {
    const productId = productMap.get(parentShopifyId);
    if (!productId) continue;

    const opts = raw.selectedOptions || [];
    const shopifyVariantId = raw.id;

    const variantData = {
      shopifyId: shopifyVariantId,
      productId,
      sku: raw.sku || null,
      title: raw.title,
      price: String(raw.price || '0'),
      compareAtPrice: raw.compareAtPrice ? String(raw.compareAtPrice) : null,
      inventoryItemId: raw.inventoryItem?.id || null,
      inventoryQuantity: raw.inventoryQuantity ?? 0,
      barcode: raw.barcode || null,
      taxable: raw.taxable ?? true,
      availableForSale: raw.availableForSale ?? true,
      position: raw.position || 1,
      option1: opts[0]?.value || null,
      option2: opts[1]?.value || null,
      option3: opts[2]?.value || null,
      imageSrc: stripQuery(raw.image?.url) || null,
      updatedAt: new Date().toISOString(),
    };

    const existingVariant = await db.query.variants.findFirst({
      where: (v: any, { and: a, eq: e }: any) =>
        a(e(v.shopifyId, shopifyVariantId), e(v.productId, productId)),
      columns: { id: true },
    });

    let variantId: string;
    if (existingVariant) {
      variantId = existingVariant.id;
      await db.update(variants).set(variantData).where(eq(variants.id, variantId));
    } else {
      variantId = crypto.randomUUID();
      await db.insert(variants).values({ id: variantId, ...variantData });
    }

  }
}

async function upsertImageBatch(
  imageNodes: any[],
  productMap: Map<string, string>,
  db: any,
): Promise<void> {
  // Group by product so we can assign position
  const byProduct = new Map<string, any[]>();
  for (const img of imageNodes) {
    const pid = img.__parentId;
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid)!.push(img);
  }

  for (const [shopifyProductId, images] of byProduct) {
    const productId = productMap.get(shopifyProductId);
    if (!productId) continue;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const src = stripQuery(img.url);
      if (!src) continue;

      const existing = await db.query.productImages.findFirst({
        where: (pi: any, { and: a, eq: e }: any) =>
          a(e(pi.shopifyId, img.id), e(pi.productId, productId)),
        columns: { id: true },
      });

      if (existing) {
        await db.update(productImages)
          .set({ src, altText: img.altText || null, width: img.width || null, height: img.height || null, position: i + 1 })
          .where(eq(productImages.id, existing.id));
      } else {
        await db.insert(productImages).values({
          id: crypto.randomUUID(),
          productId,
          shopifyId: img.id,
          src,
          altText: img.altText || null,
          width: img.width || null,
          height: img.height || null,
          position: i + 1,
        });
      }
    }
  }
}

async function upsertMetafieldBatch(
  metafieldNodes: any[],
  productMap: Map<string, string>,
  db: any,
): Promise<void> {
  for (const mf of metafieldNodes) {
    const productId = productMap.get(mf.__parentId);
    if (!productId) continue;

    const existing = await db.query.metafields.findFirst({
      where: (m: any, { eq: e }: any) => e(m.shopifyId, mf.id),
      columns: { id: true },
    });

    if (existing) {
      await db
        .update(metafields)
        .set({ value: String(mf.value), type: mf.type, updatedAt: new Date().toISOString() })
        .where(eq(metafields.id, existing.id));
    } else {
      await db.insert(metafields).values({
        id: crypto.randomUUID(),
        productId,
        shopifyId: mf.id,
        namespace: mf.namespace,
        key: mf.key,
        value: String(mf.value),
        type: mf.type,
      });
    }
  }
}

async function markSyncDone(db: any, storeId: string): Promise<void> {
  await db
    .update(stores)
    .set({
      syncStatus: 'IDLE',
      lastSyncAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(stores.id, storeId));
}

// ─── Feed Job Handler ─────────────────────────────────────────────────────────

async function handleFeedJob(
  data: { feedId: string; runId: string; storeId: string },
  env: Env,
): Promise<void> {
  const { feedId, runId, storeId } = data;
  const db = getDb(env);
  const startTime = Date.now();

  // Mark run as RUNNING
  await db
    .update(feedRuns)
    .set({ status: 'RUNNING' })
    .where(eq(feedRuns.id, runId));

  try {
    const feed = await db.query.feeds.findFirst({
      where: (f, { eq: e }) => e(f.id, feedId),
      with: { schedule: true },
    });

    if (!feed) throw new Error(`Feed ${feedId} not found`);

    const store = await db.query.stores.findFirst({
      where: (s, { eq: e }) => e(s.id, storeId),
      columns: { shopDomain: true },
    });

    if (!store) throw new Error(`Store ${storeId} not found`);

    const columnMappings: ColumnMapping[] = JSON.parse(feed.columnMappings || '[]');
    const filterRules: any[] = JSON.parse(feed.filterRules || '[]');

    if (columnMappings.length === 0) {
      throw new Error('Feed has no column mappings configured');
    }

    // Fetch all active variants for this store
    const allVariants = await db.query.variants.findMany({
      where: (v: any, { eq: e }: any) =>
        e((v as any).productId, undefined), // placeholder; use join below
    });

    // Use direct Drizzle query for variants with product join
    const allVariantsWithProducts = await db.query.variants.findMany({
      with: {
        product: {
          with: {
            metafields: true,
            collections: { with: { collection: true } },
            images: { orderBy: (img: any, { asc }: any) => [asc(img.position)] },
          },
          where: (p: any, { and: a, eq: e }: any) =>
            a(e(p.storeId, storeId), e(p.status, 'active'), e(p.excludeFromFeeds, false)),
        },
        inventoryLevels: true,
      },
      orderBy: (v, { asc }) => [asc(v.position)],
    });

    // Filter out variants where product didn't match (null product)
    const activeVariants = allVariantsWithProducts.filter((v) => v.product !== null);

    // Apply filter rules
    const filtered = applyFilters(activeVariants, filterRules);

    // Images come directly from DB (Shopify CDN URLs, query params already stripped)
    const mediaMap = new Map<string, any>();

    // Map each variant to a feed row
    const headers = columnMappings.map((m) => m.feedColumn);
    const rows: Record<string, string>[] = [];

    const BATCH_SIZE = 500;
    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      const batchRows = await Promise.all(
        batch.map((variant) =>
          buildRow(variant, columnMappings, mediaMap, env, store.shopDomain),
        ),
      );
      rows.push(...batchRows);
    }

    // Generate output
    let outputUrl: string | null = null;

    if (feed.outputType === 'CSV') {
      const result = await generateCsv(headers, rows, feed.name, env);
      outputUrl = result.publicUrl;
    } else if (feed.outputType === 'XML') {
      const result = await generateXml(headers, rows, feed.name, feed.platform, env);
      outputUrl = result.publicUrl;
    } else if (feed.outputType === 'GOOGLE_SHEETS') {
      if (!feed.googleSheetId) throw new Error('Google Sheet ID not configured');
      const result = await generateSheets(
        storeId,
        feed.googleSheetId,
        feed.googleSheetTab || 'Feed',
        headers,
        rows,
        env,
      );
      outputUrl = result.sheetUrl;
    }

    const durationMs = Date.now() - startTime;

    // Mark run as SUCCESS
    await db
      .update(feedRuns)
      .set({
        status: 'SUCCESS',
        recordsProcessed: rows.length,
        recordsSkipped: activeVariants.length - filtered.length,
        completedAt: new Date().toISOString(),
        durationMs,
        outputUrl,
      })
      .where(eq(feedRuns.id, runId));

    // Advance schedule
    if (feed.schedule?.isActive) {
      try {
        const cron = new Cron(feed.schedule.cronExpr);
        const nextRunAt = cron.nextRun()?.toISOString();
        if (nextRunAt) {
          await db
            .update(feedSchedules)
            .set({ nextRunAt, updatedAt: new Date().toISOString() })
            .where(eq(feedSchedules.id, feed.schedule.id));
        }
      } catch { /* Non-fatal */ }
    }

    console.log(
      `Feed "${feed.name}" completed: ${rows.length} rows in ${durationMs}ms`,
    );
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    await db
      .update(feedRuns)
      .set({
        status: 'FAILED',
        errorMessage: err.message,
        completedAt: new Date().toISOString(),
        durationMs,
      })
      .where(eq(feedRuns.id, runId));
    throw err;
  }
}

// ─── Filter Engine ────────────────────────────────────────────────────────────

function applyFilters(variants: any[], rules: any[]): any[] {
  if (!rules.length) return variants;

  return variants.filter((variant) => {
    return rules.every((rule) => {
      const value = resolveFilterField(variant, rule.field);
      return evaluateRule(value, rule.operator, rule.value);
    });
  });
}

function resolveFilterField(variant: any, field: string): any {
  const product = variant.product;
  const totalInventory = variant.inventoryQuantity ?? (variant.inventoryLevels || []).reduce(
    (s: number, l: any) => s + (l.available || 0),
    0,
  );

  const fieldMap: Record<string, any> = {
    vendor: product?.vendor,
    product_type: product?.productType,
    status: product?.status,
    sku: variant.sku,
    price: parseFloat(variant.price),
    inventory: totalInventory,
  };
  return fieldMap[field] ?? null;
}

function evaluateRule(value: any, operator: string, ruleValue: string): boolean {
  const strVal = String(value ?? '').toLowerCase();
  const ruleStr = ruleValue.toLowerCase();

  switch (operator) {
    case 'eq':       return strVal === ruleStr;
    case 'neq':      return strVal !== ruleStr;
    case 'contains': return strVal.includes(ruleStr);
    case 'gt':       return parseFloat(String(value)) > parseFloat(ruleValue);
    case 'lt':       return parseFloat(String(value)) < parseFloat(ruleValue);
    case 'gte':      return parseFloat(String(value)) >= parseFloat(ruleValue);
    case 'lte':      return parseFloat(String(value)) <= parseFloat(ruleValue);
    case 'in':
      return ruleValue
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .includes(strVal);
    default:
      return true;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function shopifyGraphql(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, any>,
  retries = 3,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(
      `https://${shopDomain}/admin/api/2024-04/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10) * 1000;
      await sleep(retryAfter);
      continue;
    }

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      if (res.status === 401) {
        throw new Error(`Shopify API 401 Unauthorized — token is invalid or lacks required scopes. Body: ${body}`);
      }
      throw new Error(`Shopify GraphQL HTTP ${res.status}: ${body}`);
    }

    const data = (await res.json()) as any;

    if (data.errors?.length) {
      const throttled = data.errors.find((e: any) =>
        e.message?.toLowerCase().includes('throttled'),
      );
      if (throttled && attempt < retries) {
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

  throw new Error('Max retries exceeded for Shopify GraphQL request');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
