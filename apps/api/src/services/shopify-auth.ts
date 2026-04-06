import type { Env } from '../types';

/**
 * Get a Shopify Admin API access token using the Client Credentials grant.
 * This works for apps and stores in the same Shopify Partner org (dev stores).
 *
 * Token is valid ~24h. We cache it in KV so we don't hit Shopify on every call.
 * Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
export async function getShopifyToken(shopDomain: string, env: Env): Promise<string> {
  const cacheKey = `shopify_token:${shopDomain}`;

  // Return cached token if still valid
  const cached = await env.MEDIA_KV.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify token request failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  if (!data.access_token) throw new Error('No access_token in Shopify token response');

  // Cache with 5-min buffer before expiry (default 24h → 86400s)
  const ttl = Math.max(60, (data.expires_in ?? 86400) - 300);
  await env.MEDIA_KV.put(cacheKey, data.access_token, { expirationTtl: ttl });

  console.log(`[shopify-auth] Got fresh token for ${shopDomain} (expires in ${ttl}s)`);
  return data.access_token;
}
