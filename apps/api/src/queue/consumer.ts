import type { Env } from '../types';
import { getDb } from '../db';
import { stores, products, variants, inventoryLevels, metafields, feedRuns, feedSchedules } from '../db/schema';
import { eq } from 'drizzle-orm';
import { resolveForSkus } from '../services/media';
import { buildRow, type ColumnMapping } from '../services/feed-mapping';
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
  data: { shopDomain: string; accessToken: string; storeId: string },
  env: Env,
): Promise<void> {
  const { shopDomain, accessToken, storeId } = data;
  const db = getDb(env);
  const startedAt = new Date().toISOString();

  console.log(`[${shopDomain}] Starting bulk sync`);

  await Promise.all([
    db.update(stores).set({ syncStatus: 'SYNCING', updatedAt: startedAt }).where(eq(stores.id, storeId)),
    setProgress(env, shopDomain, { phase: 'submitting', processed: 0, startedAt }),
  ]);

  try {
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
                variants {
                  edges {
                    node {
                      id sku title price compareAtPrice weight weightUnit barcode
                      taxable requiresShipping position
                      selectedOptions { name value }
                      inventoryItem {
                        id
                        inventoryLevels {
                          edges { node { id available location { id } } }
                        }
                      }
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
  const inventoryBuffer: any[] = [];
  const metafieldBuffer: any[] = [];

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
      } else if (node.available !== undefined && node.__parentId) {
        inventoryBuffer.push(node);
      } else if (node.namespace !== undefined && node.__parentId) {
        metafieldBuffer.push(node);
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

  await upsertVariantBatch(variantBuffer, storeId, productMap, inventoryBuffer, db);
  await upsertMetafieldBatch(metafieldBuffer, productMap, db);
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
  inventoryBuffer: any[],
  db: any,
): Promise<void> {
  // Build inventory index: inventoryItemId → levels[]
  const invIndex = new Map<string, any[]>();
  for (const inv of inventoryBuffer) {
    const key = inv.__parentId;
    if (!invIndex.has(key)) invIndex.set(key, []);
    invIndex.get(key)!.push(inv);
  }

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
      weight: raw.weight || null,
      weightUnit: raw.weightUnit || null,
      inventoryItemId: raw.inventoryItem?.id || null,
      barcode: raw.barcode || null,
      taxable: raw.taxable ?? true,
      requiresShipping: raw.requiresShipping ?? true,
      position: raw.position || 1,
      option1: opts[0]?.value || null,
      option2: opts[1]?.value || null,
      option3: opts[2]?.value || null,
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

    // Upsert inventory levels
    const invItemId = raw.inventoryItem?.id;
    if (invItemId && invIndex.has(invItemId)) {
      for (const level of invIndex.get(invItemId)!) {
        const locationId = level.location?.id || 'unknown';
        const existingLevel = await db.query.inventoryLevels.findFirst({
          where: (il: any, { and: a, eq: e }: any) =>
            a(e(il.variantId, variantId), e(il.locationId, locationId)),
          columns: { id: true },
        });

        if (existingLevel) {
          await db
            .update(inventoryLevels)
            .set({ available: level.available || 0, updatedAt: new Date().toISOString() })
            .where(eq(inventoryLevels.id, existingLevel.id));
        } else {
          await db.insert(inventoryLevels).values({
            id: crypto.randomUUID(),
            variantId,
            locationId,
            available: level.available || 0,
          });
        }
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

    // Pre-fetch media for all SKUs
    const skus = filtered.map((v) => v.sku).filter((s): s is string => Boolean(s));
    const mediaMap = await resolveForSkus(skus, env, 10);

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
  const totalInventory = (variant.inventoryLevels || []).reduce(
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
      throw new Error(`Shopify GraphQL HTTP ${res.status}`);
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
