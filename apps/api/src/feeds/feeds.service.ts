import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedDto } from './dto/create-feed.dto';
import { parseExpression } from 'cron-parser';

@Injectable()
export class FeedsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('feed-jobs') private readonly feedQueue: Queue,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(storeId: string, dto: CreateFeedDto) {
    const { schedule, columnMappings, filterRules, ...feedData } = dto;

    const feed = await this.prisma.feed.create({
      data: {
        storeId,
        name: feedData.name,
        platform: feedData.platform as any,
        country: feedData.country || 'US',
        outputType: feedData.outputType as any,
        googleSheetId: feedData.googleSheetId,
        googleSheetTab: feedData.googleSheetTab,
        columnMappings: (columnMappings || []) as any,
        filterRules: (filterRules || []) as any,
        schedule: schedule
          ? {
              create: {
                cronExpr: schedule.cronExpr,
                timezone: schedule.timezone || 'UTC',
                nextRunAt: this.computeNextRun(schedule.cronExpr),
              },
            }
          : undefined,
      },
      include: { schedule: true },
    });

    return feed;
  }

  async findAll(storeId: string) {
    return this.prisma.feed.findMany({
      where: { storeId },
      include: {
        schedule: true,
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(storeId: string, feedId: string) {
    const feed = await this.prisma.feed.findFirst({
      where: { id: feedId, storeId },
      include: {
        schedule: true,
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!feed) throw new NotFoundException('Feed not found');
    return feed;
  }

  async update(storeId: string, feedId: string, dto: Partial<CreateFeedDto>) {
    const feed = await this.findOne(storeId, feedId);
    const { schedule, columnMappings, filterRules, ...rest } = dto;

    const updated = await this.prisma.feed.update({
      where: { id: feed.id },
      data: {
        ...rest,
        platform: rest.platform as any,
        outputType: rest.outputType as any,
        columnMappings: columnMappings !== undefined ? (columnMappings as any) : undefined,
        filterRules: filterRules !== undefined ? (filterRules as any) : undefined,
        ...(schedule
          ? {
              schedule: {
                upsert: {
                  create: {
                    cronExpr: schedule.cronExpr,
                    timezone: schedule.timezone || 'UTC',
                    nextRunAt: this.computeNextRun(schedule.cronExpr),
                  },
                  update: {
                    cronExpr: schedule.cronExpr,
                    timezone: schedule.timezone || 'UTC',
                    nextRunAt: this.computeNextRun(schedule.cronExpr),
                  },
                },
              },
            }
          : {}),
      },
      include: { schedule: true },
    });

    return updated;
  }

  async remove(storeId: string, feedId: string) {
    const feed = await this.findOne(storeId, feedId);
    await this.prisma.feed.delete({ where: { id: feed.id } });
    return { deleted: true };
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  /**
   * Enqueue an immediate feed run.
   */
  async triggerRun(storeId: string, feedId: string) {
    const feed = await this.findOne(storeId, feedId);
    if (feed.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot run an archived feed');
    }

    // Create a pending run record
    const run = await this.prisma.feedRun.create({
      data: { feedId: feed.id, status: 'PENDING' },
    });

    await this.feedQueue.add(
      'execute-feed',
      { feedId: feed.id, runId: run.id, storeId },
      {
        jobId: run.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return { runId: run.id, message: 'Feed run enqueued' };
  }

  // ─── Logs ──────────────────────────────────────────────────────────────────

  async getRuns(storeId: string, feedId: string, limit = 20) {
    await this.findOne(storeId, feedId); // verify ownership
    return this.prisma.feedRun.findMany({
      where: { feedId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  // ─── Dashboard Stats ───────────────────────────────────────────────────────

  async getDashboard(storeId: string) {
    const feeds = await this.prisma.feed.findMany({
      where: { storeId },
      include: {
        schedule: true,
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    return feeds.map((f) => ({
      id: f.id,
      name: f.name,
      platform: f.platform,
      country: f.country,
      outputType: f.outputType,
      status: f.status,
      lastRun: f.runs[0] || null,
      nextRun: f.schedule?.nextRunAt || null,
      scheduleActive: f.schedule?.isActive ?? false,
    }));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private computeNextRun(cronExpr: string): Date {
    try {
      return parseExpression(cronExpr).next().toDate();
    } catch {
      throw new BadRequestException(`Invalid cron expression: ${cronExpr}`);
    }
  }
}
