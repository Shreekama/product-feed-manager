import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyService } from './shopify.service';

const REQUIRED_WEBHOOKS = [
  'products/create',
  'products/update',
  'products/delete',
  'inventory_levels/update',
] as const;

/**
 * Handles app install / OAuth callback.
 * Stores the access token and registers all required webhooks.
 */
@Injectable()
export class ShopifyInstallService {
  private readonly logger = new Logger(ShopifyInstallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly config: ConfigService,
  ) {}

  async handleInstall(shopDomain: string, accessToken: string): Promise<string> {
    // Upsert store record
    const store = await this.prisma.store.upsert({
      where: { shopDomain },
      create: { shopDomain, accessToken },
      update: { accessToken },
    });

    // Register webhooks
    const appUrl = this.config.get<string>('appUrl');
    for (const topic of REQUIRED_WEBHOOKS) {
      try {
        const address = `${appUrl}/api/webhooks/${topic.replace('/', '-')}`;
        const shopifyId = await this.shopify.registerWebhook(
          shopDomain,
          accessToken,
          topic,
          address,
        );

        await this.prisma.webhook.upsert({
          where: { storeId_topic: { storeId: store.id, topic } },
          create: { storeId: store.id, shopifyId, topic, address },
          update: { shopifyId, address },
        });

        this.logger.log(`[${shopDomain}] Registered webhook: ${topic}`);
      } catch (err) {
        this.logger.error(`[${shopDomain}] Failed to register ${topic}: ${err.message}`);
      }
    }

    return store.id;
  }
}
