import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { google, sheets_v4 } from 'googleapis';

export interface SheetsGeneratorResult {
  sheetUrl: string;
  rowCount: number;
}

/**
 * Writes feed data to a Google Sheets spreadsheet via the Sheets API v4.
 *
 * Requirements:
 *  - Feed must have googleSheetId set
 *  - Store must have a valid Google OAuth token in GoogleToken table
 *
 * Strategy:
 *  - Clear the target tab (or create it if missing)
 *  - Write header row
 *  - Batch-write rows (500 per API call)
 */
@Injectable()
export class SheetsGenerator {
  private readonly logger = new Logger(SheetsGenerator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async generate(
    storeId: string,
    sheetId: string,
    tabName: string = 'Feed',
    headers: string[],
    rows: Record<string, string>[],
  ): Promise<SheetsGeneratorResult> {
    const authClient = await this.getAuthClient(storeId);

    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Ensure tab exists
    await this.ensureTab(sheets, sheetId, tabName);

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${tabName}!A:ZZ`,
    });

    // Prepare data: header + rows
    const headerRow = headers;
    const dataRows = rows.map((row) => headers.map((h) => row[h] ?? ''));
    const allData = [headerRow, ...dataRows];

    // Batch write in chunks of 500
    const BATCH = 500;
    for (let i = 0; i < allData.length; i += BATCH) {
      const chunk = allData.slice(i, i + BATCH);
      const startRow = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${tabName}!A${startRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: chunk },
      });
    }

    // Bold the header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: await this.getSheetTabId(sheets, sheetId, tabName), startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
        ],
      },
    });

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
    this.logger.log(`Sheets written: ${sheetUrl} (${rows.length} rows)`);

    return { sheetUrl, rowCount: rows.length };
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  private async getAuthClient(storeId: string) {
    const token = await this.prisma.googleToken.findUnique({
      where: { storeId },
    });

    if (!token) throw new Error('No Google OAuth token found for this store');

    const oauth2 = new google.auth.OAuth2(
      this.config.get('google.clientId'),
      this.config.get('google.clientSecret'),
      this.config.get('google.redirectUri'),
    );

    oauth2.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiresAt.getTime(),
    });

    // Auto-refresh if expired
    oauth2.on('tokens', async (tokens) => {
      if (tokens.refresh_token || tokens.access_token) {
        await this.prisma.googleToken.update({
          where: { storeId },
          data: {
            accessToken: tokens.access_token || token.accessToken,
            refreshToken: tokens.refresh_token || token.refreshToken,
            expiresAt: new Date(tokens.expiry_date || Date.now() + 3600_000),
          },
        });
      }
    });

    return oauth2;
  }

  // ─── Sheet Helpers ─────────────────────────────────────────────────────────

  private async ensureTab(
    sheets: sheets_v4.Sheets,
    sheetId: string,
    tabName: string,
  ) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const exists = meta.data.sheets?.some(
      (s) => s.properties?.title === tabName,
    );

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
    }
  }

  private async getSheetTabId(
    sheets: sheets_v4.Sheets,
    sheetId: string,
    tabName: string,
  ): Promise<number> {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tab = meta.data.sheets?.find((s) => s.properties?.title === tabName);
    return tab?.properties?.sheetId ?? 0;
  }
}
