export interface Env {
  DB: D1Database;
  MEDIA_KV: KVNamespace;
  FEED_R2: R2Bucket;
  FEED_QUEUE: Queue;
  ASSETS: Fetcher;
  // Vars
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  APP_URL: string;
  WEB_URL: string;
  MEDIA_BASE_URL: string;
  MEDIA_MAX_IMAGES: string;
  MEDIA_CACHE_TTL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  ENCRYPTION_KEY: string;
}
