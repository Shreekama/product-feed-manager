import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyService } from './shopify.service';
import * as readline from 'readline';
import * as https from 'https';
import { Readable } from 'stream';

/**
 * Handles full initial product sync using Shopify GraphQL Bulk Operations API.
 *
 * Flow:
 *  1. Submit bulk operation mutation → get operation ID
 *  2. Poll status until COMPLETED
 *  3. Stream JSONL result file line by line (no full-memory load)
 *  4. Upsert products, variants, metafields, inventory levels in batches
 */
@Injectable()
export class BulkSyncService {
  private readonly logger = new Logger(BulkSyncService.name);
  private readonly POLL_INTERVAL_MS = 3_000;
  private readonly BATCH_SIZE = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly config: ConfigService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  async runFullSync(shopDomain: string, accessToken: string, storeId: string) {
    this.logger.log(`[${shopDomain}] Starting bulk product sync`);

    await this.prisma.store.update({
      where: { id: storeId },
      data: { syncStatus: 'SYNCING' },
    });

    try {
      const operationId = await this.submitBulkOperation(shopDomain, accessToken);
      const downloadUrl = await this.pollUntilComplete(shopDomain, accessToken, operationId);

      if (!downloadUrl) {
        this.logger.warn(`[${shopDomain}] No products returned from bulk op`);
        await this.markSyncDone(storeId);
        return;
      }

      await this.processResultFile(downloadUrl, storeId);
      await this.markSyncDone(storeId);

      this.logger.log(`[${shopDomain}] Bulk sync completed successfully`);
    } catch (err) {
      this.logger.error(`[${shopDomain}] Bulk sync failed: ${err.message}`);
      await this.prisma.store.update({
        where: { id: storeId },
        data: { syncStatus: 'FAILED' },
      });
      throw err;
    }
  }

  // ─── Bulk Operation Submission ──────────────────────────────────────────────

