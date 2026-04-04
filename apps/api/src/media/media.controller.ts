import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly media: MediaService) {}

  @Get('resolve')
  @ApiOperation({ summary: 'Resolve media URLs for a SKU' })
  @ApiQuery({ name: 'sku', required: true })
  async resolve(@Query('sku') sku: string) {
    if (!sku) return { error: 'sku is required' };
    const result = await this.media.resolveForSku(sku);
    return {
      sku,
      baseSku: this.media.deriveBaseSku(sku),
      ...result,
    };
  }

  @Get('preview-urls')
  @ApiOperation({ summary: 'Preview what URLs would be generated for a SKU (no HTTP probe)' })
  @ApiQuery({ name: 'sku', required: true })
  @ApiQuery({ name: 'count', required: false })
  previewUrls(@Query('sku') sku: string, @Query('count') count = '5') {
    const baseSku = this.media.deriveBaseSku(sku);
    if (!baseSku) return { error: 'Invalid SKU' };

    const n = Math.min(parseInt(count, 10) || 5, 20);
    return {
      sku,
      baseSku,
      imageUrls: Array.from({ length: n }, (_, i) =>
        this.media.buildImageUrl(baseSku, i + 1),
      ),
      videoUrls: Array.from({ length: 3 }, (_, i) =>
        this.media.buildVideoUrl(baseSku, i + 1),
      ),
    };
  }
}
