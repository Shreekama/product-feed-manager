import type { Env } from '../types';

export interface XmlGeneratorResult {
  r2Key: string;
  publicUrl: string;
  rowCount: number;
}

/**
 * Generate XML string in memory (Google RSS 2.0 or generic), upload to R2, return URL.
 */
export async function generateXml(
  headers: string[],
  rows: Record<string, string>[],
  feedName: string,
  platform: 'GOOGLE' | 'FACEBOOK' | 'PINTEREST' | string = 'GOOGLE',
  env: Env,
): Promise<XmlGeneratorResult> {
  const sanitized = sanitizeName(feedName);
  const key = `feeds/${sanitized}_${Date.now()}.xml`;

  const xmlContent = buildXmlString(headers, rows, feedName, platform);

  await env.FEED_R2.put(key, xmlContent, {
    httpMetadata: { contentType: 'application/xml; charset=utf-8' },
  });

  const publicUrl = `https://feeds.r2.dev/${key}`;

  return { r2Key: key, publicUrl, rowCount: rows.length };
}

function buildXmlString(
  headers: string[],
  rows: Record<string, string>[],
  feedName: string,
  platform: string,
): string {
  const parts: string[] = [];

  if (platform === 'GOOGLE') {
    parts.push(googleHeader(feedName));
    for (const row of rows) {
      parts.push(buildGoogleItem(row));
    }
    parts.push('  </channel>\n</rss>');
  } else {
    parts.push(genericHeader(feedName));
    for (const row of rows) {
      parts.push(buildGenericProduct(row));
    }
    parts.push('  </products>\n</feed>');
  }

  return parts.join('');
}

function googleHeader(feedName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(feedName)}</title>
    <link>https://example.com</link>
    <description>Google Merchant Center Product Feed</description>
`;
}

function genericHeader(feedName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed name="${escapeXml(feedName)}" generated="${new Date().toISOString()}">
  <products>
`;
}

function buildGoogleItem(row: Record<string, string>): string {
  const fields = Object.entries(row)
    .map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`)
    .join('\n');
  return `    <item>\n${fields}\n    </item>\n`;
}

function buildGenericProduct(row: Record<string, string>): string {
  const fields = Object.entries(row)
    .map(([k, v]) => `      <${xmlTag(k)}>${escapeXml(v)}</${xmlTag(k)}>`)
    .join('\n');
  return `    <product>\n${fields}\n    </product>\n`;
}

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlTag(col: string): string {
  return col.replace(/[^a-zA-Z0-9:_.-]/g, '_');
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}
