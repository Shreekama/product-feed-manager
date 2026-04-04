import { Module } from '@nestjs/common';
import { ShopifyService } from './shopify.service';
import { BulkSyncService } from './bulk-sync.service';
import { ShopifyInstallService } from './shopify-install.service';
import { ShopifyController } from './shopify.controller';

@Module({
  controllers: [ShopifyController],
  providers: [ShopifyService, BulkSyncService, ShopifyInstallService],
  exports: [ShopifyService, BulkSyncService],
})
export class ShopifyModule {}
