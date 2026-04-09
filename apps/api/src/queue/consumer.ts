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
      if (type === 'bulk-sync')         await handleBulkSyncStart(data, env);
      else if (type === 'bulk-sync-poll')    await handleBulkSyncPoll(data, env);
      else if (type === 'bulk-sync-process') await handleBulkSyncProcess(data, env);
      else if (type === 'feed-job')          await handleFeedJob(data, env);
      msg.ack();
    } catch (err) {
      console.error(`Queue message failed [${type}]:`, err);
      msg.retry();
    }
  }
};

// ─── Bulk Sync — Step 1: Submit ───────────────────────────────────────────────
// Submits the Shopify bulk operation and immediately exits.
// Sends a 'bulk-sync-poll' message with a short delay to check progress.

async function handleBulkSyncStart(
  data: { shopDomain: string; storeId: string },
  env: Env,
): Promise<void> {
  const { shopDomain, storeId } = data;
  const db = getDb(env);
  const startedAt = new Date().toISOString();

  console.log(`[${shopDomain}] Submitting bulk operation`);

  await Promise.all([
    db.update(stores).set({ syncStatus: 'SYNCING', updatedAt: startedAt }).where(eq(stores.id, storeId)),
    setProgress(env, shopDomain, { phase: 'submitting', processed: 0, startedAt }),
  ]);

  const accessToken = await getShopifyToken(shopDomain, env);

  // If a bulk operation is already running (e.g. from a previous attempt),
  // skip submission and go straight to polling.
  const statusQuery = `query { currentBulkOperation { id status errorCode url } }`;
  const current = await shopifyGraphql(shopDomain, accessToken, statusQuery, {});
  const existing = current.currentBulkOperation;

  if (existing && ['CREATED', 'RUNNING'].includes(existing.status)) {
    console.log(`[${shopDomain}] Existing bulk op ${existing.id} still running, polling it`);
  } else {
    await submitBulkOperation(shopDomain, accessToken);
  }

  await setProgress(env, shopDomain, { phase: 'waiting', processed: 0, startedAt });

  // Hand off to the poll step — runs after 8s to give Shopify time to start
  await env.FEED_QUEUE.send(
    { type: 'bulk-sync-poll', shopDomain, storeId, startedAt, attempt: 0 },
    { delaySeconds: 8 },
  );
}

// ─── Bulk Sync — Step 2: Poll ─────────────────────────────────────────────────
// Checks if the Shopify bulk operation finished.
// If still running, re-queues itself with a 10s delay (no sleep loop!).
// If done, sends a 'bulk-sync-process' message with the download URL.

async function handleBulkSyncPoll(
  data: { shopDomain: string; storeId: string; startedAt: string; attempt: number },
  env: Env,
): Promise<void> {
  const { shopDomain, storeId, startedAt, attempt } = data;
  const MAX_ATTEMPTS = 72; // 72 × 10s = 12 minutes max wait

  if (attempt >= MAX_ATTEMPTS) {
    await failSync(env, shopDomain, storeId, 'Bulk operation timed out after 12 minutes', startedAt);
    return;
  }

  const accessToken = await getShopifyToken(shopDomain, env);
  const statusQuery = `query { currentBulkOperation { id status errorCode url objectCount } }`;
  const result = await shopifyGraphql(shopDomain, accessToken, statusQuery, {});
  const op = result.currentBulkOperation;

  console.log(`[${shopDomain}] Poll attempt ${attempt}: bulk op status = ${op?.status}`);

  if (op?.status === 'COMPLETED') {
    if (!op.url) {
      await setProgress(env, shopDomain, { phase: 'done', processed: 0, startedAt });
      await markSyncDone(getDb(env), storeId);
      return;
    }
    await env.FEED_QUEUE.send({ type: 'bulk-sync-process', shopDomain, storeId, downloadUrl: op.url, startedAt });
  } else if (op?.status === 'FAILED' || op?.status === 'CANCELED') {
    await failSync(env, shopDomain, storeId, `Bulk op ${op.status}: ${op.errorCode}`, startedAt);
  } else {
    // Still running — re-queue with 10s delay, no sleep
    await env.FEED_QUEUE.send(
      { type: 'bulk-sync-poll', shopDomain, storeId, startedAt, attempt: attempt + 1 },
      { delaySeconds: 10 },
    );
  }
}