  private async submitBulkOperation(
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
                  id
                  title
                  vendor
                  productType
                  handle
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
                        weight
                        weightUnit
                        barcode
                        taxable
                        requiresShipping
                        position
                        selectedOptions { name value }
                        inventoryItem {
                          id
                          inventoryLevels {
                            edges {
                              node {
                                id
                                available
                                location { id }
                              }
                            }
                          }
                        }
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
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `;

    const result = await this.shopify.graphql<any>(shopDomain, accessToken, mutation);
    const { bulkOperation, userErrors } = result.bulkOperationRunQuery;

    if (userErrors?.length) {
      throw new Error(`Bulk op failed: ${JSON.stringify(userErrors)}`);
    }

    this.logger.log(`[${shopDomain}] Bulk op submitted: ${bulkOperation.id}`);
    return bulkOperation.id;
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  private async pollUntilComplete(
    shopDomain: string,
    accessToken: string,
    operationId: string,
  ): Promise<string | null> {
    const statusQuery = `
      query {
        currentBulkOperation {
          id status errorCode url objectCount
        }
      }
    `;

    while (true) {
      await this.sleep(this.POLL_INTERVAL_MS);
      const result = await this.shopify.graphql<any>(shopDomain, accessToken, statusQuery);
      const op = result.currentBulkOperation;

      this.logger.debug(`[${shopDomain}] Bulk op status: ${op.status} (${op.objectCount} objects)`);

      if (op.status === 'COMPLETED') return op.url;
      if (['FAILED', 'CANCELED'].includes(op.status)) {
        throw new Error(`Bulk op ${op.status}: ${op.errorCode}`);
      }
    }
  }

  // ─── JSONL Stream Processing ───────────────────────────────────────────────

  private async processResultFile(downloadUrl: string, storeId: string) {
    this.logger.log(`Streaming bulk result from: ${downloadUrl}`);

    const stream = await this.fetchStream(downloadUrl);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    // Buffers for batch upserts
    const productBuffer: any[] = [];
    const variantBuffer: any[] = [];
    const inventoryBuffer: any[] = [];
    const metafieldBuffer: any[] = [];

    // The JSONL file is flat — each line is a node.
    // Parent nodes have no __parentId; children have __parentId.
    const productMap = new Map<string, string>(); // shopifyProductId → prismaId

    for await (const line of rl) {
      if (!line.trim()) continue;

      let node: any;
      try {
        node = JSON.parse(line);
      } catch {
        continue;
      }

      // Determine node type by its fields
      if (node.title && node.vendor !== undefined && !node.__parentId) {
        // Product node
        productBuffer.push(this.mapProduct(node, storeId));
      } else if (node.sku !== undefined && node.__parentId) {
        // Variant node
        variantBuffer.push({ raw: node, parentShopifyId: node.__parentId });
      } else if (node.available !== undefined && node.__parentId) {
        // Inventory level node
        inventoryBuffer.push(node);
      } else if (node.namespace && node.__parentId) {
        // Metafield node (check if it's for a product or variant)
        metafieldBuffer.push(node);
      }

      // Flush products batch
      if (productBuffer.length >= this.BATCH_SIZE) {
        await this.upsertProducts(productBuffer, productMap);
        productBuffer.length = 0;
      }
    }

    // Flush remaining products
    if (productBuffer.length > 0) {
      await this.upsertProducts(productBuffer, productMap);
    }

    // Upsert variants (need product prisma IDs)
    await this.upsertVariants(variantBuffer, storeId, productMap, inventoryBuffer);

    // Upsert metafields
    await this.upsertMetafields(metafieldBuffer, productMap);
  }

  // ─── Upsert Helpers ────────────────────────────────────────────────────────

  private mapProduct(node: any, storeId: string) {
    return {
      shopifyId: node.id,
      storeId,
      title: node.title,
      vendor: node.vendor || null,
      productType: node.productType || null,
      handle: node.handle || null,
      status: (node.status || 'ACTIVE').toLowerCase(),
      tags: Array.isArray(node.tags) ? node.tags : [],
      bodyHtml: node.bodyHtml || null,
      publishedAt: node.publishedAt ? new Date(node.publishedAt) : null,
    };
  }

  private async upsertProducts(products: any[], productMap: Map<string, string>) {
    for (const p of products) {
      const record = await this.prisma.product.upsert({
        where: { shopifyId_storeId: { shopifyId: p.shopifyId, storeId: p.storeId } },
        create: p,
        update: {
          title: p.title,
          vendor: p.vendor,
          productType: p.productType,
          handle: p.handle,
          status: p.status,
          tags: p.tags,
          bodyHtml: p.bodyHtml,
          publishedAt: p.publishedAt,
        },
        select: { id: true, shopifyId: true },
      });
      productMap.set(record.shopifyId, record.id);
    }
  }

  private async upsertVariants(
    variantBuffer: Array<{ raw: any; parentShopifyId: string }>,
    storeId: string,
    productMap: Map<string, string>,
    inventoryBuffer: any[],
  ) {
    // Build inventory index: inventoryItemId → levels[]
    const invIndex = new Map<string, any[]>();
    for (const inv of inventoryBuffer) {
      const key = inv.__parentId;
      if (!invIndex.has(key)) invIndex.set(key, []);
      invIndex.get(key).push(inv);
    }

    for (let i = 0; i < variantBuffer.length; i += this.BATCH_SIZE) {
      const batch = variantBuffer.slice(i, i + this.BATCH_SIZE);

      for (const { raw, parentShopifyId } of batch) {
        const productId = productMap.get(parentShopifyId);
        if (!productId) continue;

        const opts = raw.selectedOptions || [];
        const variant = await this.prisma.variant.upsert({
          where: { shopifyId_productId: { shopifyId: raw.id, productId } },
          create: {
            shopifyId: raw.id,
            productId,
            sku: raw.sku || null,
            title: raw.title,
            price: parseFloat(raw.price || '0'),
            compareAtPrice: raw.compareAtPrice ? parseFloat(raw.compareAtPrice) : null,
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
          },
          update: {
            sku: raw.sku || null,
            title: raw.title,
            price: parseFloat(raw.price || '0'),
            compareAtPrice: raw.compareAtPrice ? parseFloat(raw.compareAtPrice) : null,
            weight: raw.weight || null,
            weightUnit: raw.weightUnit || null,
            barcode: raw.barcode || null,
            position: raw.position || 1,
            option1: opts[0]?.value || null,
            option2: opts[1]?.value || null,
            option3: opts[2]?.value || null,
          },
          select: { id: true },
        });

        // Upsert inventory levels for this variant
        const invItemId = raw.inventoryItem?.id;
        if (invItemId && invIndex.has(invItemId)) {
          for (const level of invIndex.get(invItemId)) {
            await this.prisma.inventoryLevel.upsert({
              where: {
                variantId_locationId: {
                  variantId: variant.id,
                  locationId: level.location?.id || 'unknown',
                },
              },
              create: {
                variantId: variant.id,
                locationId: level.location?.id || 'unknown',
                available: level.available || 0,
              },
              update: { available: level.available || 0 },
            });
          }
        }
      }
    }
  }

  private async upsertMetafields(metafields: any[], productMap: Map<string, string>) {
    for (const mf of metafields) {
      const productId = productMap.get(mf.__parentId);
      if (!productId) continue;

      await this.prisma.metafield.upsert({
        where: { shopifyId: mf.id },
        create: {
          shopifyId: mf.id,
          productId,
          namespace: mf.namespace,
          key: mf.key,
          value: String(mf.value),
          type: mf.type,
        },
        update: {
          value: String(mf.value),
          type: mf.type,
        },
      });
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  private fetchStream(url: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch bulk result: ${res.statusCode}`));
        } else {
          resolve(res);
        }
      }).on('error', reject);
    });
  }

  private async markSyncDone(storeId: string) {
    await this.prisma.store.update({
      where: { id: storeId },
      data: { syncStatus: 'IDLE', lastSyncAt: new Date() },
    });
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
