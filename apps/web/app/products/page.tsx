'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../lib/api';
import { Search, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

function SyncBanner() {
  const { data, refetch } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/shopify/sync/status`);
      return res.json() as any;
    },
    refetchInterval: (data: any) => (data?.status === 'SYNCING' ? 3000 : false),
  });

  const [starting, setStarting] = useState(false);

  const startSync = async () => {
    setStarting(true);
    try {
      await fetch(`${API_URL}/shopify/sync`, { method: 'POST' });
      await refetch();
    } finally {
      setStarting(false);
    }
  };

  const isSyncing = data?.status === 'SYNCING';
  const phase = data?.progress?.phase;
  const phaseLabel: Record<string, string> = {
    submitting: 'Connecting to Shopify…',
    waiting: 'Shopify preparing data…',
    processing: `Importing… ${data?.progress?.processed ?? 0} products`,
    done: 'Sync complete',
    failed: 'Sync failed',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center gap-4 text-sm">
      <div className="flex-1 flex items-center gap-3">
        <span className="font-medium text-gray-700">d7f63b.myshopify.com</span>
        {data?.productCount !== undefined && (
          <span className="text-gray-400">{data.productCount} products</span>
        )}
        {data?.lastSyncAt && !isSyncing && (
          <span className="text-gray-400 text-xs">
            Last sync {formatDistanceToNow(new Date(data.lastSyncAt), { addSuffix: true })}
          </span>
        )}
        {isSyncing && phase && (
          <span className="text-brand-600 text-xs flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {phaseLabel[phase] || 'Syncing…'}
          </span>
        )}
      </div>
      <button
        onClick={startSync}
        disabled={isSyncing || starting}
        className={clsx(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
          isSyncing || starting
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-brand-600 hover:bg-brand-700 text-white',
        )}
      >
        <RefreshCw className={clsx('w-3 h-3', (isSyncing || starting) && 'animate-spin')} />
        {isSyncing ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  );
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [vendor, setVendor] = useState('');
  const [status, setStatus] = useState('');
  const [inStock, setInStock] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, vendor, status, inStock, page, limit }],
    queryFn: () =>
      productsApi.list({ search, vendor, status, inStock: inStock || undefined, page, limit }),
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors'],
    queryFn: productsApi.vendors,
  });

  const toggleExclude = useMutation({
    mutationFn: ({ id, exclude }: { id: string; exclude: boolean }) =>
      productsApi.toggleExclude(id, exclude),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const products = data?.data || [];
  const meta = data?.meta || { total: 0, totalPages: 1 };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Products</h1>
      <SyncBanner />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search title, SKU, vendor…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-3 py-2 w-full border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <select
          value={vendor}
          onChange={(e) => { setVendor(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All vendors</option>
          {vendors.map((v: string) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => { setInStock(e.target.checked); setPage(1); }}
            className="rounded"
          />
          In stock only
        </label>

        <span className="ml-auto text-sm text-gray-500">{meta.total} products</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Title', 'SKU (first variant)', 'Vendor', 'Price', 'Inventory', 'Status', 'Exclude'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p: any) => {
                const firstVariant = p.variants?.[0];
                const totalInventory = p.variants
                  ?.flatMap((v: any) => v.inventoryLevels)
                  .reduce((s: number, l: any) => s + (l.available || 0), 0) ?? 0;

                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.title}</div>
                      {p.collections?.length > 0 && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {p.collections.map((c: any) => c.collection.title).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {firstVariant?.sku || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.vendor || '—'}</td>
                    <td className="px-4 py-3">
                      {firstVariant ? `$${Number(firstVariant.price).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          totalInventory > 0
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-600',
                        )}
                      >
                        {totalInventory} units
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'text-xs font-medium capitalize',
                          p.status === 'active' ? 'text-green-600' : 'text-gray-400',
                        )}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          toggleExclude.mutate({ id: p.id, exclude: !p.excludeFromFeeds })
                        }
                        className="flex items-center gap-1 text-xs"
                        title={p.excludeFromFeeds ? 'Excluded from feeds' : 'Included in feeds'}
                      >
                        {p.excludeFromFeeds ? (
                          <ToggleRight className="w-5 h-5 text-red-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-gray-300" />
                        )}
                        <span className={p.excludeFromFeeds ? 'text-red-500' : 'text-gray-400'}>
                          {p.excludeFromFeeds ? 'Excluded' : 'Included'}
                        </span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
        <span>
          Page {page} of {meta.totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
            disabled={page >= meta.totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
