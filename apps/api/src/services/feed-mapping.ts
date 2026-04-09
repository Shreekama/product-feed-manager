import { deriveBaseSku } from './media';
import type { Env } from '../types';

export interface ColumnMapping {
  feedColumn: string;
  sourceType: 'product' | 'variant' | 'metafield' | 'computed' | 'fixed';
  sourceKey: string;
  transform?: string;
}

export interface FeedRow {
  [feedColumn: string]: string;
}

/**
 * Build a feed row for a variant using the given column mappings.
 * Images come directly from the DB (Shopify CDN URLs, query params already stripped).
 */
export async function buildRow(
  variant: any,
  mappings: ColumnMapping[],
  _mediaMap: Map<string, any>,
  env: Env,
  shopDomain?: string,
): Promise<FeedRow> {
  const row: FeedRow = {};
  const product = variant.product;

  const totalInventory = variant.inventoryQuantity > 0
    ? variant.inventoryQuantity
    : (variant.inventoryLevels || []).reduce(
        (sum: number, l: any) => sum + (l.available || 0),
        0,
      );

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
          value = resolveComputed(mapping.sourceKey, variant, product, totalInventory, shopDomain);
          break;
        case 'fixed':
          // sourceKey is used as a literal value; if blank, nothing is written
          value = mapping.sourceKey || '';
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
  inventory: number,
  shopDomain?: string,
): string {
  // product.images is sorted by position, URLs already have query params stripped
  const productImgs: any[] = product.images || [];

  switch (key) {
    case 'image_url':
      // Prefer variant-specific image, fall back to first product image
      return variant.imageSrc || productImgs[0]?.src || '';
    case 'image_url_2':
      return productImgs[1]?.src || '';
    case 'image_url_3':
      return productImgs[2]?.src || '';
    case 'all_images':
      return productImgs.map((img: any) => img.src).join(',');
    case 'inventory':
      return String(inventory);
    case 'availability':
      return (inventory > 0 || variant.availableForSale === true) ? 'in stock' : 'out of stock';
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
    case 'map': {
      // format: map:From1=To1|From2=To2  (case-insensitive match)
      const pairs = args.join(':').split('|');
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const from = pair.slice(0, eqIdx).trim();
        const to   = pair.slice(eqIdx + 1);
        if (value.toLowerCase() === from.toLowerCase()) return to;
      }
      return value; // no matching rule — pass through unchanged
    }
    default:
      return value;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
