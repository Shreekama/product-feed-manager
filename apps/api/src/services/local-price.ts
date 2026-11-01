import type { Env } from '../types';

/**
 * Local-currency prices for feeds, computed exactly the way the storefront
 * shows them. Rates and per-shop settings come from the currency app's own D1
 * (Shreekama/shopify-currency-converter, binding FX_DB), and the rounding below
 * mirrors that app's fx.ts + price-display.js — keep them in step, or Pins will
 * show a different price from the product page.
 */

export interface LocalCurrency {
  code: string;
  rate: number;
  /** Rounding granularity in major units. */
  step: number;
  decimals: number;
  /** Date of the FX snapshot the rate came from (YYYY-MM-DD). */
  date: string;
}

/** shopify-currency-converter/app/src/lib/currency-data.ts — ISO 3166-1 alpha-2 -> ISO 4217. */
const COUNTRY_CURRENCY: Record<string, string> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD', AO: 'AOA',
  AR: 'ARS', AS: 'USD', AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR', AZ: 'AZN', BA: 'BAM',
  BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'BGN', BH: 'BHD', BI: 'BIF', BJ: 'XOF',
  BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB', BQ: 'USD', BR: 'BRL', BS: 'BSD', BT: 'BTN',
  BV: 'NOK', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CC: 'AUD', CD: 'CDF', CF: 'XAF',
  CG: 'XAF', CH: 'CHF', CI: 'XOF', CK: 'NZD', CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP',
  CR: 'CRC', CU: 'CUP', CV: 'CVE', CW: 'ANG', CX: 'AUD', CY: 'EUR', CZ: 'CZK', DE: 'EUR',
  DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EC: 'USD', EE: 'EUR', EG: 'EGP',
  EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FJ: 'FJD', FK: 'FKP', FM: 'USD',
  FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP', GD: 'XCD', GE: 'GEL', GF: 'EUR', GG: 'GBP',
  GH: 'GHS', GI: 'GIP', GL: 'DKK', GM: 'GMD', GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR',
  GS: 'GBP', GT: 'GTQ', GU: 'USD', GW: 'XOF', GY: 'GYD', HK: 'HKD', HM: 'AUD', HN: 'HNL',
  HR: 'EUR', HT: 'HTG', HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS', IM: 'GBP', IN: 'INR',
  IO: 'USD', IQ: 'IQD', IR: 'IRR', IS: 'ISK', IT: 'EUR', JE: 'GBP', JM: 'JMD', JO: 'JOD',
  JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KR: 'KRW',
  KW: 'KWD', KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF', LK: 'LKR',
  LR: 'LRD', LS: 'LSL', LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD', MC: 'EUR',
  MD: 'MDL', ME: 'EUR', MF: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD', ML: 'XOF', MM: 'MMK',
  MN: 'MNT', MO: 'MOP', MP: 'USD', MQ: 'EUR', MR: 'MRU', MS: 'XCD', MT: 'EUR', MU: 'MUR',
  MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NC: 'XPF', NE: 'XOF',
  NF: 'AUD', NG: 'NGN', NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NU: 'NZD',
  NZ: 'NZD', OM: 'OMR', PA: 'PAB', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR',
  PL: 'PLN', PM: 'EUR', PN: 'NZD', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG',
  QA: 'QAR', RE: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD',
  SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR', SJ: 'NOK', SK: 'EUR',
  SL: 'SLE', SM: 'EUR', SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SV: 'USD',
  SX: 'ANG', SY: 'SYP', SZ: 'SZL', TC: 'USD', TD: 'XAF', TF: 'EUR', TG: 'XOF', TH: 'THB',
  TJ: 'TJS', TK: 'NZD', TL: 'USD', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD',
  TV: 'AUD', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', UM: 'USD', US: 'USD', UY: 'UYU',
  UZ: 'UZS', VA: 'EUR', VC: 'XCD', VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND', VU: 'VUV',
  WF: 'XPF', WS: 'WST', XK: 'EUR', YE: 'YER', YT: 'EUR', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWL',
};

