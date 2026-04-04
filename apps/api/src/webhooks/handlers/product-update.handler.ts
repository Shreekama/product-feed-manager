import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductCreateHandler } from './product-create.handler';

/**
 * Handles products/update webhook.
 * Reuses the create handler since the payload shape is identical — we upsert.
 * Additionally invalidates media cache for any variants whose SKU changed.
 */
@Injectable()
export class ProductUpdateHandler {
  private readonly logger = new Logger(ProductUpdateHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly createHandler: ProductCreateHandler,
  ) {}

  async handle(shopDomain: string, payload: any) {
    // Check if any SKU changed → invalidate media cache
    await this.invalidateChangedSkuCache(shopDomain, payload);

    // Delegate upsert to create handler
    await this.createHandler.handle(shopDomain, payload);
  }

  private async invalidateChangedSkuCache(shopDomain: string, payload: any) {
    const store = await this.prisma.store.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!store) return;

    const shopifyProductId = `gid://shopify/Product/${payload.id}`;
    const product = await this.prisma.product.findUnique({
      where: { shopifyId_storeId: { shopifyId: shopifyProductId, storeId: store.id } },
      include: { variants: { select: { id: true, sku: true } } },
    });
    if (!product) return;

    const existingSkuMap = new Map(product.variants.map((v) => [v.id, v.sku]));
    const incomingVariants: any[] = payload.variants || [];

    for (const iv of incomingVariants) {
      const incomingSku = iv.sku || null;
      const existing = product.variants.find(
        (v) =>
          v.id ===
          `gid://shopify/ProductVariant/${iv.id}`,
      );
      if (existing && existing.sku !== incomingSku && incomingSku) {
        const baseSku = incomingSku.slice(0, -1);
        // Delete cached media so it will be re-fetched on next feed run
        await this.prisma.mediaCache.deleteMany({ where: { baseSku } });
        this.logger.log(`Invalidated media cache for baseSku: ${baseSku}`);
      }
    }
  }
}