// ─── Bulk Sync — Step 3: Process ──────────────────────────────────────────────
// Downloads the JSONL result and batch-upserts into D1.

async function handleBulkSyncProcess(
  data: { shopDomain: string; storeId: string; downloadUrl: string; startedAt: string },
  env: Env,
): Promise<void> {
  const { shopDomain, storeId, downloadUrl, startedAt } = data;
  const db = getDb(env);

  console.log(`[${shopDomain}] Processing bulk result`);
  await setProgress(env, shopDomain, { phase: 'processing', processed: 0, startedAt });

  try {
    const processed = await processJsonlStream(downloadUrl, storeId, db, env, shopDomain, startedAt);
    await setProgress(env, shopDomain, { phase: 'done', processed, startedAt });
    await markSyncDone(db, storeId);
    console.log(`[${shopDomain}] Sync complete — ${processed} products`);
  } catch (err: any) {
    await failSync(env, shopDomain, storeId, err.message, startedAt);
    throw err;
  }
}

async function failSync(env: Env, shopDomain: string, storeId: string, error: string, startedAt: string) {
  console.error(`[${shopDomain}] Sync failed: ${error}`);
  await Promise.all([
    getDb(env).update(stores).set({ syncStatus: 'FAILED', updatedAt: new Date().toISOString() }).where(eq(stores.id, storeId)),
    setProgress(env, shopDomain, { phase: 'failed', error, startedAt }),
  ]);
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
  const imageBuffer: any[] = [];

  const productMap = new Map<string, string>(); // shopifyProductId → dbId
  let totalProcessed = 0;

  // Stream JSONL
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

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
      try { node = JSON.parse(trimmed); } catch { continue; }

      if (node.title !== undefined && node.vendor !== undefined && !node.__parentId) {
        productBuffer.push(mapProductNode(node, storeId));
      } else if (node.sku !== undefined && node.__parentId) {
        variantBuffer.push({ raw: node, parentShopifyId: node.__parentId });
      } else if (node.namespace !== undefined && node.__parentId) {
        metafieldBuffer.push(node);
      } else if (node.url !== undefined && node.__parentId) {
        imageBuffer.push(node);
      }
    }
  }

  // Flush remaining line
  if (buffer.trim()) {
    try {
      const node = JSON.parse(buffer.trim());
      if (node.title !== undefined && !node.__parentId) productBuffer.push(mapProductNode(node, storeId));
    } catch { /* ignore */ }
  }

  // Batch-upsert everything — each call is O(1) HTTP round trips via D1 batch
  await setProgress(env, shopDomain, { phase: 'processing', processed: 0, startedAt });
  await upsertProductBatch(productBuffer, productMap, env);
  totalProcessed = productBuffer.length;
  await setProgress(env, shopDomain, { phase: 'processing', processed: totalProcessed, startedAt });

  await upsertVariantBatch(variantBuffer, storeId, productMap, env);
  await upsertImageBatch(imageBuffer, productMap, env);
  await upsertMetafieldBatch(metafieldBuffer, productMap, env);

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

/** Run D1 statements in chunks — D1 batch has a practical limit per call */
async function d1Batch(env: Env, stmts: D1PreparedStatement[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await env.DB.batch(stmts.slice(i, i + CHUNK));
  }
}

