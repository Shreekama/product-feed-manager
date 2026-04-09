import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../db';
import { googleTokens } from '../db/schema';
import { eq } from 'drizzle-orm';

export const authRoutes = new Hono<{ Bindings: Env }>();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
].join(' ');
const ENTRA_BASE = 'https://login.microsoftonline.com';
const SESSION_TTL = 8 * 60 * 60; // 8 hours in seconds

// ─── Microsoft Entra ID ───────────────────────────────────────────────────────

// GET /config — returns safe OAuth params (no secrets) for the frontend PKCE flow
authRoutes.get('/config', (c) => {
  return c.json({
    clientId: c.env.ENTRA_CLIENT_ID || '',
    tenantId: c.env.ENTRA_TENANT_ID || '',
    authUrl: ENTRA_BASE,
  });
});

// POST /callback — exchange PKCE code for token, set HttpOnly session cookie
authRoutes.post('/callback', async (c) => {
  let body: { code: string; codeVerifier: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { code, codeVerifier } = body;
  if (!code || !codeVerifier) {
    return c.json({ error: 'Missing code or codeVerifier' }, 400);
  }

  // Redirect URI must exactly match what was sent to Microsoft.
  // Derive from the incoming request origin so it always matches,
  // regardless of whether WEB_URL is set.
  const requestOrigin = new URL(c.req.url).origin;
  const redirectUri = `${requestOrigin}/`;

  const tokenRes = await fetch(
    `${ENTRA_BASE}/${c.env.ENTRA_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.ENTRA_CLIENT_ID,
        client_secret: c.env.ENTRA_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        scope: 'openid profile email',
      }).toString(),
    },
  );

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return c.json({ error: 'Token exchange failed', detail }, 401);
  }

  const tokens = (await tokenRes.json()) as any;

  // Decode id_token JWT payload (no signature verification needed — it came directly from Microsoft)
  let userEmail = '';
  let userName = '';
  let userId = '';
  try {
    const payload = JSON.parse(atob(tokens.id_token.split('.')[1]));
    userId = payload.oid || payload.sub || crypto.randomUUID();
    userEmail = payload.email || payload.preferred_username || '';
    userName = payload.name || userEmail;
  } catch {
    return c.json({ error: 'Failed to decode id_token' }, 500);
  }

  // Store session in KV with TTL
  const sessionId = crypto.randomUUID();
  await c.env.MEDIA_KV.put(
    `session:${sessionId}`,
    JSON.stringify({ userId, userEmail, userName, expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString() }),
    { expirationTtl: SESSION_TTL },
  );

  c.header(
    'Set-Cookie',
    `sk_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`,
  );

  return c.json({ ok: true, user: { email: userEmail, name: userName } });
});

// GET /status — check current session
authRoutes.get('/status', async (c) => {
  const sessionId = _getSessionCookie(c.req.header('Cookie'));
  if (!sessionId) return c.json({ authenticated: false });

  const raw = await c.env.MEDIA_KV.get(`session:${sessionId}`);
  if (!raw) return c.json({ authenticated: false });

  const session = JSON.parse(raw);
  if (new Date(session.expiresAt) < new Date()) return c.json({ authenticated: false });

  return c.json({ authenticated: true, user: { email: session.userEmail, name: session.userName } });
});

// POST /logout — clear session
authRoutes.post('/logout', async (c) => {
  const sessionId = _getSessionCookie(c.req.header('Cookie'));
  if (sessionId) await c.env.MEDIA_KV.delete(`session:${sessionId}`);
  c.header('Set-Cookie', 'sk_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return c.json({ ok: true });
});

function _getSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/sk_session=([^;]+)/);
  return match ? match[1] : null;
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

authRoutes.get('/google', (c) => {
  const shop = c.req.query('shop');
  if (!shop) return c.text('Missing shop parameter', 400);

  // Derive redirect URI from the actual request origin so it always matches
  // what's registered in Google Cloud Console — no env var needed.
  const redirectUri = new URL(c.req.url).origin + '/api/auth/google/callback';

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: shop,
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const shopDomain = c.req.query('state');
  if (!code || !shopDomain) return c.text('Missing code or state parameter', 400);

  const redirectUri = new URL(c.req.url).origin + '/api/auth/google/callback';

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) return c.text('Token exchange failed', 400);

  const tokens = (await tokenRes.json()) as any;
  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, shopDomain),
    columns: { id: true },
  });

  if (!store) return c.text('Store not found', 400);

  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const existing = await db.query.googleTokens.findFirst({
    where: (t, { eq: eq2 }) => eq2(t.storeId, store.id),
    columns: { id: true },
  });

  if (existing) {
    await db.update(googleTokens).set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || undefined,
      expiresAt,
      scope: tokens.scope || '',
      updatedAt: new Date().toISOString(),
    }).where(eq(googleTokens.id, existing.id));
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

  return c.redirect(`${c.env.WEB_URL}/settings?google_connected=true&shop=${shopDomain}`);
});

// ─── GET /google/status — check if Google is connected for the store ───────────

const SHOP_DOMAIN_CONST = 'd7f63b.myshopify.com';

authRoutes.get('/google/status', async (c) => {
  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, SHOP_DOMAIN_CONST),
    columns: { id: true },
  });
  if (!store) return c.json({ connected: false });
  const token = await db.query.googleTokens.findFirst({
    where: (t, { eq: eq2 }) => eq2(t.storeId, store.id),
    columns: { id: true },
  });
  return c.json({ connected: !!token });
});

// ─── GET /google/sheets — list Google Sheets from connected account ────────────

authRoutes.get('/google/sheets', async (c) => {
  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq: eq2 }) => eq2(s.shopDomain, SHOP_DOMAIN_CONST),
    columns: { id: true },
  });
  if (!store) return c.json({ error: 'Store not configured' }, 404);

  const tokenRow = await db.query.googleTokens.findFirst({
    where: (t, { eq: eq2 }) => eq2(t.storeId, store.id),
  });
  if (!tokenRow) return c.json({ error: 'Google not connected' }, 401);

  // Refresh token if expired
  let accessToken = tokenRow.accessToken;
  if (new Date(tokenRow.expiresAt) < new Date()) {
    if (!tokenRow.refreshToken) return c.json({ error: 'Token expired, please reconnect' }, 401);
    const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        refresh_token: tokenRow.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!refreshRes.ok) return c.json({ error: 'Token refresh failed, please reconnect' }, 401);
    const refreshed = (await refreshRes.json()) as any;
    accessToken = refreshed.access_token;
    await db.update(googleTokens).set({
      accessToken,
      expiresAt: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(googleTokens.id, tokenRow.id));
  }

  // List spreadsheets from Google Drive
  const driveRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&orderBy=modifiedTime+desc&pageSize=50&fields=files(id%2Cname)",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!driveRes.ok) {
    // Scope might be missing (old token) — return empty gracefully
    return c.json({ sheets: [] });
  }
  const driveData = (await driveRes.json()) as any;
  return c.json({ sheets: (driveData.files || []).map((f: any) => ({ id: f.id, name: f.name })) });
});
