import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { ProductCreateHandler } from './handlers/product-create.handler';
import { ProductUpdateHandler } from './handlers/product-update.handler';
import { ProductDeleteHandler } from './handlers/product-delete.handler';
import { InventoryUpdateHandler } from './handlers/inventory-update.handler';

@Module({
  controllers: [WebhooksController],
  providers: [
    ProductCreateHandler,
    ProductUpdateHandler,
    ProductDeleteHandler,
    InventoryUpdateHandler,
  ],
})
export class WebhooksModule {}