async function upsertProductBatch(
  productNodes: any[],
  productMap: Map<string, string>,
  env: Env,
): Promise<void> {
  if (!productNodes.length) return;
  const now = new Date().toISOString();

  // Fetch all existing products for this store in ONE query
  const storeId = productNodes[0].storeId;
  const { results: existing } = await env.DB.prepare(
    `SELECT id, shopify_id FROM products WHERE store_id = ?`,
  ).bind(storeId).all<{ id: string; shopify_id: string }>();
  const existingMap = new Map(existing.map(r => [r.shopify_id, r.id]));

  const stmts: D1PreparedStatement[] = [];
  for (const p of productNodes) {
    const id = existingMap.get(p.shopifyId) ?? crypto.randomUUID();
    productMap.set(p.shopifyId, id);

    stmts.push(env.DB.prepare(`
      INSERT INTO products
        (id, store_id, shopify_id, title, vendor, product_type, handle, status, tags, body_html, published_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (shopify_id, store_id) DO UPDATE SET
        title = excluded.title, vendor = excluded.vendor,
        product_type = excluded.product_type, handle = excluded.handle,
        status = excluded.status, tags = excluded.tags,
        body_html = excluded.body_html, published_at = excluded.published_at,
        updated_at = excluded.updated_at
    `).bind(id, p.storeId, p.shopifyId, p.title, p.vendor, p.productType,
            p.handle, p.status, p.tags, p.bodyHtml, p.publishedAt, now));
  }

  await d1Batch(env, stmts);
}

