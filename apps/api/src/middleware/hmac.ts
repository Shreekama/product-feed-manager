import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

export const shopifyHmac = createMiddleware<{
  Bindings: Env;
  Variables: { rawBody: ArrayBuffer; shopDomain: string };
}>(async (c, next) => {
  const hmacHeader = c.req.header('x-shopify-hmac-sha256');
  if (!hmacHeader) {
    throw new HTTPException(401, { message: 'Missing HMAC' });
  }

  const body = await c.req.arrayBuffer();
  // Re-attach body for downstream handlers
  c.set('rawBody', body);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.env.SHOPIFY_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, body);
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  if (computed !== hmacHeader) {
    throw new HTTPException(401, { message: 'Invalid HMAC' });
  }

  c.set('shopDomain', c.req.header('x-shopify-shop-domain') || '');
  await next();
});
