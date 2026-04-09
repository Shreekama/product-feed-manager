import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ─── Stores ──────────────────────────────────────────────────────────────────

export const stores = sqliteTable('stores', {
  id: text('id').primaryKey(),
  shopDomain: text('shop_domain').notNull().unique(),
  accessToken: text('access_token').notNull(),
  primaryDomain: text('primary_domain'), // custom storefront domain, e.g. www.shreekama.com
  syncStatus: text('sync_status').notNull().default('IDLE'),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const storesRelations = relations(stores, ({ many, one }) => ({
  products: many(products),
  feeds: many(feeds),
  webhooks: many(webhooks),
  googleToken: one(googleTokens, {
    fields: [stores.id],
    references: [googleTokens.storeId],
  }),
}));

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    shopifyId: text('shopify_id').notNull(),
    title: text('title').notNull(),
    vendor: text('vendor'),
    productType: text('product_type'),
    handle: text('handle'),
    status: text('status').notNull().default('active'),
    tags: text('tags').notNull().default('[]'), // JSON array
    bodyHtml: text('body_html'),
    publishedAt: text('published_at'),
    excludeFromFeeds: integer('exclude_from_feeds', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    storeIdx: index('products_store_idx').on(t.storeId),
    shopifyUniqueIdx: uniqueIndex('products_shopify_store_unique').on(
      t.shopifyId,
      t.storeId,
    ),
    vendorIdx: index('products_vendor_idx').on(t.vendor),
    statusIdx: index('products_status_idx').on(t.status),
  }),
);

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, { fields: [products.storeId], references: [stores.id] }),
  variants: many(variants),
  metafields: many(metafields),
  collections: many(productCollections),
  images: many(productImages),
}));

// ─── Product Images ───────────────────────────────────────────────────────────

export const productImages = sqliteTable(
  'product_images',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    shopifyId: text('shopify_id').notNull(),
    src: text('src').notNull(), // Shopify CDN URL, query params stripped
    altText: text('alt_text'),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(1),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    productIdx: index('product_images_product_idx').on(t.productId),
    shopifyUniqueIdx: uniqueIndex('product_images_shopify_product_unique').on(t.shopifyId, t.productId),
    positionIdx: index('product_images_position_idx').on(t.productId, t.position),
  }),
);

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

// ─── Variants ─────────────────────────────────────────────────────────────────

export const variants = sqliteTable(
  'variants',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    shopifyId: text('shopify_id').notNull(),
    sku: text('sku'),
    title: text('title').notNull(),
    price: text('price').notNull().default('0'),
    compareAtPrice: text('compare_at_price'),
    weight: real('weight'),
    weightUnit: text('weight_unit'),
    inventoryItemId: text('inventory_item_id'),
    barcode: text('barcode'),
    taxable: integer('taxable', { mode: 'boolean' }).notNull().default(true),
    requiresShipping: integer('requires_shipping', { mode: 'boolean' }).notNull().default(true),
    availableForSale: integer('available_for_sale', { mode: 'boolean' }).notNull().default(true),
    inventoryQuantity: integer('inventory_quantity').notNull().default(0),
    position: integer('position').notNull().default(1),
    option1: text('option1'),
    option2: text('option2'),
    option3: text('option3'),
    imageSrc: text('image_src'),       // variant-specific image URL (Shopify CDN, no query params)
    mediaCache: text('media_cache'), // JSON
    mediaCachedAt: text('media_cached_at'),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    productIdx: index('variants_product_idx').on(t.productId),
    skuIdx: index('variants_sku_idx').on(t.sku),
    shopifyUniqueIdx: uniqueIndex('variants_shopify_product_unique').on(
      t.shopifyId,
      t.productId,
    ),
    invItemIdx: index('variants_inv_item_idx').on(t.inventoryItemId),
  }),
);

export const variantsRelations = relations(variants, ({ one, many }) => ({
  product: one(products, {
    fields: [variants.productId],
    references: [products.id],
  }),
  inventoryLevels: many(inventoryLevels),
}));

// ─── Inventory Levels ─────────────────────────────────────────────────────────

export const inventoryLevels = sqliteTable(
  'inventory_levels',
  {
    id: text('id').primaryKey(),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    locationId: text('location_id').notNull(),
    available: integer('available').notNull().default(0),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    variantIdx: index('inv_levels_variant_idx').on(t.variantId),
    uniqueIdx: uniqueIndex('inv_levels_variant_location_unique').on(
      t.variantId,
      t.locationId,
    ),
  }),
);

export const inventoryLevelsRelations = relations(
  inventoryLevels,
  ({ one }) => ({
    variant: one(variants, {
      fields: [inventoryLevels.variantId],
      references: [variants.id],
    }),
  }),
);

// ─── Metafields ───────────────────────────────────────────────────────────────

export const metafields = sqliteTable(
  'metafields',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    shopifyId: text('shopify_id').notNull().unique(),
    namespace: text('namespace').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    type: text('type').notNull(),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    productIdx: index('metafields_product_idx').on(t.productId),
    namespaceKeyIdx: index('metafields_ns_key_idx').on(t.namespace, t.key),
  }),
);

export const metafieldsRelations = relations(metafields, ({ one }) => ({
  product: one(products, {
    fields: [metafields.productId],
    references: [products.id],
  }),
}));

// ─── Collections ──────────────────────────────────────────────────────────────