async function upsertVariantBatch(
  variantBuffer: Array<{ raw: any; parentShopifyId: string }>,
  _storeId: string,
  productMap: Map<string, string>,
  env: Env,
): Promise<void> {
  if (!variantBuffer.length) return;
  const now = new Date().toISOString();

  // Collect all product IDs to fetch existing variants in one query
  const productIds = [...new Set(
    variantBuffer.map(v => productMap.get(v.parentShopifyId)).filter(Boolean),
  )] as string[];

  // SQLite caps at 999 bind variables — chunk the IN(...) lookup
  const CHUNK = 50;
  const existingRows: { id: string; shopify_id: string; product_id: string }[] = [];
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, shopify_id, product_id FROM variants WHERE product_id IN (${placeholders})`,
    ).bind(...chunk).all<{ id: string; shopify_id: string; product_id: string }>();
    existingRows.push(...results);
  }

  const existingMap = new Map(existingRows.map(r => [`${r.shopify_id}:${r.product_id}`, r.id]));

  const stmts: D1PreparedStatement[] = [];
  for (const { raw, parentShopifyId } of variantBuffer) {
    const productId = productMap.get(parentShopifyId);
    if (!productId) continue;

    const opts = raw.selectedOptions || [];
    const shopifyVariantId = raw.id;
    const id = existingMap.get(`${shopifyVariantId}:${productId}`) ?? crypto.randomUUID();

    stmts.push(env.DB.prepare(`
      INSERT INTO variants
        (id, product_id, shopify_id, sku, title, price, compare_at_price,
         inventory_item_id, inventory_quantity, barcode, taxable, available_for_sale,
         position, option1, option2, option3, image_src, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (shopify_id, product_id) DO UPDATE SET
        sku = excluded.sku, title = excluded.title, price = excluded.price,
        compare_at_price = excluded.compare_at_price,
        inventory_item_id = excluded.inventory_item_id,
        inventory_quantity = excluded.inventory_quantity,
        barcode = excluded.barcode, taxable = excluded.taxable,
        available_for_sale = excluded.available_for_sale,
        position = excluded.position, option1 = excluded.option1,
        option2 = excluded.option2, option3 = excluded.option3,
        image_src = excluded.image_src, updated_at = excluded.updated_at
    `).bind(
      id, productId, shopifyVariantId,
      raw.sku || null, raw.title, String(raw.price || '0'),
      raw.compareAtPrice ? String(raw.compareAtPrice) : null,
      raw.inventoryItem?.id || null, raw.inventoryQuantity ?? 0,
      raw.barcode || null, raw.taxable ? 1 : 0,
      raw.availableForSale !== false ? 1 : 0,
      raw.position || 1,
      opts[0]?.value || null, opts[1]?.value || null, opts[2]?.value || null,
      stripQuery(raw.image?.url) || null, now,
    ));
  }

  await d1Batch(env, stmts);
}

async function upsertImageBatch(
  imageNodes: any[],
  productMap: Map<string, string>,
  env: Env,
): Promise<void> {
  if (!imageNodes.length) return;

  // Group by product and assign position
  const byProduct = new Map<string, any[]>();
  for (const img of imageNodes) {
    const pid = img.__parentId;
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid)!.push(img);
  }

  const stmts: D1PreparedStatement[] = [];
  for (const [shopifyProductId, images] of byProduct) {
    const productId = productMap.get(shopifyProductId);
    if (!productId) continue;

    images.forEach((img, i) => {
      const src = stripQuery(img.url);
      if (!src) return;
      stmts.push(env.DB.prepare(`
        INSERT INTO product_images (id, product_id, shopify_id, src, alt_text, width, height, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (shopify_id, product_id) DO UPDATE SET
          src = excluded.src, alt_text = excluded.alt_text,
          width = excluded.width, height = excluded.height,
          position = excluded.position
      `).bind(
        crypto.randomUUID(), productId, img.id, src,
        img.altText || null, img.width || null, img.height || null, i + 1,
      ));
    });
  }

  await d1Batch(env, stmts);
}

async function upsertMetafieldBatch(
  metafieldNodes: any[],
  productMap: Map<string, string>,
  env: Env,
): Promise<void> {
  if (!metafieldNodes.length) return;
  const now = new Date().toISOString();

  const stmts: D1PreparedStatement[] = [];
  for (const mf of metafieldNodes) {
    const productId = productMap.get(mf.__parentId);
    if (!productId) continue;

    stmts.push(env.DB.prepare(`
      INSERT INTO metafields (id, product_id, shopify_id, namespace, key, value, type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (shopify_id) DO UPDATE SET
        value = excluded.value, type = excluded.type, updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(), productId, mf.id,
      mf.namespace, mf.key, String(mf.value), mf.type, now,
    ));
  }

  await d1Batch(env, stmts);
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
      columns: { shopDomain: true, primaryDomain: true },
    });

    if (!store) throw new Error(`Store ${storeId} not found`);

    const columnMappings: ColumnMapping[] = JSON.parse(feed.columnMappings || '[]');
    const filterRules: any[] = JSON.parse(feed.filterRules || '[]');

    if (columnMappings.length === 0) {
      throw new Error('Feed has no column mappings configured');
    }

    // Fetch all active variants with their products for this store
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
          buildRow(variant, columnMappings, mediaMap, env, store.primaryDomain || store.shopDomain),
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
    }

    // Write to Google Sheets whenever a Sheet ID is configured
    // (regardless of outputType — this is in addition to CSV/XML generation)
    if (feed.googleSheetId) {
      const sheetsResult = await generateSheets(
        storeId,
        feed.googleSheetId,
        feed.googleSheetTab || 'Feed',
        headers,
        rows,
        env,
      );
      // If no file output was generated, use the sheet URL
      if (!outputUrl) outputUrl = sheetsResult.sheetUrl;
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
  // inventoryLevels table is not populated by the bulk sync,
  // so use inventoryQuantity (synced from Shopify) as the primary source.
  const totalInventory = variant.inventoryQuantity > 0
    ? variant.inventoryQuantity
    : (variant.inventoryLevels || []).reduce(
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
    availability: (totalInventory > 0 || variant.availableForSale === true) ? 'in stock' : 'out of stock',
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

async function setProgress(
  env: Env,
  shopDomain: string,
  progress: Record<string, any>,
): Promise<void> {
  await env.MEDIA_KV.put(
    `sync_progress:${shopDomain}`,
    JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }),
    { expirationTtl: 86400 },
  );
}
