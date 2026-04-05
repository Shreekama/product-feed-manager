export interface Env {
  DB: D1Database;
  MEDIA_KV: KVNamespace;
  FEED_R2: R2Bucket;
  FEED_QUEUE: Queue;
  ASSETS: Fetcher;
  // Shopify
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_STORE_TOKEN: string; // Access token for d7f63b.myshopify.com (bypasses OAuth)
  APP_URL: string;
  WEB_URL: string;
  // Google Sheets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  // Microsoft Entra ID
  ENTRA_CLIENT_ID: string;
  ENTRA_TENANT_ID: string;
  ENTRA_CLIENT_SECRET: string;
  // Misc
  MEDIA_CACHE_TTL: string;
  ENCRYPTION_KEY: string;
}
