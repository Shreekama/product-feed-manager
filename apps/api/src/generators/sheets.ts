import type { Env } from '../types';
import { getGoogleAccessToken } from '../services/google-auth';

export interface SheetsGeneratorResult {
  sheetUrl: string;
  rowCount: number;
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Call Google Sheets API v4 directly via fetch() (no googleapis npm package),
 * with automatic token refresh.
 */
export async function generateSheets(
  storeId: string,
  sheetId: string,
  tabName: string = 'Feed',
  headers: string[],
  rows: Record<string, string>[],
  env: Env,
): Promise<SheetsGeneratorResult> {
  const accessToken = await getGoogleAccessToken(env, storeId);

  // Ensure tab exists
  await ensureTab(sheetId, tabName, accessToken);

  // Clear existing data
  await sheetsRequest(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(tabName + '!A:ZZ')}:clear`,
    'POST',
    accessToken,
    {},
  );

  // Prepare data: header + rows
  const headerRow = headers;
  const dataRows = rows.map((row) => headers.map((h) => row[h] ?? ''));
  const allData = [headerRow, ...dataRows];

  // Batch write in chunks of 500
  const BATCH = 500;
  for (let i = 0; i < allData.length; i += BATCH) {
    const chunk = allData.slice(i, i + BATCH);
    const startRow = i + 1;
    await sheetsRequest(
      `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(tabName + '!A' + startRow)}?valueInputOption=RAW`,
      'PUT',
      accessToken,
      { values: chunk },
    );
  }

  // Bold the header row
  const tabSheetId = await getSheetTabId(sheetId, tabName, accessToken);
  await sheetsRequest(
    `${SHEETS_API}/${sheetId}:batchUpdate`,
    'POST',
    accessToken,
    {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: tabSheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: { textFormat: { bold: true } },
            },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      ],
    },
  );

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  return { sheetUrl, rowCount: rows.length };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sheetsRequest(
  url: string,
  method: string,
  accessToken: string,
  body: any,
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function ensureTab(
  sheetId: string,
  tabName: string,
  accessToken: string,
): Promise<void> {
  const meta = await sheetsRequest(
    `${SHEETS_API}/${sheetId}?fields=sheets.properties.title`,
    'GET',
    accessToken,
    {},
  );

  const exists = (meta.sheets || []).some(
    (s: any) => s.properties?.title === tabName,
  );

  if (!exists) {
    await sheetsRequest(
      `${SHEETS_API}/${sheetId}:batchUpdate`,
      'POST',
      accessToken,
      {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    );
  }
}

async function getSheetTabId(
  sheetId: string,
  tabName: string,
  accessToken: string,
): Promise<number> {
  const meta = await sheetsRequest(
    `${SHEETS_API}/${sheetId}?fields=sheets.properties`,
    'GET',
    accessToken,
    {},
  );

  const tab = (meta.sheets || []).find(
    (s: any) => s.properties?.title === tabName,
  );
  return tab?.properties?.sheetId ?? 0;
}
