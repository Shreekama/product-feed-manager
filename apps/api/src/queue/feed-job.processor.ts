import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { FeedMappingService, ColumnMapping } from '../feeds/feed-mapping.service';
import { MediaService } from '../media/media.service';
import { CsvGenerator } from '../feeds/generators/csv.generator';
import { XmlGenerator } from '../feeds/generators/xml.generator';
import { SheetsGenerator } from '../feeds/generators/sheets.generator';

export interface FeedJobPayload {
  feedId: string;
  runId: string;
  storeId: string;
}

/**
 * BullMQ processor that executes a feed generation job.
 *
 * Flow per job:
 *  1. Mark run as RUNNING
 *  2. Fetch all active variants for the store (paginated in 500-record batches)
 *  3. Apply filter rules
 *  4. For each variant: resolve media, apply column mappings
 *  5. Write output (CSV / XML / Google Sheets)
 *  6. Mark run as SUCCESS or FAILED
 *  7. Update next schedule run time
 */
@Processor('feed-jobs')
export class FeedJobProcessor {
  private readonly logger = new Logger(FeedJobProcessor.name);
  private readonly BATCH_SIZE = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly mapping: FeedMappingService,
    private readonly media: MediaService,
    private readonly csvGen: CsvGenerator,
    private readonly xmlGen: XmlGenerator,
    private readonly sheetsGen: SheetsGenerator,
  ) {}

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`[Job ${job.id}] Starting feed job for feedId: ${job.data.feedId}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`[Job ${job.id}] Completed`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`[Job ${job.id}] Failed: ${err.message}`);
  }

  @Process('execute-feed')
  async execute(job: Job<FeedJobPayload>) {
    const { feedId, runId, storeId } = job.data;
    const startTime = Date.now();

    // Mark as RUNNING
    await this.prisma.feedRun.update({
      where: { id: runId },
      data: { status: 'RUNNING' },
    });

    try {
      const feed = await this.prisma.feed.findUniqueOrThrow({
        where: { id: feedId },
        include: { schedule: true },
      });

      const store = await this.prisma.store.findUniqueOrThrow({
        where: { id: storeId },
        select: { shopDomain: true },
      });

      const columnMappings = (feed.columnMappings as unknown as ColumnMapping[]) || [];
      const filterRules = (feed.filterRules as any[]) || [];

      if (columnMappings.length === 0) {
        throw new Error('Feed has no column mappings configured');
      }

      // Fetch all variants for this store
      const allVariants = await this.products.getFeedRows(storeId, true);

      // Apply filter rules
      const filtered = this.applyFilters(allVariants, filterRules);

      job.progress(10);

      // Pre-fetch media for all SKUs (bounded concurrency)
      const skus = filtered.map((v: any) => v.sku).filter(Boolean);
      const mediaMap = await this.media.resolveForSkus(skus, 10);

      job.progress(40);

      // Map each variant to a feed row
      const headers = columnMappings.map((m) => m.feedColumn);
      const rows: Record<string, string>[] = [];

      for (let i = 0; i < filtered.length; i += this.BATCH_SIZE) {
        const batch = filtered.slice(i, i + this.BATCH_SIZE);
        const batchRows = await Promise.all(
          batch.map((variant: any) =>
            this.mapping.buildRow(variant, columnMappings, mediaMap, store.shopDomain),
          ),
        );
        rows.push(...batchRows);

        const progress = 40 + Math.round((i / filtered.length) * 40);
        job.progress(progress);
      }

      job.progress(80);

      // Generate output
      let outputUrl: string | null = null;

      if (feed.outputType === 'CSV') {
        const result = await this.csvGen.generate(headers, rows, feed.name);
        outputUrl = result.filePath;
      } else if (feed.outputType === 'XML') {
        const result = await this.xmlGen.generate(
          headers,
          rows,
          feed.name,
          feed.platform as any,
        );
        outputUrl = result.filePath;
      } else if (feed.outputType === 'GOOGLE_SHEETS') {
        if (!feed.googleSheetId) throw new Error('Google Sheet ID not configured');
        const result = await this.sheetsGen.generate(
          storeId,
          feed.googleSheetId,
          feed.googleSheetTab || 'Feed',
          headers,
          rows,
        );
        outputUrl = result.sheetUrl;
      }

      job.progress(95);

      const durationMs = Date.now() - startTime;

      // Mark SUCCESS
      await this.prisma.feedRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCESS',
          recordsProcessed: rows.length,
          recordsSkipped: allVariants.length - filtered.length,
          completedAt: new Date(),
          durationMs,
          outputUrl,
        },
      });

      // Advance schedule
      if (feed.schedule?.isActive) {
        await this.advanceSchedule(feed.schedule.id, feed.schedule.cronExpr);
      }

      job.progress(100);
      this.logger.log(`Feed "${feed.name}" completed: ${rows.length} rows in ${durationMs}ms`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      await this.prisma.feedRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          errorMessage: err.message,
          completedAt: new Date(),
          durationMs,
        },
      });
      throw err; // Re-throw so Bull marks job as failed
    }
  }

  // ─── Filter Engine ─────────────────────────────────────────────────────────

  private applyFilters(variants: any[], rules: any[]): any[] {
    if (!rules.length) return variants;

    return variants.filter((variant) => {
      return rules.every((rule) => {
        const value = this.resolveFilterField(variant, rule.field);
        return this.evaluateRule(value, rule.operator, rule.value);
      });
    });
  }

  private resolveFilterField(variant: any, field: string): any {
    const product = variant.product;
    const fieldMap: Record<string, any> = {
      vendor: product.vendor,
      product_type: product.productType,
      status: product.status,
      sku: variant.sku,
      price: parseFloat(variant.price),
      inventory: (variant.inventoryLevels || []).reduce(
        (s: number, l: any) => s + l.available,
        0,
      ),
    };
    return fieldMap[field] ?? null;
  }

  private evaluateRule(value: any, operator: string, ruleValue: string): boolean {
    const strVal = String(value ?? '').toLowerCase();
    const ruleStr = ruleValue.toLowerCase();

    switch (operator) {
      case 'eq':       return strVal === ruleStr;
      case 'neq':      return strVal !== ruleStr;
      case 'contains': return strVal.includes(ruleStr);
      case 'gt':       return parseFloat(String(value)) > parseFloat(ruleValue);
      case 'lt':       return parseFloat(String(value)) < parseFloat(ruleValue);
      case 'gte':      return parseFloat(String(value)) >= parseFloat(ruleValue);
      case 'lte':      return parseFloat(String(value)) <= parseFloat(ruleValue);
      case 'in':       return ruleValue.split(',').map((s) => s.trim().toLowerCase()).includes(strVal);
      default:         return true;
    }
  }

  // ─── Schedule Advance ──────────────────────────────────────────────────────

  private async advanceSchedule(scheduleId: string, cronExpr: string) {
    try {
      const { parseExpression } = await import('cron-parser');
      const nextRunAt = parseExpression(cronExpr).next().toDate();
      await this.prisma.feedSchedule.update({
        where: { id: scheduleId },
        data: { nextRunAt },
      });
    } catch {
      // Non-fatal
    }
  }
}
