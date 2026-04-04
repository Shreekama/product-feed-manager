import { getDb } from '../db';
import type { Env } from '../types';

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
  const db = getDb(env);

  const tokenRecord = await db.query.googleTokens.findFirst({
    where: (t, { eq }) => eq(t.storeId, storeId),
  });

  if (!tokenRecord) {
    throw new Error('No Google OAuth token found for this store');
  }

  let accessToken = tokenRecord.accessToken;

  // Refresh token if expired
  const expiresAt = new Date(tokenRecord.expiresAt).getTime();
  if (Date.now() >= expiresAt - 60_000) {
    if (!tokenRecord.refreshToken) {
      throw new Error('Google token expired and no refresh token available');
    }
    accessToken = await refreshAccessToken(tokenRecord.refreshToken, storeId, db, env);
  }

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

async function refreshAccessToken(
  refreshToken: string,
  storeId: string,
  db: any,
  env: Env,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Google token: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const newAccessToken = data.access_token as string;
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  // Update token in DB
  const { googleTokens } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  await db
    .update(googleTokens)
    .set({ accessToken: newAccessToken, expiresAt })
    .where(eq(googleTokens.storeId, storeId));

  return newAccessToken;
}
