// Auto-generated from migrations/0001_init.sql
// Used by GET /api/setup to initialise D1 tables on first deploy.
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'IDLE',
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stores_shop_domain_idx ON stores (shop_domain);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_id TEXT NOT NULL,
  title TEXT NOT NULL,
  vendor TEXT,
  product_type TEXT,
  handle TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '[]',
  body_html TEXT,
  published_at TEXT,
  exclude_from_feeds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS products_store_idx ON products (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_shopify_store_unique ON products (shopify_id, store_id);
CREATE INDEX IF NOT EXISTS products_vendor_idx ON products (vendor);
CREATE INDEX IF NOT EXISTS products_status_idx ON products (status);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_id TEXT NOT NULL,
  sku TEXT,
  title TEXT NOT NULL,
  price TEXT NOT NULL DEFAULT '0',
  compare_at_price TEXT,
  weight REAL,
  weight_unit TEXT,
  inventory_item_id TEXT,
  barcode TEXT,
  taxable INTEGER NOT NULL DEFAULT 1,
  requires_shipping INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1,
  option1 TEXT,
  option2 TEXT,
  option3 TEXT,
  media_cache TEXT,
  media_cached_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON variants (product_id);
CREATE INDEX IF NOT EXISTS variants_sku_idx ON variants (sku);
CREATE UNIQUE INDEX IF NOT EXISTS variants_shopify_product_unique ON variants (shopify_id, product_id);
CREATE INDEX IF NOT EXISTS variants_inv_item_idx ON variants (inventory_item_id);
CREATE TABLE IF NOT EXISTS inventory_levels (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS inv_levels_variant_idx ON inventory_levels (variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS inv_levels_variant_location_unique ON inventory_levels (variant_id, location_id);
CREATE TABLE IF NOT EXISTS metafields (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_id TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS metafields_product_idx ON metafields (product_id);
CREATE INDEX IF NOT EXISTS metafields_ns_key_idx ON metafields (namespace, key);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_id TEXT NOT NULL,
  title TEXT NOT NULL,
  handle TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS collections_store_idx ON collections (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS collections_shopify_store_unique ON collections (shopify_id, store_id);
CREATE TABLE IF NOT EXISTS product_collections (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS product_collections_pk ON product_collections (product_id, collection_id);
CREATE INDEX IF NOT EXISTS product_collections_collection_idx ON product_collections (collection_id);
CREATE TABLE IF NOT EXISTS media_cache (
  id TEXT PRIMARY KEY,
  base_sku TEXT NOT NULL UNIQUE,
  images TEXT NOT NULL DEFAULT '[]',
  videos TEXT NOT NULL DEFAULT '[]',
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_cache_base_sku_idx ON media_cache (base_sku);
CREATE INDEX IF NOT EXISTS media_cache_expires_idx ON media_cache (expires_at);
CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'GOOGLE',
  country TEXT NOT NULL DEFAULT 'US',
  output_type TEXT NOT NULL DEFAULT 'CSV',
  google_sheet_id TEXT,
  google_sheet_tab TEXT,
  column_mappings TEXT NOT NULL DEFAULT '[]',
  filter_rules TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS feeds_store_idx ON feeds (store_id);
CREATE INDEX IF NOT EXISTS feeds_status_idx ON feeds (status);
CREATE TABLE IF NOT EXISTS feed_schedules (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL UNIQUE REFERENCES feeds(id) ON DELETE CASCADE,
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS feed_schedules_feed_idx ON feed_schedules (feed_id);
CREATE INDEX IF NOT EXISTS feed_schedules_next_run_idx ON feed_schedules (next_run_at);
CREATE INDEX IF NOT EXISTS feed_schedules_active_idx ON feed_schedules (is_active);
CREATE TABLE IF NOT EXISTS feed_runs (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  records_processed INTEGER,
  records_skipped INTEGER,
  output_url TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS feed_runs_feed_idx ON feed_runs (feed_id);
CREATE INDEX IF NOT EXISTS feed_runs_status_idx ON feed_runs (status);
CREATE INDEX IF NOT EXISTS feed_runs_started_idx ON feed_runs (started_at);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_id TEXT,
  topic TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS webhooks_store_idx ON webhooks (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS webhooks_store_topic_unique ON webhooks (store_id, topic);
CREATE TABLE IF NOT EXISTS google_tokens (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS google_tokens_store_idx ON google_tokens (store_id)
`;
