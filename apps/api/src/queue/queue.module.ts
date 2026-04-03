import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { FeedJobProcessor } from './feed-job.processor';
import { MediaModule } from '../media/media.module';
import { ProductsModule } from '../products/products.module';
import { FeedsModule } from '../feeds/feeds.module';
import { CsvGenerator } from '../feeds/generators/csv.generator';
import { XmlGenerator } from '../feeds/generators/xml.generator';
import { SheetsGenerator } from '../feeds/generators/sheets.generator';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'feed-jobs' }),
    MediaModule,
    ProductsModule,
    FeedsModule,
  ],
  providers: [
    FeedJobProcessor,
    CsvGenerator,
    XmlGenerator,
    SheetsGenerator,
  ],
})
export class QueueModule {}
