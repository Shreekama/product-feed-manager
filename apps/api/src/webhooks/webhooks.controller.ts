import {
  Controller,
  Post,
  Headers,
  Body,
  UseGuards,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ShopifyHmacGuard } from '../common/guards/shopify-hmac.guard';
import { ProductCreateHandler } from './handlers/product-create.handler';
import { ProductUpdateHandler } from './handlers/product-update.handler';
import { ProductDeleteHandler } from './handlers/product-delete.handler';
import { InventoryUpdateHandler } from './handlers/inventory-update.handler';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(ShopifyHmacGuard)
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly productCreate: ProductCreateHandler,
    private readonly productUpdate: ProductUpdateHandler,
    private readonly productDelete: ProductDeleteHandler,
    private readonly inventoryUpdate: InventoryUpdateHandler,
  ) {}

  @Post('products-create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle products/create webhook' })
  async handleProductCreate(
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Body() payload: any,
  ) {
    this.logger.log(`[${shopDomain}] products/create: ${payload.id}`);
    await this.productCreate.handle(shopDomain, payload);
    return { ok: true };
  }

  @Post('products-update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle products/update webhook' })
  async handleProductUpdate(
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Body() payload: any,
  ) {
    this.logger.log(`[${shopDomain}] products/update: ${payload.id}`);
    await this.productUpdate.handle(shopDomain, payload);
    return { ok: true };
  }

  @Post('products-delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle products/delete webhook' })
  async handleProductDelete(
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Body() payload: any,
  ) {
    this.logger.log(`[${shopDomain}] products/delete: ${payload.id}`);
    await this.productDelete.handle(shopDomain, payload);
    return { ok: true };
  }

  @Post('inventory-levels-update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle inventory_levels/update webhook' })
  async handleInventoryUpdate(
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Body() payload: any,
  ) {
    await this.inventoryUpdate.handle(shopDomain, payload);
    return { ok: true };
  }
}
