import type { Env } from '../types';
import { getDb } from '../db';
import { googleTokens } from '../db/schema';
import { eq } from 'drizzle-orm';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Return a usable Google access token for the store, refreshing it first if
 * it has expired (or is about to). Throws with a readable message when the
 * store isn't connected or Google rejects the refresh.
 */
export async function getGoogleAccessToken(env: Env, storeId: string): Promise<string> {
  const db = getDb(env);
  const tokenRow = await db.query.googleTokens.findFirst({
    where: (t, { eq: eq2 }) => eq2(t.storeId, storeId),
  });

  if (!tokenRow) throw new Error('No Google OAuth token found for this store');

  if (Date.now() < new Date(tokenRow.expiresAt).getTime() - 60_000) {
    return tokenRow.accessToken;
  }

  if (!tokenRow.refreshToken) {
    throw new Error('Google token expired and no refresh token available');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Google token: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const accessToken = data.access_token as string;
  await db
    .update(googleTokens)
    .set({
      accessToken,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(googleTokens.id, tokenRow.id));

  return accessToken;
}

/** Look up the email address of the Google account a token belongs to. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const info = (await res.json()) as any;
  return info.email || null;
}
