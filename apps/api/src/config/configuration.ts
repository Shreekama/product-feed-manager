export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.API_PORT || '3001', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3001',
  webUrl: process.env.WEB_URL || 'http://localhost:3000',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecret: process.env.SHOPIFY_API_SECRET,
    scopes: (process.env.SHOPIFY_SCOPES || '').split(','),
    host: process.env.SHOPIFY_HOST,
  },

  media: {
    baseUrl: process.env.MEDIA_BASE_URL || 'https://cdn.example.com/media',
    cacheTtl: parseInt(process.env.MEDIA_CACHE_TTL || '21600', 10),
    maxImages: parseInt(process.env.MEDIA_MAX_IMAGES || '20', 10),
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },

  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    feedJobTimeoutMs: parseInt(process.env.FEED_JOB_TIMEOUT_MS || '300000', 10),
  },
});
