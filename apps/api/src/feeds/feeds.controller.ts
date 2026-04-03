import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedsService } from './feeds.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import { ShopifyAuthGuard } from '../common/guards/shopify-auth.guard';

@ApiTags('feeds')
@ApiBearerAuth()
@UseGuards(ShopifyAuthGuard)
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get feed dashboard stats for all feeds' })
  getDashboard(@Request() req: any) {
    return this.feeds.getDashboard(req.storeId);
  }

  @Get()
  @ApiOperation({ summary: 'List all feeds for this store' })
  findAll(@Request() req: any) {
    return this.feeds.findAll(req.storeId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new feed' })
  create(@Request() req: any, @Body() dto: CreateFeedDto) {
    return this.feeds.create(req.storeId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get feed details' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.feeds.findOne(req.storeId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update feed configuration' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: Partial<CreateFeedDto>) {
    return this.feeds.update(req.storeId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a feed' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.feeds.remove(req.storeId, id);
  }

  @Post(':id/run')
  @HttpCode(202)
  @ApiOperation({ summary: 'Trigger an immediate feed run' })
  triggerRun(@Request() req: any, @Param('id') id: string) {
    return this.feeds.triggerRun(req.storeId, id);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Get run history for a feed' })
  getRuns(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit') limit = 20,
  ) {
    return this.feeds.getRuns(req.storeId, id, +limit);
  }
}
