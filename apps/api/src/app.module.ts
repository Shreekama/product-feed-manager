import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { ShopifyModule } from './shopify/shopify.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { MediaModule } from './media/media.module';
import { ProductsModule } from './products/products.module';
import { FeedsModule } from './feeds/feeds.module';
import { QueueModule } from './queue/queue.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Config — globally available
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),

    // Cron scheduler
    ScheduleModule.forRoot(),

    // BullMQ — Redis-backed queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('redis.url'),
      }),
    }),

    // Core
    PrismaModule,
    AuthModule,

    // Shopify
    ShopifyModule,
    WebhooksModule,

    // Domain
    MediaModule,
    ProductsModule,
    FeedsModule,

    // Async jobs
    QueueModule,
    SchedulerModule,
  ],
})
export class AppModule {}
