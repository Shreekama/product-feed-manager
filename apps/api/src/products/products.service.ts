import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryProductsDto } from './dto/query-products.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(storeId: string, query: QueryProductsDto) {
    const { search, vendor, collection, status, excludeFromFeeds, inStock, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = { storeId };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { vendor: { contains: search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    if (vendor) where.vendor = { equals: vendor, mode: 'insensitive' };
    if (status) where.status = status;
    if (excludeFromFeeds !== undefined) where.excludeFromFeeds = excludeFromFeeds;

    if (collection) {
      where.collections = {
        some: { collection: { title: { contains: collection, mode: 'insensitive' } } },
      };
    }

    if (inStock) {
      where.variants = {
        some: { inventoryLevels: { some: { available: { gt: 0 } } } },
      };
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          variants: {
            include: { inventoryLevels: true },
            orderBy: { position: 'asc' },
          },
          metafields: true,
          collections: { include: { collection: true } },
        },
      }),
    ]);

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(storeId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId },
      include: {
        variants: {
          include: { inventoryLevels: true },
          orderBy: { position: 'asc' },
        },
        metafields: true,
        collections: { include: { collection: true } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async toggleExclude(storeId: string, productId: string, exclude: boolean) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.product.update({
      where: { id: productId },
      data: { excludeFromFeeds: exclude },
    });
  }

  async getVendors(storeId: string): Promise<string[]> {
    const results = await this.prisma.product.findMany({
      where: { storeId, vendor: { not: null } },
      select: { vendor: true },
      distinct: ['vendor'],
      orderBy: { vendor: 'asc' },
    });
    return results.map((r) => r.vendor!).filter(Boolean);
  }

  /**
   * Returns a flat list of all active variants for a store, enriched with
   * product fields and total inventory. Used by feed generators.
   */
  async getFeedRows(storeId: string, excludeFeedExcluded = true) {
    return this.prisma.variant.findMany({
      where: {
        product: {
          storeId,
          status: 'active',
          ...(excludeFeedExcluded ? { excludeFromFeeds: false } : {}),
        },
      },
      include: {
        product: {
          include: {
            metafields: true,
            collections: { include: { collection: true } },
          },
        },
        inventoryLevels: true,
      },
      orderBy: [{ product: { title: 'asc' } }, { position: 'asc' }],
    });
  }
}
