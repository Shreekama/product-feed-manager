// Shared types between API and Web

export type Platform = 'GOOGLE' | 'FACEBOOK' | 'PINTEREST';
export type OutputType = 'GOOGLE_SHEETS' | 'CSV' | 'XML';
export type FeedStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type RunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface ColumnMapping {
  feedColumn: string;
  sourceType: 'product' | 'variant' | 'metafield' | 'computed';
  sourceKey: string;
  transform?: string;
}

export interface FilterRule {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'in';
  value: string;
}

export interface FeedSchedule {
  cronExpr: string;
  nextRunAt: string;
  isActive: boolean;
  timezone: string;
}

export interface FeedRun {
  id: string;
  feedId: string;
  status: RunStatus;
  recordsProcessed: number;
  recordsSkipped: number;
  errorMessage?: string;
  outputUrl?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface MediaResult {
  images: string[];
  videos: string[];
  primaryImage: string | null;
}
