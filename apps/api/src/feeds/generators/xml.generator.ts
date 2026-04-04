import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface XmlGeneratorResult {
  filePath: string;
  rowCount: number;
}

/**
 * Generates Google Merchant Center compatible RSS 2.0 XML feed.
 * Spec: https://support.google.com/merchants/answer/7052112
 *
 * Column names must use the proper Google Merchant field names:
 *  g:id, g:title, g:description, g:link, g:image_link, g:price, g:availability, etc.
 *
 * For Facebook / Pinterest, we write a plain XML element per field.
 */
@Injectable()
export class XmlGenerator {
  private readonly logger = new Logger(XmlGenerator.name);

  async generate(
    headers: string[],
    rows: Record<string, string>[],
    feedName: string,
    platform: 'GOOGLE' | 'FACEBOOK' | 'PINTEREST' = 'GOOGLE',
  ): Promise<XmlGeneratorResult> {
    const fileName = `${this.sanitize(feedName)}_${Date.now()}.xml`;
    const filePath = path.join(os.tmpdir(), fileName);

    const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });

    // Write XML header + channel open
    if (platform === 'GOOGLE') {
      stream.write(this.googleHeader(feedName));
    } else {
      stream.write(this.genericHeader(feedName));
    }

    // Write items in batches
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      for (const row of batch) {
        stream.write(this.buildItem(row, platform));
      }
    }

    // Close
    if (platform === 'GOOGLE') {
      stream.write('  </channel>\n</rss>');
    } else {
      stream.write(`  </products>\n</feed>`);
    }

    await new Promise<void>((resolve, reject) => {
      stream.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    this.logger.log(`XML written: ${filePath} (${rows.length} items)`);
    return { filePath, rowCount: rows.length };
  }

  private googleHeader(feedName: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${this.escape(feedName)}</title>
    <link>https://example.com</link>
    <description>Google Merchant Center Product Feed</description>
`;
  }

  private genericHeader(feedName: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed name="${this.escape(feedName)}" generated="${new Date().toISOString()}">
  <products>
`;
  }

  private buildItem(row: Record<string, string>, platform: string): string {
    if (platform === 'GOOGLE') {
      const fields = Object.entries(row)
        .map(([k, v]) => `      <${k}>${this.escape(v)}</${k}>`)
        .join('\n');
      return `    <item>\n${fields}\n    </item>\n`;
    } else {
      const fields = Object.entries(row)
        .map(([k, v]) => `      <${this.xmlTag(k)}>${this.escape(v)}</${this.xmlTag(k)}>`)
        .join('\n');
      return `    <product>\n${fields}\n    </product>\n`;
    }
  }

  private escape(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private xmlTag(col: string): string {
    // Sanitize to valid XML tag (replace non-alphanumeric with _)
    return col.replace(/[^a-zA-Z0-9:_.-]/g, '_');
  }

  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  }
}