export const collections = sqliteTable(
  'collections',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    shopifyId: text('shopify_id').notNull(),
    title: text('title').notNull(),
    handle: text('handle'),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    storeIdx: index('collections_store_idx').on(t.storeId),
    shopifyUniqueIdx: uniqueIndex('collections_shopify_store_unique').on(
      t.shopifyId,
      t.storeId,
    ),
  }),
);

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  store: one(stores, { fields: [collections.storeId], references: [stores.id] }),
  products: many(productCollections),
}));

// ─── Product Collections ──────────────────────────────────────────────────────

export const productCollections = sqliteTable(
  'product_collections',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: uniqueIndex('product_collections_pk').on(t.productId, t.collectionId),
    collectionIdx: index('product_collections_collection_idx').on(t.collectionId),
  }),
);

export const productCollectionsRelations = relations(
  productCollections,
  ({ one }) => ({
    product: one(products, {
      fields: [productCollections.productId],
      references: [products.id],
    }),
    collection: one(collections, {
      fields: [productCollections.collectionId],
      references: [collections.id],
    }),
  }),
);

// ─── Media Cache ──────────────────────────────────────────────────────────────

export const mediaCache = sqliteTable(
  'media_cache',
  {
    id: text('id').primaryKey(),
    baseSku: text('base_sku').notNull().unique(),
    images: text('images').notNull().default('[]'), // JSON array
    videos: text('videos').notNull().default('[]'), // JSON array
    cachedAt: text('cached_at').notNull().default("(datetime('now'))"),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => ({
    baseSkuIdx: index('media_cache_base_sku_idx').on(t.baseSku),
    expiresIdx: index('media_cache_expires_idx').on(t.expiresAt),
  }),
);

// ─── Feeds ────────────────────────────────────────────────────────────────────

export const feeds = sqliteTable(
  'feeds',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform').notNull().default('GOOGLE'),
    country: text('country').notNull().default('US'),
    outputType: text('output_type').notNull().default('CSV'),
    googleSheetId: text('google_sheet_id'),
    googleSheetTab: text('google_sheet_tab'),
    columnMappings: text('column_mappings').notNull().default('[]'), // JSON
    filterRules: text('filter_rules').notNull().default('[]'), // JSON
    status: text('status').notNull().default('ACTIVE'),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    storeIdx: index('feeds_store_idx').on(t.storeId),
    statusIdx: index('feeds_status_idx').on(t.status),
  }),
);

export const feedsRelations = relations(feeds, ({ one, many }) => ({
  store: one(stores, { fields: [feeds.storeId], references: [stores.id] }),
  schedule: one(feedSchedules, {
    fields: [feeds.id],
    references: [feedSchedules.feedId],
  }),
  runs: many(feedRuns),
}));

// ─── Feed Schedules ───────────────────────────────────────────────────────────

export const feedSchedules = sqliteTable(
  'feed_schedules',
  {
    id: text('id').primaryKey(),
    feedId: text('feed_id')
      .notNull()
      .unique()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    cronExpr: text('cron_expr').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    nextRunAt: text('next_run_at').notNull(),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    feedIdx: index('feed_schedules_feed_idx').on(t.feedId),
    nextRunIdx: index('feed_schedules_next_run_idx').on(t.nextRunAt),
    activeIdx: index('feed_schedules_active_idx').on(t.isActive),
  }),
);

export const feedSchedulesRelations = relations(feedSchedules, ({ one }) => ({
  feed: one(feeds, { fields: [feedSchedules.feedId], references: [feeds.id] }),
}));

// ─── Feed Runs ────────────────────────────────────────────────────────────────

export const feedRuns = sqliteTable(
  'feed_runs',
  {
    id: text('id').primaryKey(),
    feedId: text('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    recordsProcessed: integer('records_processed'),
    recordsSkipped: integer('records_skipped'),
    outputUrl: text('output_url'),
    errorMessage: text('error_message'),
    startedAt: text('started_at').notNull().default("(datetime('now'))"),
    completedAt: text('completed_at'),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    feedIdx: index('feed_runs_feed_idx').on(t.feedId),
    statusIdx: index('feed_runs_status_idx').on(t.status),
    startedIdx: index('feed_runs_started_idx').on(t.startedAt),
  }),
);

export const feedRunsRelations = relations(feedRuns, ({ one }) => ({
  feed: one(feeds, { fields: [feedRuns.feedId], references: [feeds.id] }),
}));

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    shopifyId: text('shopify_id'),
    topic: text('topic').notNull(),
    address: text('address').notNull(),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    storeIdx: index('webhooks_store_idx').on(t.storeId),
    uniqueStoreTopicIdx: uniqueIndex('webhooks_store_topic_unique').on(
      t.storeId,
      t.topic,
    ),
  }),
);

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  store: one(stores, { fields: [webhooks.storeId], references: [stores.id] }),
}));

// ─── Google Tokens ────────────────────────────────────────────────────────────

export const googleTokens = sqliteTable(
  'google_tokens',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .unique()
      .references(() => stores.id, { onDelete: 'cascade' }),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: text('expires_at').notNull(),
    scope: text('scope').notNull().default(''),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
  },
  (t) => ({
    storeIdx: index('google_tokens_store_idx').on(t.storeId),
  }),
);

export const googleTokensRelations = relations(googleTokens, ({ one }) => ({
  store: one(stores, {
    fields: [googleTokens.storeId],
    references: [stores.id],
  }),
}));
