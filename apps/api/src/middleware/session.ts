import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Env } from '../types';

export interface Session {
  userId: string;
  userEmail: string;
  userName: string;
  expiresAt: string;
}

/** The signed-in Microsoft (Entra) session for this request, if any. */
export async function getSession(c: Context<{ Bindings: Env }>): Promise<Session | null> {
  const match = (c.req.header('Cookie') || '').match(/sk_session=([^;]+)/);
  if (!match) return null;

  const raw = await c.env.MEDIA_KV.get(`session:${match[1]}`);
  if (!raw) return null;

  const session = JSON.parse(raw) as Session;
  if (new Date(session.expiresAt) < new Date()) return null;
  return session;
}

// API paths reachable without signing in. Everything else under /api needs a
// session cookie from the Microsoft sign-in.
const PUBLIC_API_PATHS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/auth\/(config|callback|status|logout)$/, // the sign-in flow itself
  /^\/api\/webhooks\//,                             // Shopify, verified by HMAC
  /^\/api\/shopify\/(install|callback)$/,           // Shopify OAuth, callback verified by HMAC
  /^\/api\/feeds\/file$/,                           // generated feed files (catalogue data only)
];

export const requireSession = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (PUBLIC_API_PATHS.some((re) => re.test(c.req.path))) return next();

  if (!(await getSession(c))) {
    return c.json({ error: 'Not signed in' }, 401);
  }
  await next();
});
