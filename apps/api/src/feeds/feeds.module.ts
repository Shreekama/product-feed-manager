import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { FeedMappingService } from './feed-mapping.service';
import { MediaModule } from '../media/media.module';
import { ProductsModule } from '../products/products.module';
import { CsvGenerator } from './generators/csv.generator';
import { XmlGenerator } from './generators/xml.generator';
import { SheetsGenerator } from './generators/sheets.generator';

@Module({
  imports: [
    MediaModule,
    ProductsModule,
    BullModule.registerQueue({ name: 'feed-jobs' }),
  ],
  controllers: [FeedsController],
  providers: [
    FeedsService,
    FeedMappingService,
    CsvGenerator,
    XmlGenerator,
    SheetsGenerator,
  ],
  exports: [FeedsService, FeedMappingService],
})
export class FeedsModule {}
