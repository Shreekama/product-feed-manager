import { resolveForSku, deriveBaseSku, type MediaResult } from './media';
import type { Env } from '../types';

export interface ColumnMapping {
  feedColumn: string;
  sourceType: 'product' | 'variant' | 'metafield' | 'computed';
  sourceKey: string;
  transform?: string;
}

export interface FeedRow {
  [feedColumn: string]: string;
}

/**
 * Build a feed row for a variant using the given column mappings.
 * mediaMap: pre-fetched media keyed by SKU (to avoid repeated lookups).
 */
export async function buildRow(
  variant: any,
  mappings: ColumnMapping[],
  mediaMap: Map<string, MediaResult>,
  env: Env,
  shopDomain?: string,
): Promise<FeedRow> {
  const row: FeedRow = {};
  const product = variant.product;

  // Aggregate inventory across all locations
  const totalInventory = (variant.inventoryLevels || []).reduce(
    (sum: number, l: any) => sum + (l.available || 0),
    0,
  );

  // Resolve media
  const sku = variant.sku || '';
  let mediaResult = mediaMap.get(sku);
  if (!mediaResult && sku) {
    mediaResult = await resolveForSku(sku, env);
    mediaMap.set(sku, mediaResult);
  }

  for (const mapping of mappings) {
    let value = '';

    try {
      switch (mapping.sourceType) {
        case 'product':
          value = resolveProductField(product, mapping.sourceKey);
          break;
        case 'variant':
          value = resolveVariantField(variant, mapping.sourceKey, totalInventory);
          break;
        case 'metafield':
          value = resolveMetafield(product, mapping.sourceKey);
          break;
        case 'computed':
          value = resolveComputed(
            mapping.sourceKey,
            variant,
            product,
            mediaResult ?? null,
            totalInventory,
            shopDomain,
          );
          break;
      }
    } catch {
      value = '';
    }

    row[mapping.feedColumn] = applyTransform(value, mapping.transform);
  }

  return row;
}

// ─── Field Resolvers ──────────────────────────────────────────────────────────

function resolveProductField(product: any, key: string): string {
  const tags = Array.isArray(product.tags)
    ? product.tags.join(', ')
    : (() => {
        try {
          const parsed = JSON.parse(product.tags || '[]');
          return Array.isArray(parsed) ? parsed.join(', ') : String(product.tags ?? '');
        } catch {
          return String(product.tags ?? '');
        }
      })();

  const map: Record<string, any> = {
    title: product.title,
    vendor: product.vendor,
    product_type: product.productType,
    handle: product.handle,
    status: product.status,
    tags,
    body_html: product.bodyHtml,
    description: product.bodyHtml ? stripHtml(product.bodyHtml) : '',
  };
  return String(map[key] ?? '');
}

function resolveVariantField(
  variant: any,
  key: string,
  inventory: number,
): string {
  const map: Record<string, any> = {
    sku: variant.sku,
    title: variant.title,
    price: variant.price,
    compare_at_price: variant.compareAtPrice,
    weight: variant.weight,
    weight_unit: variant.weightUnit,
    barcode: variant.barcode,
    option1: variant.option1,
    option2: variant.option2,
    option3: variant.option3,
    inventory,
    taxable: variant.taxable ? 'yes' : 'no',
    requires_shipping: variant.requiresShipping ? 'yes' : 'no',
  };
  return String(map[key] ?? '');
}

function resolveMetafield(product: any, key: string): string {
  // key format: "namespace.metafield_key" e.g. "custom.size_guide"
  const [namespace, ...rest] = key.split('.');
  const metafieldKey = rest.join('.');
  const metafields = product.metafields || [];
  const mf = metafields.find(
    (m: any) => m.namespace === namespace && m.key === metafieldKey,
  );
  return String(mf?.value ?? '');
}

function resolveComputed(
  key: string,
  variant: any,
  product: any,
  media: MediaResult | null,
  inventory: number,
  shopDomain?: string,
): string {
  switch (key) {
    case 'image_url':
      return media?.primaryImage || media?.images?.[0] || '';
    case 'all_images':
      return (media?.images || []).join(',');
    case 'image_url_2':
      return media?.images?.[1] || '';
    case 'image_url_3':
      return media?.images?.[2] || '';
    case 'video_url':
      return media?.videos?.[0] || '';
    case 'inventory':
      return String(inventory);
    case 'availability':
      return inventory > 0 ? 'in stock' : 'out of stock';
    case 'product_url':
      return shopDomain
        ? `https://${shopDomain}/products/${product.handle}?variant=${variant.shopifyId?.split('/').pop()}`
        : '';
    case 'base_sku':
      return variant.sku ? deriveBaseSku(variant.sku) || '' : '';
    case 'full_title':
      return variant.title !== 'Default Title'
        ? `${product.title} - ${variant.title}`
        : product.title;
    default:
      return '';
  }
}

// ─── Transforms ───────────────────────────────────────────────────────────────

function applyTransform(value: string, transform?: string): string {
  if (!transform) return value;

  const [fn, ...args] = transform.split(':');
  switch (fn) {
    case 'uppercase':
      return value.toUpperCase();
    case 'lowercase':
      return value.toLowerCase();
    case 'append':
      return value + (args[0] || '');
    case 'prepend':
      return (args[0] || '') + value;
    case 'strip_html':
      return stripHtml(value);
    case 'truncate': {
      const len = parseInt(args[0] || '150', 10);
      return value.length > len ? value.slice(0, len) + '...' : value;
    }
    case 'default':
      return value || args[0] || '';
    default:
      return value;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
