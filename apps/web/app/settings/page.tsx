'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle, ExternalLink, RefreshCw, AlertCircle, Package, Square,
  ScrollText, Settings,
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
          <p className="text-xs text-red-500">Check <code className="bg-red-100 px-1 rounded">/api/shopify/debug</code> for full details</p>
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

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  error:   'bg-red-100 text-red-600',
  info:    'bg-blue-100 text-blue-600',
};

const TYPE_LABEL: Record<string, string> = {
  sync: 'SYNC',
  feed: 'FEED',
};

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
              {/* Type badge */}
              <span className={clsx(
                'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mt-0.5',
                ev.type === 'sync' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700',
              )}>
                {TYPE_LABEL[ev.type] || ev.type}
              </span>

              {/* Status dot */}
              <span className={clsx(
                'shrink-0 w-2 h-2 rounded-full mt-1.5',
                ev.status === 'success' ? 'bg-green-500' : ev.status === 'error' ? 'bg-red-500' : 'bg-blue-400',
              )} />

              {/* Message */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 leading-snug">{ev.message}</p>
                {ev.detail && (
                  <a href={ev.detail} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-600 underline truncate block mt-0.5">
                    View output ↗
                  </a>
                )}
              </div>

              {/* Time */}
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

function GoogleCard({ googleConnected }: { googleConnected: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="font-medium text-gray-700">Google Sheets Integration</h2>
      {googleConnected && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle className="w-4 h-4" /> Google account connected successfully!
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
  );
}

// ── Settings inner ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'logs',    label: 'Logs',    icon: ScrollText },
] as const;

type TabId = typeof TABS[number]['id'];

function SettingsInner() {
  const params         = useSearchParams();
  const googleConnected = params.get('google_connected') === 'true';
  const installed       = params.get('installed') === 'true';
  const [tab, setTab]   = useState<TabId>('general');

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
          <GoogleCard googleConnected={googleConnected} />
        </>
      )}

      {tab === 'logs' && <LogsTab />}
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
