import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Scheduler service — runs every minute and checks for feeds due to run.
 *
 * Design:
 *  - Stores nextRunAt in DB (survives restarts)
 *  - Checks all active schedules where nextRunAt <= now()
 *  - Enqueues feed job and advances nextRunAt
 *  - Idempotent: duplicate enqueue protection via job deduplication
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('feed-jobs') private readonly feedQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkDueFeeds() {
    const now = new Date();

    const dueSchedules = await this.prisma.feedSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
      include: {
        feed: {
          select: {
            id: true,
            name: true,
            storeId: true,
            status: true,
          },
        },
      },
    });

    if (!dueSchedules.length) return;

    this.logger.log(`Found ${dueSchedules.length} due feed(s)`);

    for (const schedule of dueSchedules) {
      const feed = schedule.feed;

      if (feed.status !== 'ACTIVE') {
        this.logger.debug(`Skipping paused/archived feed: ${feed.name}`);
        continue;
      }

      try {
        // Create run record
        const run = await this.prisma.feedRun.create({
          data: { feedId: feed.id, status: 'PENDING' },
        });

        // Enqueue with job ID to prevent duplicates
        const jobId = `feed:${feed.id}:${run.id}`;
        await this.feedQueue.add(
          'execute-feed',
          { feedId: feed.id, runId: run.id, storeId: feed.storeId },
          {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        );

        // Compute and save next run time
        const { parseExpression } = await import('cron-parser');
        const nextRunAt = parseExpression(schedule.cronExpr).next().toDate();

        await this.prisma.feedSchedule.update({
          where: { id: schedule.id },
          data: { nextRunAt },
        });

        this.logger.log(`Enqueued feed "${feed.name}" (runId: ${run.id}), next: ${nextRunAt.toISOString()}`);
      } catch (err) {
        this.logger.error(`Failed to enqueue feed "${feed.name}": ${err.message}`);
      }
    }
  }
}
