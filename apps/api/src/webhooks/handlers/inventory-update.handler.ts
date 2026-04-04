import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Handles inventory_levels/update webhook.
 *
 * Payload shape (REST):
 * {
 *   inventory_item_id: 12345,
 *   location_id: 67890,
 *   available: 10,
 *   updated_at: "..."
 * }
 *
 * Strategy: incremental update — only touches the affected row, never reloads all inventory.
 */
@Injectable()
export class InventoryUpdateHandler {
  private readonly logger = new Logger(InventoryUpdateHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(shopDomain: string, payload: any) {
    const inventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
    const locationId = `gid://shopify/Location/${payload.location_id}`;
    const available = payload.available ?? 0;

    // Find the variant that owns this inventory item
    const variant = await this.prisma.variant.findFirst({
      where: { inventoryItemId: inventoryItemGid },
      select: { id: true },
    });

    if (!variant) {
      this.logger.warn(
        `No variant found for inventoryItemId: ${inventoryItemGid}`,
      );
      return;
    }

    await this.prisma.inventoryLevel.upsert({
      where: {
        variantId_locationId: {
          variantId: variant.id,
          locationId,
        },
      },
      create: {
        variantId: variant.id,
        locationId,
        available,
      },
      update: { available },
    });

    this.logger.debug(
      `[${shopDomain}] Inventory updated: item ${payload.inventory_item_id} @ loc ${payload.location_id} → ${available}`,
    );
  }
}
