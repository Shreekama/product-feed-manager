import { Injectable, Logger } from '@nestjs/common';
import { createObjectCsvStringifier } from 'csv-writer';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface CsvGeneratorResult {
  filePath: string;
  rowCount: number;
}

@Injectable()
export class CsvGenerator {
  private readonly logger = new Logger(CsvGenerator.name);

  /**
   * Write rows to a temp CSV file and return the path.
   * @param headers  - Array of column names in order
   * @param rows     - Array of { [column]: value } objects
   * @param feedName - Used for file naming
   */
  async generate(
    headers: string[],
    rows: Record<string, string>[],
    feedName: string,
  ): Promise<CsvGeneratorResult> {
    const fileName = `${this.sanitize(feedName)}_${Date.now()}.csv`;
    const filePath = path.join(os.tmpdir(), fileName);

    const stringifier = createObjectCsvStringifier({
      header: headers.map((h) => ({ id: h, title: h })),
    });

    const BATCH = 500;
    let fileContent = stringifier.getHeaderString() || '';

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      fileContent += stringifier.stringifyRecords(batch);
    }

    fs.writeFileSync(filePath, fileContent, 'utf-8');
    this.logger.log(`CSV written: ${filePath} (${rows.length} rows)`);

    return { filePath, rowCount: rows.length };
  }

  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  }
}
