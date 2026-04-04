import type { Env } from '../types';

export interface CsvGeneratorResult {
  r2Key: string;
  publicUrl: string;
  rowCount: number;
}

/**
 * Generate a CSV string in memory, upload to R2, return public URL and R2 key.
 */
export async function generateCsv(
  headers: string[],
  rows: Record<string, string>[],
  feedName: string,
  env: Env,
): Promise<CsvGeneratorResult> {
  const sanitized = sanitizeName(feedName);
  const key = `feeds/${sanitized}_${Date.now()}.csv`;

  const csvContent = buildCsvString(headers, rows);

  await env.FEED_R2.put(key, csvContent, {
    httpMetadata: { contentType: 'text/csv; charset=utf-8' },
  });

  // Construct public URL (assumes bucket has public access or a custom domain)
  const publicUrl = `https://feeds.r2.dev/${key}`;

  return { r2Key: key, publicUrl, rowCount: rows.length };
}

function buildCsvString(
  headers: string[],
  rows: Record<string, string>[],
): string {
  const lines: string[] = [];

  // Header row
  lines.push(headers.map(escapeCsvField).join(','));

  // Data rows
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h] ?? '')).join(','));
  }

  return lines.join('\r\n');
}

function escapeCsvField(value: string): string {
  const str = String(value ?? '');
  // Wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}
