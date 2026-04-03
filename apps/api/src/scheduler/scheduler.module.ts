import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'feed-jobs' })],
  providers: [SchedulerService],
})
export class SchedulerModule {}
