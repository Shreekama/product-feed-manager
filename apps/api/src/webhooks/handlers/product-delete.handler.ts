import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductDeleteHandler {
  private readonly logger = new Logger(ProductDeleteHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(shopDomain: string, payload: any) {
    const store = await this.prisma.store.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!store) return;

    const shopifyProductId = `gid://shopify/Product/${payload.id}`;

    const deleted = await this.prisma.product.deleteMany({
      where: {
        shopifyId: shopifyProductId,
        storeId: store.id,
      },
    });

    this.logger.log(
      `[${shopDomain}] Deleted product ${payload.id} (${deleted.count} record)`,
    );
  }
}
