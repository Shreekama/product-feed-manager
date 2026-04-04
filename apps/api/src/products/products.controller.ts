import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { QueryProductsDto } from './dto/query-products.dto';
import { ShopifyAuthGuard } from '../common/guards/shopify-auth.guard';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(ShopifyAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List all products with filtering and pagination' })
  findAll(@Request() req: any, @Query() query: QueryProductsDto) {
    return this.products.findAll(req.storeId, query);
  }

  @Get('vendors')
  @ApiOperation({ summary: 'Get distinct vendor list for this store' })
  getVendors(@Request() req: any) {
    return this.products.getVendors(req.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single product with all variants and metafields' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.products.findOne(req.storeId, id);
  }

  @Patch(':id/exclude')
  @ApiOperation({ summary: 'Toggle "exclude from feeds" flag on a product' })
  toggleExclude(
    @Request() req: any,
    @Param('id') id: string,
    @Body('exclude') exclude: boolean,
  ) {
    return this.products.toggleExclude(req.storeId, id, exclude);
  }
}
