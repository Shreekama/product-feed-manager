import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../db';
import { googleTokens, stores } from '../db/schema';
import { eq } from 'drizzle-orm';

export const authRoutes = new Hono<{ Bindings: Env }>();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'].join(' ');

// ─── GET /google?shop= ────────────────────────────────────────────────────────

authRoutes.get('/google', (c) => {
  const shop = c.req.query('shop');
  if (!shop) return c.text('Missing shop parameter', 400);

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: shop,
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

// ─── GET /google/callback?code=&state= ────────────────────────────────────────

authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const shopDomain = c.req.query('state');

  if (!code || !shopDomain) {
    return c.text('Missing code or state parameter', 400);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    return c.text('Token exchange failed', 400);
  }

  const tokens = (await tokenRes.json()) as any;

  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (!store) {
    return c.text('Store not found', 400);
  }

  const expiresAt = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000,
  ).toISOString();

  const existing = await db.query.googleTokens.findFirst({
    where: (t, { eq: eq2 }) => eq2(t.storeId, store.id),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(googleTokens)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt,
        scope: tokens.scope || '',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(googleTokens.id, existing.id));
  } else {
    await db.insert(googleTokens).values({
      id: crypto.randomUUID(),
      storeId: store.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt,
      scope: tokens.scope || '',
    });
  }

  const webUrl = c.env.WEB_URL;
  return c.redirect(
    `${webUrl}/settings?google_connected=true&shop=${shopDomain}`,
  );
});