/** shopify-currency-converter fx.ts roundingStepFor: ~3 significant digits on a typical product. */
export function roundingStepFor(rate: number): number {
  const TYPICAL_BASE_MAJOR = 15000;
  const converted = TYPICAL_BASE_MAJOR * rate;
  if (!(converted > 0) || !Number.isFinite(converted)) return 1;
  return Math.pow(10, Math.max(0, Math.floor(Math.log10(converted)) - 2));
}

/**
 * The currency the storefront shows to visitors from `country`, with today's
 * rate — or null when the storefront would show store-currency (INR) prices:
 * conversion switched off, country unmapped, rate missing, or rates too old.
 */
export async function loadLocalCurrency(
  env: Env,
  country: string,
  shopDomain: string,
): Promise<LocalCurrency | null> {
  if (!env.FX_DB) return null;

  const [shop, snapshot] = await Promise.all([
    env.FX_DB.prepare(
      `SELECT settings_json FROM shops WHERE shop_domain = ? AND uninstalled_at IS NULL`,
    ).bind(shopDomain).first<{ settings_json: string }>(),
    env.FX_DB.prepare(
      `SELECT base, rates_json, fetched_at, snapshot_date FROM fx_snapshots ORDER BY fetched_at DESC LIMIT 1`,
    ).first<{ base: string; rates_json: string; fetched_at: number; snapshot_date: string }>(),
  ]);
  if (!shop || !snapshot || snapshot.base !== 'INR') return null;

  let settings: any = {};
  try { settings = JSON.parse(shop.settings_json || '{}'); } catch { /* defaults */ }
  if (settings.enabled === false) return null;

  const maxAgeDays = Number(settings.max_age_days ?? 30);
  if (Date.now() / 1000 - snapshot.fetched_at > maxAgeDays * 86400) return null;

  const code = (settings.countries ?? COUNTRY_CURRENCY)[country.toUpperCase()];
  if (!code || code === snapshot.base) return null;

  const rate = Number(JSON.parse(snapshot.rates_json)[code]);
  if (!(rate > 0)) return null;

  const display = settings.currencies?.[code];
  const roundTo = Number(display?.round_to ?? 0);
  return {
    code,
    rate,
    step: roundTo > 0 ? roundTo : roundingStepFor(rate),
    decimals: Math.max(0, Number(display?.decimals ?? 0)),
    date: snapshot.snapshot_date,
  };
}

/** A variant's final price in one country's market, as Shopify resolves it. */
export interface MarketPrice {
  price: string;
  compareAtPrice: string | null;
  currency: string;
}

export interface PriceContext {
  local: LocalCurrency | null;
  /** Shopify variant GID -> market price; null when it couldn't be fetched. */
  market: Map<string, MarketPrice> | null;
}

/**
 * The local price for a variant field, starting from the price Shopify shows
 * in that country (Markets percentage adjustments and fixed prices included)
 * and then converting it the way the storefront does.
 */
export function localPriceFor(
  variant: { shopifyId?: string; price?: string | null; compareAtPrice?: string | null },
  field: 'price' | 'compareAtPrice',
  ctx: PriceContext | null,
): string {
  const market = variant.shopifyId ? ctx?.market?.get(variant.shopifyId) : undefined;
  const amount = market ? market[field] : variant[field];

  // Shopify itself already sells in a local currency here (e.g. Shopify
  // Payments), so the storefront shows that price and the converter stays out.
  if (market && market.currency !== 'INR') {
    const major = parseFloat(String(amount ?? ''));
    return major > 0 ? `${major.toFixed(2)} ${market.currency}` : '';
  }
  return formatLocalPrice(amount, ctx?.local ?? null);
}

/**
 * "<amount> <CODE>" for a store-currency (INR) amount, converted and rounded
 * like price-display.js. Without a local currency the INR amount is returned
 * as-is, so the feed still carries a valid, correctly labelled price.
 */
export function formatLocalPrice(inrAmount: string | null | undefined, local: LocalCurrency | null): string {
  const major = parseFloat(String(inrAmount ?? ''));
  if (!(major > 0)) return '';
  if (!local) return `${major.toFixed(2)} INR`;

  let value = Math.round((major * local.rate) / local.step) * local.step;
  // A cheap item must never round down to a free-looking price.
  if (value <= 0) value = local.step;
  return `${value.toFixed(local.decimals)} ${local.code}`;
}
