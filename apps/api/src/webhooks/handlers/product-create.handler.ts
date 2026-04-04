import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Handles products/create webhook.
 * Maps the REST webhook payload (not GraphQL) to our normalized schema.
 */
@Injectable()
export class ProductCreateHandler {
  private readonly logger = new Logger(ProductCreateHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(shopDomain: string, payload: any) {
    const store = await this.prisma.store.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!store) {
      this.logger.warn(`[${shopDomain}] Store not found, skipping webhook`);
      return;
    }

    const shopifyProductId = `gid://shopify/Product/${payload.id}`;

    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.upsert({
        where: {
          shopifyId_storeId: { shopifyId: shopifyProductId, storeId: store.id },
        },
        create: {
          shopifyId: shopifyProductId,
          storeId: store.id,
          title: payload.title,
          vendor: payload.vendor || null,
          productType: payload.product_type || null,
          handle: payload.handle || null,
          status: (payload.status || 'active').toLowerCase(),
          tags: payload.tags ? payload.tags.split(', ').filter(Boolean) : [],
          bodyHtml: payload.body_html || null,
          publishedAt: payload.published_at ? new Date(payload.published_at) : null,
        },
        update: {
          title: payload.title,
          vendor: payload.vendor || null,
          productType: payload.product_type || null,
          handle: payload.handle || null,
          status: (payload.status || 'active').toLowerCase(),
          tags: payload.tags ? payload.tags.split(', ').filter(Boolean) : [],
          bodyHtml: payload.body_html || null,
          publishedAt: payload.published_at ? new Date(payload.published_at) : null,
        },
      });

      // Upsert variants
      for (const v of payload.variants || []) {
        await tx.variant.upsert({
          where: {
            shopifyId_productId: {
              shopifyId: `gid://shopify/ProductVariant/${v.id}`,
              productId: product.id,
            },
          },
          create: {
            shopifyId: `gid://shopify/ProductVariant/${v.id}`,
            productId: product.id,
            sku: v.sku || null,
            title: v.title,
            price: parseFloat(v.price || '0'),
            compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
            weight: v.weight || null,
            weightUnit: v.weight_unit || null,
            inventoryItemId: v.inventory_item_id
              ? `gid://shopify/InventoryItem/${v.inventory_item_id}`
              : null,
            barcode: v.barcode || null,
            taxable: v.taxable ?? true,
            requiresShipping: v.requires_shipping ?? true,
            position: v.position || 1,
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
          },
          update: {
            sku: v.sku || null,
            title: v.title,
            price: parseFloat(v.price || '0'),
            compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
            barcode: v.barcode || null,
            position: v.position || 1,
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
          },
        });
      }
    });

    this.logger.log(`[${shopDomain}] Created product: ${payload.title}`);
  }
}
