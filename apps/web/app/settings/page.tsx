'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle, ExternalLink, RefreshCw, AlertCircle, Package, Square,
  ScrollText, Settings, BookOpen,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { clsx } from 'clsx';

const SHOP_DOMAIN = 'd7f63b.myshopify.com';
const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const PHASE_CONFIG: Record<string, { label: string; pct: number; pulse: boolean }> = {
  submitting:  { label: 'Connecting to Shopify…',          pct: 10,  pulse: true  },
  waiting:     { label: 'Shopify is preparing your data…', pct: 35,  pulse: true  },
  processing:  { label: 'Importing products…',             pct: 70,  pulse: true  },
  done:        { label: 'Sync complete',                   pct: 100, pulse: false },
  failed:      { label: 'Sync failed',                     pct: 100, pulse: false },
};

// ── Sync card ─────────────────────────────────────────────────────────────────

function SyncCard() {
  const [syncData, setSyncData]     = useState<any>(null);
  const [starting, setStarting]     = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [syncError, setSyncError]   = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/shopify/sync/status`);
      setSyncData(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (syncData?.status !== 'SYNCING') return;
    const id = setInterval(fetchStatus, 3000);
    return () => clearInterval(id);
  }, [fetchStatus, syncData?.status]);

  const cancelSync = async () => {
    setCancelling(true); setSyncError('');
    try {
      const res = await fetch(`${API_URL}/shopify/sync/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json() as any).error || 'Cancel failed');
      await fetchStatus();
    } catch (e: any) { setSyncError(e.message); }
    finally { setCancelling(false); }
  };

  const startSync = async () => {
    setStarting(true); setSyncError('');
    try {
      const res = await fetch(`${API_URL}/shopify/sync`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json() as any).error || 'Failed');
      await fetchStatus();
    } catch (e: any) { setSyncError(e.message); }
    finally { setStarting(false); }
  };

  const status    = syncData?.status;
  const progress  = syncData?.progress;
  const isSyncing = status === 'SYNCING';
  const isFailed  = status === 'FAILED' || progress?.phase === 'failed';
  const isDone    = progress?.phase === 'done';
  const phase     = progress?.phase || (isSyncing ? 'processing' : 'idle');
  const cfg       = PHASE_CONFIG[phase];
  const pct       = cfg?.pct ?? 0;
  const processed = progress?.processed ?? 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-700">Product Sync</h2>
        <span className="text-xs text-gray-400 font-mono">{SHOP_DOMAIN}</span>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-1.5 text-gray-600">
          <Package className="w-4 h-4 text-brand-600" />
          <span className="font-semibold">{syncData?.productCount ?? '—'}</span>
          <span className="text-gray-400">products</span>
        </div>
        {syncData?.lastSyncAt && !isSyncing && (
          <span className="text-gray-400 text-xs">
            Last sync: {formatDistanceToNow(new Date(syncData.lastSyncAt), { addSuffix: true })}
          </span>
        )}
      </div>

      {isFailed && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" /> Sync failed
          </div>
          <p className="text-xs text-red-600 font-mono break-all">{progress?.error || 'Unknown error'}</p>
        </div>
      )}

      {(isSyncing || isDone) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {cfg?.label}
              {phase === 'processing' && processed > 0 && (
                <span className="ml-1 text-gray-400">— {processed} synced</span>
              )}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden relative">
            <div
              className={clsx('h-full rounded-full transition-all duration-700', isDone ? 'bg-green-500' : 'bg-brand-600')}
              style={{ width: `${pct}%` }}
            >
              {cfg?.pulse && (
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
              )}
            </div>
          </div>
        </div>
      )}

      {syncError && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {syncError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={startSync}
          disabled={isSyncing || starting || cancelling}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            isSyncing || starting || cancelling
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-brand-600 hover:bg-brand-700 text-white',
          )}
        >
          <RefreshCw className={clsx('w-4 h-4', (isSyncing || starting) && 'animate-spin')} />
          {isSyncing ? 'Syncing…' : starting ? 'Starting…' : 'Full Sync'}
        </button>
        {isSyncing && (
          <button
            onClick={cancelSync}
            disabled={cancelling}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors border',
              cancelling
                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                : 'border-red-300 text-red-600 hover:bg-red-50',
            )}
          >
            <Square className={clsx('w-4 h-4', cancelling && 'opacity-50')} />
            {cancelling ? 'Stopping…' : 'Stop Sync'}
          </button>
        )}
        {isDone && (
          <div className="flex items-center gap-1.5 text-green-600 text-sm">
            <CheckCircle className="w-4 h-4" />
            Complete — {processed} products imported
          </div>
        )}
      </div>

      <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}.animate-shimmer{animation:shimmer 1.5s infinite}`}</style>
    </div>
  );
}

// ── Logs tab ──────────────────────────────────────────────────────────────────

function LogsTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['logs'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/logs`);
      return res.json() as any;
    },
    refetchInterval: 30_000,
  });

  const events: any[] = data?.events || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h2 className="font-medium text-gray-700 flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-gray-400" />
          Activity Log
        </h2>
        <button
          onClick={() => refetch()}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading logs…</div>
      ) : events.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">No activity yet. Run a sync or trigger a feed.</div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
          {events.map((ev: any, i: number) => (
            <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
              <span className={clsx(
                'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mt-0.5',
                ev.type === 'sync' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700',
              )}>
                {ev.type === 'sync' ? 'SYNC' : 'FEED'}
              </span>
              <span className={clsx(
                'shrink-0 w-2 h-2 rounded-full mt-1.5',
                ev.status === 'success' ? 'bg-green-500' : ev.status === 'error' ? 'bg-red-500' : 'bg-blue-400',
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 leading-snug">{ev.message}</p>
                {ev.detail && (
                  <a href={ev.detail} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-600 underline truncate block mt-0.5">
                    View output ↗
                  </a>
                )}
              </div>
              <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">
                {ev.time ? format(new Date(ev.time), 'MMM d, HH:mm') : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Google Sheets card ────────────────────────────────────────────────────────

function GoogleCard() {
  const params       = useSearchParams();
  const justConnected = params.get('google_connected') === 'true';

  // Fetch persistent connection status from the API (not just URL param)
  const { data: googleStatus } = useQuery({
    queryKey: ['google-status'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/auth/google/status`);
      return res.json() as any;
    },
  });

  const googleConnected = googleStatus?.connected || justConnected;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-medium text-gray-700">Google Sheets Integration</h2>

      {googleConnected ? (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle className="w-4 h-4" /> Google account connected
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Connect your Google account to export feeds directly to Google Sheets.
        </p>
      )}

      <a
        href={`${API_URL}/auth/google?shop=${SHOP_DOMAIN}`}
        className="inline-flex items-center gap-2 bg-white border border-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        {googleConnected ? 'Reconnect Google' : 'Connect Google Account'}
        <ExternalLink className="w-3 h-3 text-gray-400" />
      </a>

      {googleConnected && (
        <p className="text-xs text-gray-400">
          Reconnect to grant access to browse Google Sheets in the feed editor.
          Required scope: <code>drive.metadata.readonly</code>
        </p>
      )}
    </div>
  );
}

// ── Guide tab ─────────────────────────────────────────────────────────────────

function GuideTab() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-medium text-gray-700 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-gray-400" />
          Feed Mapping Guide
        </h2>
      </div>
      <div className="px-5 py-4 space-y-7 text-sm max-h-[75vh] overflow-y-auto">

        {/* Source Types */}
        <section>
          <h3 className="font-semibold text-gray-800 mb-3">Source Types</h3>
          <div className="space-y-2">
            {[
              ['product',   'Fields from the product record (title, vendor, tags, etc.)'],
              ['variant',   'Fields from each variant (sku, price, barcode, options, etc.)'],
              ['computed',  'Values built automatically from product + variant data (see below)'],
              ['metafield', 'Custom metafields — enter key as namespace.key (e.g. custom.material)'],
            ].map(([type, desc]) => (
              <div key={type} className="flex gap-3">
                <code className="shrink-0 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded self-start">{type}</code>
                <span className="text-xs text-gray-600">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Computed values */}
        <section>
          <h3 className="font-semibold text-gray-800 mb-3">Computed Values</h3>
          <p className="text-xs text-gray-500 mb-2">Use these with <code className="bg-gray-100 px-1 rounded">sourceType = computed</code></p>
          <div className="space-y-1.5">
            {[
              ['image_url',            'URL of the first product image'],
              ['image_url_2 … image_url_8', 'URL of images 2 through 8'],
              ['all_images',           'All image URLs, comma-separated'],
              ['video_url',            'URL of the first product video (from media cache)'],
              ['availability',         '"in stock" or "out of stock" based on inventory quantity'],
              ['inventory',            'Total inventory quantity'],
              ['product_url',          'Full Shopify storefront URL of the product'],
              ['full_title',           'Product title + variant title (e.g. "T-Shirt / Blue / XL")'],
              ['base_sku',             'SKU stripped of any trailing variant suffix'],
            ].map(([key, desc]) => (
              <div key={key} className="flex gap-3">
                <code className="shrink-0 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded self-start min-w-[170px]">{key}</code>
                <span className="text-xs text-gray-600">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Transform formulas */}
        <section>
          <h3 className="font-semibold text-gray-800 mb-3">Transform Formulas</h3>
          <p className="text-xs text-gray-500 mb-2">Enter in the Transform column. Chain multiple with a comma: <code className="bg-gray-100 px-1 rounded">strip_html, truncate:5000</code></p>
          <div className="space-y-1.5">
            {[
              ['uppercase',     'Convert the value to UPPERCASE'],
              ['lowercase',     'Convert the value to lowercase'],
              ['strip_html',    'Remove all HTML tags'],
              ['truncate:500',  'Truncate to 500 characters (replace 500 with any number)'],
              ['append: INR',   'Append text after the value — e.g. "1999" → "1999 INR"'],
              ['prepend:₹',     'Prepend text before the value — e.g. "1999" → "₹1999"'],
              ['default:new',   'Use "new" if the field is empty or null'],
            ].map(([formula, desc]) => (
              <div key={formula} className="flex gap-3">
                <code className="shrink-0 text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded self-start min-w-[140px]">{formula}</code>
                <span className="text-xs text-gray-600">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Metafields */}
        <section>
          <h3 className="font-semibold text-gray-800 mb-3">Metafields</h3>
          <p className="text-xs text-gray-600 mb-2">
            Set <strong>Source Type</strong> to <code className="bg-gray-100 px-1 rounded">metafield</code> and enter the key as{' '}
            <code className="bg-gray-100 px-1 rounded">namespace.key</code>.
          </p>
          <div className="space-y-1.5 mb-3">
            {[
              ['custom.material',       'Custom metafield (namespace=custom, key=material)'],
              ['custom.size_guide',     'Custom size guide metafield'],
              ['seo.title',             'SEO title override'],
              ['seo.description',       'SEO description override'],
              ['shopify.color-pattern', 'Shopify built-in color metafield'],
            ].map(([key, desc]) => (
              <div key={key} className="flex gap-3">
                <code className="shrink-0 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded self-start min-w-[190px]">{key}</code>
                <span className="text-xs text-gray-600">{desc}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            <strong>To find metafield names:</strong> Shopify Admin → Settings → Custom data → Products.
            The namespace and key are shown under each metafield definition.
          </p>
        </section>

        {/* Example mapping */}
        <section>
          <h3 className="font-semibold text-gray-800 mb-3">Example: Google Merchant Center</h3>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Feed Column', 'Source Type', 'Source Key', 'Transform'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  ['g:id',           'variant',  'sku',          ''],
                  ['g:title',        'computed', 'full_title',   ''],
                  ['g:description',  'product',  'description',  'strip_html, truncate:5000'],
                  ['g:link',         'computed', 'product_url',  ''],
                  ['g:image_link',   'computed', 'image_url',    ''],
                  ['g:price',        'variant',  'price',        'append: INR'],
                  ['g:availability', 'computed', 'availability', ''],
                  ['g:brand',        'product',  'vendor',       ''],
                  ['g:gtin',         'variant',  'barcode',      ''],
                  ['g:condition',    'product',  'title',        'default:new'],
                ].map(([col, src, key, transform]) => (
                  <tr key={col} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono font-medium text-brand-700">{col}</td>
                    <td className="px-3 py-1.5 text-gray-500">{src}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{key}</td>
                    <td className="px-3 py-1.5 text-gray-400">{transform || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}

// ── Settings inner ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'general', label: 'General', icon: Settings  },
  { id: 'logs',    label: 'Logs',    icon: ScrollText },
  { id: 'guide',   label: 'Guide',   icon: BookOpen   },
] as const;

type TabId = typeof TABS[number]['id'];

function SettingsInner() {
  const params    = useSearchParams();
  const installed = params.get('installed') === 'true';
  const [tab, setTab] = useState<TabId>('general');

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {installed && (
        <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          Shopify authorized successfully — you can now run a full sync.
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <SyncCard />
          <GoogleCard />
        </>
      )}

      {tab === 'logs'  && <LogsTab />}
      {tab === 'guide' && <GuideTab />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-gray-400">Loading…</div>}>
      <SettingsInner />
    </Suspense>
  );
}
