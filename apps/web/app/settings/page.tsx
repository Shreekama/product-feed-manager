'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, ExternalLink, RefreshCw, AlertCircle, Package } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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

function SyncCard() {
  const [syncData, setSyncData] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/shopify/sync/status`);
      setSyncData(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (syncData?.status !== 'SYNCING') return;
    const id = setInterval(fetchStatus, 3000);
    return () => clearInterval(id);
  }, [fetchStatus, syncData?.status]);

  const startSync = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/shopify/sync`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json() as any).error || 'Failed');
      await fetchStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
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

  // ── Token not set in Cloudflare ───────────────────────────────────────────
  if (status === 'NOT_CONFIGURED') {
    return (
      <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <h2 className="font-medium text-gray-700">SHOPIFY_STORE_TOKEN not set</h2>
        </div>
        <p className="text-sm text-gray-500">
          Add <code className="bg-gray-100 px-1 rounded text-xs font-mono">SHOPIFY_STORE_TOKEN</code> as a secret in your Cloudflare Worker environment.
          You can find the access token in your Shopify Partner dashboard under the app's API credentials.
        </p>
      </div>
    );
  }

  // ── Connected — show sync controls ────────────────────────────────────────
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

      {(isSyncing || isDone || isFailed) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className={clsx(isFailed && 'text-red-500')}>
              {isFailed ? (progress?.error || 'Sync failed') : cfg?.label}
              {phase === 'processing' && processed > 0 && (
                <span className="ml-1 text-gray-400">— {processed} synced</span>
              )}
            </span>
            {!isFailed && <span>{pct}%</span>}
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            {isFailed ? (
              <div className="h-full w-full bg-red-400 rounded-full" />
            ) : (
              <div
                className={clsx('h-full rounded-full transition-all duration-700', isDone ? 'bg-green-500' : 'bg-brand-600')}
                style={{ width: `${pct}%` }}
              >
                {cfg?.pulse && (
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent" style={{ animation: 'shimmer 1.5s infinite' }} />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={startSync}
          disabled={isSyncing || starting}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            isSyncing || starting ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-700 text-white',
          )}
        >
          <RefreshCw className={clsx('w-4 h-4', (isSyncing || starting) && 'animate-spin')} />
          {isSyncing ? 'Syncing…' : starting ? 'Starting…' : 'Full Sync'}
        </button>
        {isDone && (
          <div className="flex items-center gap-1.5 text-green-600 text-sm">
            <CheckCircle className="w-4 h-4" />
            Complete — {processed} products imported
          </div>
        )}
      </div>

      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }`}</style>
    </div>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const googleConnected = params.get('google_connected') === 'true';

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <SyncCard />

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-medium text-gray-700">Google Sheets Integration</h2>
        {googleConnected && (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle className="w-4 h-4" />
            Google account connected successfully!
          </div>
        )}
        <p className="text-sm text-gray-500">
          Connect your Google account to export feeds directly to Google Sheets.
        </p>
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
      </div>
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
