import { Injectable } from '@nestjs/common';
import { MediaService } from '../media/media.service';

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
 * Maps a variant row (with joined product + metafields) to a flat feed record
 * according to the feed's column mapping configuration.
 *
 * sourceTypes:
 *  - product   → product.title, product.vendor, product.handle, etc.
 *  - variant   → variant.sku, variant.price, variant.option1, etc.
 *  - metafield → namespace.key (e.g. "custom.size_guide")
 *  - computed  → image_url, all_images, video_url, inventory, product_url
 */
@Injectable()
export class FeedMappingService {
  constructor(private readonly media: MediaService) {}

  /**
   * Build a feed row for a variant using the given column mappings.
   * mediaMap: pre-fetched media keyed by SKU (to avoid repeated lookups).
   */
  async buildRow(
    variant: any,
    mappings: ColumnMapping[],
    mediaMap: Map<string, any>,
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
    const mediaKey = sku;
    let mediaResult = mediaMap.get(mediaKey);
    if (!mediaResult && sku) {
      mediaResult = await this.media.resolveForSku(sku);
      mediaMap.set(mediaKey, mediaResult);
    }

    for (const mapping of mappings) {
      let value = '';

      try {
        switch (mapping.sourceType) {
          case 'product':
            value = this.resolveProductField(product, mapping.sourceKey);
            break;

          case 'variant':
            value = this.resolveVariantField(variant, mapping.sourceKey, totalInventory);
            break;

          case 'metafield':
            value = this.resolveMetafield(product, mapping.sourceKey);
            break;

          case 'computed':
            value = this.resolveComputed(
              mapping.sourceKey,
              variant,
              product,
              mediaResult,
              totalInventory,
              shopDomain,
            );
            break;
        }
      } catch {
        value = '';
      }

      row[mapping.feedColumn] = this.applyTransform(value, mapping.transform);
    }

    return row;
  }

  // ─── Field Resolvers ───────────────────────────────────────────────────────

  private resolveProductField(product: any, key: string): string {
    const map: Record<string, any> = {
      title: product.title,
      vendor: product.vendor,
      product_type: product.productType,
      handle: product.handle,
      status: product.status,
      tags: Array.isArray(product.tags) ? product.tags.join(', ') : product.tags,
      body_html: product.bodyHtml,
      description: product.bodyHtml ? this.stripHtml(product.bodyHtml) : '',
    };
    return String(map[key] ?? '');
  }

  private resolveVariantField(variant: any, key: string, inventory: number): string {
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
      inventory: inventory,
      taxable: variant.taxable ? 'yes' : 'no',
      requires_shipping: variant.requiresShipping ? 'yes' : 'no',
    };
    return String(map[key] ?? '');
  }

  private resolveMetafield(product: any, key: string): string {
    // key format: "namespace.metafield_key" e.g. "custom.size_guide"
    const [namespace, ...rest] = key.split('.');
    const metafieldKey = rest.join('.');
    const mf = (product.metafields || []).find(
      (m: any) => m.namespace === namespace && m.key === metafieldKey,
    );
    return String(mf?.value ?? '');
  }

  private resolveComputed(
    key: string,
    variant: any,
    product: any,
    media: any,
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
        return variant.sku ? this.media.deriveBaseSku(variant.sku) || '' : '';
      case 'full_title':
        return variant.title !== 'Default Title'
          ? `${product.title} - ${variant.title}`
          : product.title;
      default:
        return '';
    }
  }

  // ─── Transforms ────────────────────────────────────────────────────────────

  private applyTransform(value: string, transform?: string): string {
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
        return this.stripHtml(value);
      case 'truncate':
        const len = parseInt(args[0] || '150', 10);
        return value.length > len ? value.slice(0, len) + '...' : value;
      case 'default':
        return value || (args[0] || '');
      default:
        return value;
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
