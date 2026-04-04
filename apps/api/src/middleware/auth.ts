import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db';
import type { Env } from '../types';

export const shopifyAuth = createMiddleware<{
  Bindings: Env;
  Variables: { shopDomain: string; storeId: string };
}>(async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing token' });
  }

  const token = auth.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new HTTPException(401, { message: 'Malformed token' });
  }

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let payload: any;
  try {
    payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    throw new HTTPException(401, { message: 'Invalid token payload' });
  }

  const shopDomain = payload.dest?.replace('https://', '');
  if (!shopDomain) {
    throw new HTTPException(401, { message: 'Invalid token: missing dest' });
  }

  // Verify HMAC-SHA256 signature using Web Crypto API
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.SHOPIFY_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );

  if (!valid) {
    throw new HTTPException(401, { message: 'Invalid signature' });
  }

  const db = getDb(c.env);
  const store = await db.query.stores.findFirst({
    where: (s, { eq }) => eq(s.shopDomain, shopDomain),
    columns: { id: true, shopDomain: true },
  });

  if (!store) {
    throw new HTTPException(401, { message: 'Store not found' });
  }

  c.set('shopDomain', shopDomain);
  c.set('storeId', store.id);
  await next();
});

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
