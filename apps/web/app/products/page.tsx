'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
  type ColumnOrderState,
  type VisibilityState,
} from '@tanstack/react-table';
import { productsApi } from '../../lib/api';
import {
  Search, ChevronLeft, ChevronRight, RefreshCw, Settings2,
  ChevronUp, ChevronDown, ChevronsUpDown, Check, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const CURRENCY = '₹';
const VIS_KEY = 'pfm_col_vis';
const ORD_KEY = 'pfm_col_ord';

// ── Types ─────────────────────────────────────────────────────────────────────

type ImgEntry = { src: string; altText: string | null; position: number };

type VariantRow = {
  variantId: string;
  sku: string | null;
  variantTitle: string;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  imageSrc: string | null;
  barcode: string | null;
  mediaCache: string | null;
  productId: string;
  productTitle: string;
  vendor: string | null;
  status: string;
  excludeFromFeeds: boolean;
  images: ImgEntry[];
};

function expandVariants(products: any[]): VariantRow[] {
  const rows: VariantRow[] = [];
  for (const p of products) {
    const images: ImgEntry[] = (p.images || []).slice().sort(
      (a: ImgEntry, b: ImgEntry) => a.position - b.position,
    );
    for (const v of (p.variants || [])) {
      rows.push({
        variantId: v.id,
        sku: v.sku || null,
        variantTitle: v.title,
        price: v.price,
        compareAtPrice: v.compareAtPrice || null,
        inventoryQuantity: v.inventoryQuantity ?? 0,
        option1: v.option1 || null,
        option2: v.option2 || null,
        option3: v.option3 || null,
        imageSrc: v.imageSrc || null,
        barcode: v.barcode || null,
        mediaCache: v.mediaCache || null,
        productId: p.id,
        productTitle: p.title,
        vendor: p.vendor || null,
        status: p.status,
        excludeFromFeeds: p.excludeFromFeeds,
        images,
      });
    }
  }
  return rows;
}

// ── Column config ─────────────────────────────────────────────────────────────

const ALL_COL_IDS = [
  'select', 'thumbnail', 'product', 'sku', 'vendor', 'price', 'compareAt',
  'inventory', 'status', 'option1', 'option2', 'option3',
  'image1', 'image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8',
  'video1', 'video2', 'barcode', 'exclude',
];

const COL_LABELS: Record<string, string> = {
  select: 'Select', thumbnail: 'Thumbnail', product: 'Product', sku: 'SKU',
  vendor: 'Vendor', price: 'Price', compareAt: 'Compare At', inventory: 'Inventory',
  status: 'Status', option1: 'Option 1', option2: 'Option 2', option3: 'Option 3',
  image1: 'Image 1', image2: 'Image 2', image3: 'Image 3', image4: 'Image 4',
  image5: 'Image 5', image6: 'Image 6', image7: 'Image 7', image8: 'Image 8',
  video1: 'Video 1', video2: 'Video 2', barcode: 'Barcode', exclude: 'Exclude',
};

const NON_HIDEABLE = new Set(['select', 'thumbnail', 'product', 'exclude']);

const DEFAULT_VIS: VisibilityState = {
  select: true, thumbnail: true, product: true, sku: true, vendor: true,
  price: true, inventory: true, status: true, exclude: true,
  compareAt: false, option1: false, option2: false, option3: false,
  image1: false, image2: false, image3: false, image4: false,
  image5: false, image6: false, image7: false, image8: false,
  video1: false, video2: false, barcode: false,
};

function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

// ── Sync banner ───────────────────────────────────────────────────────────────

function SyncBanner() {
  const { data, refetch } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/shopify/sync/status`);
      return res.json() as any;
    },
    refetchInterval: (q: any) => (q?.state?.data?.status === 'SYNCING' ? 3000 : false),
  });
  const [starting, setStarting] = useState(false);

  const startSync = async () => {
    setStarting(true);
    try { await fetch(`${API_URL}/shopify/sync`, { method: 'POST' }); await refetch(); }
    finally { setStarting(false); }
  };

  const isSyncing = data?.status === 'SYNCING';
  const phase = data?.progress?.phase;
  const phaseLabel: Record<string, string> = {
    submitting: 'Connecting to Shopify…',
    waiting: 'Shopify preparing data…',
    processing: `Importing… ${data?.progress?.processed ?? 0} products`,
    done: 'Sync complete', failed: 'Sync failed',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center gap-4 text-sm">
      <div className="flex-1 flex items-center gap-3">
        <span className="font-medium text-gray-700">d7f63b.myshopify.com</span>
        {data?.productCount !== undefined && (
          <span className="text-gray-400">{data.productCount} products synced</span>
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

// ── Thumbnail cell ─────────────────────────────────────────────────────────────

function Thumb({ row }: { row: VariantRow }) {
  const src = row.imageSrc || row.images[0]?.src;
  if (!src) return <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-[10px]">—</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={row.productTitle} className="w-10 h-10 object-cover rounded border border-gray-100" />
  );
}

// ── Image cell ────────────────────────────────────────────────────────────────

function ImgCell({ src }: { src: string | undefined }) {
  if (!src) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="w-10 h-10 object-cover rounded border border-gray-100 hover:scale-150 transition-transform" />
    </a>
  );
}

// ── Video cell ────────────────────────────────────────────────────────────────

function VideoCell({ row, index }: { row: VariantRow; index: number }) {
  let url: string | undefined;
  try {
    const mc = row.mediaCache ? JSON.parse(row.mediaCache) : null;
    url = mc?.videos?.[index];
  } catch { /* ignore */ }
  if (!url) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 underline truncate max-w-[80px] block">
      Video {index + 1}
    </a>
  );
}

// ── Column manager dropdown ────────────────────────────────────────────────────

function ColManager({
  visibility, order, onVisChange, onOrderChange,
}: {
  visibility: VisibilityState;
  order: ColumnOrderState;
  onVisChange: (v: VisibilityState) => void;
  onOrderChange: (o: ColumnOrderState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (id: string) => {
    if (NON_HIDEABLE.has(id)) return;
    onVisChange({ ...visibility, [id]: !visibility[id] });
  };

  const onDragStart = (id: string) => { dragId.current = id; };
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!dragId.current || dragId.current === id) return;
    const from = order.indexOf(dragId.current);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, dragId.current);
    onOrderChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 transition-colors"
      >
        <Settings2 className="w-4 h-4 text-gray-500" />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 p-2 space-y-0.5 max-h-96 overflow-y-auto">
          <p className="text-xs text-gray-400 px-2 py-1">Drag to reorder · Click to show/hide</p>
          {order.map((id) => (
            <div
              key={id}
              draggable
              onDragStart={() => onDragStart(id)}
              onDragOver={(e) => onDragOver(e, id)}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-grab select-none',
                NON_HIDEABLE.has(id) ? 'text-gray-400' : 'hover:bg-gray-50 cursor-pointer',
              )}
              onClick={() => toggle(id)}
            >
              <span className="text-gray-300 text-xs">⠿</span>
              <span className="flex-1">{COL_LABELS[id]}</span>
              {visibility[id] !== false
                ? <Check className="w-3.5 h-3.5 text-brand-600" />
                : <span className="w-3.5 h-3.5" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const qc = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [vendor, setVendor] = useState('');
  const [status, setStatus] = useState('');
  const [inStock, setInStock] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  // Table state — persisted in localStorage
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => loadPref(VIS_KEY, DEFAULT_VIS),
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    () => loadPref(ORD_KEY, ALL_COL_IDS),
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  useEffect(() => { localStorage.setItem(VIS_KEY, JSON.stringify(columnVisibility)); }, [columnVisibility]);
  useEffect(() => { localStorage.setItem(ORD_KEY, JSON.stringify(columnOrder)); }, [columnOrder]);

  // Data
  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, vendor, status, inStock, page, limit }],
    queryFn: () => productsApi.list({ search, vendor, status, inStock: inStock || undefined, page, limit }),
  });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: productsApi.vendors });

  const toggleExclude = useMutation({
    mutationFn: ({ id, exclude }: { id: string; exclude: boolean }) =>
      productsApi.toggleExclude(id, exclude),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  // Bulk exclude
  const bulkExclude = useMutation({
    mutationFn: async ({ productIds, exclude }: { productIds: string[]; exclude: boolean }) => {
      await Promise.all(productIds.map((id) => productsApi.toggleExclude(id, exclude)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setRowSelection({});
    },
  });

  const products = data?.data || [];
  const meta = data?.meta || { total: 0, totalPages: 1 };

  // Expand products → one row per variant
  const rows = useMemo(() => expandVariants(products), [products]);

  // Column helper
  const colHelper = createColumnHelper<VariantRow>();

  const columns = useMemo(() => [
    // Select
    colHelper.display({
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          className="rounded border-gray-300"
          checked={table.getIsAllRowsSelected()}
          ref={(el) => { if (el) el.indeterminate = table.getIsSomeRowsSelected(); }}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="rounded border-gray-300"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
      enableSorting: false,
    }),
    // Thumbnail
    colHelper.display({
      id: 'thumbnail',
      header: 'Image',
      cell: ({ row }) => <Thumb row={row.original} />,
      enableSorting: false,
    }),
    // Product
    colHelper.accessor('productTitle', {
      id: 'product',
      header: 'Product / Variant',
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-gray-800 leading-tight">{row.original.productTitle}</div>
          {row.original.variantTitle !== 'Default Title' && (
            <div className="text-xs text-gray-400 mt-0.5">{row.original.variantTitle}</div>
          )}
        </div>
      ),
    }),
    // SKU
    colHelper.accessor('sku', {
      id: 'sku',
      header: 'SKU',
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-gray-600">{getValue() || '—'}</span>
      ),
    }),
    // Vendor
    colHelper.accessor('vendor', {
      id: 'vendor',
      header: 'Vendor',
      cell: ({ getValue }) => <span className="text-gray-600">{getValue() || '—'}</span>,
    }),
    // Price
    colHelper.accessor('price', {
      id: 'price',
      header: 'Price',
      cell: ({ getValue }) => (
        <span>{CURRENCY}{Number(getValue()).toFixed(2)}</span>
      ),
      sortingFn: (a, b) => Number(a.original.price) - Number(b.original.price),
    }),
    // Compare At
    colHelper.accessor('compareAtPrice', {
      id: 'compareAt',
      header: 'Compare At',
      cell: ({ getValue }) => {
        const v = getValue();
        return v ? <span className="text-gray-400 line-through">{CURRENCY}{Number(v).toFixed(2)}</span> : <span className="text-gray-300">—</span>;
      },
    }),
    // Inventory
    colHelper.accessor('inventoryQuantity', {
      id: 'inventory',
      header: 'Inventory',
      cell: ({ getValue }) => {
        const qty = getValue();
        return (
          <span className={clsx(
            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
            qty > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600',
          )}>
            {qty} units
          </span>
        );
      },
    }),
    // Status
    colHelper.accessor('status', {
      id: 'status',
      header: 'Status',
      cell: ({ getValue }) => (
        <span className={clsx(
          'text-xs font-medium capitalize',
          getValue() === 'active' ? 'text-green-600' : 'text-gray-400',
        )}>
          {getValue()}
        </span>
      ),
    }),
    // Option 1
    colHelper.accessor('option1', {
      id: 'option1',
      header: 'Option 1',
      cell: ({ getValue }) => <span className="text-gray-600 text-xs">{getValue() || '—'}</span>,
    }),
    // Option 2
    colHelper.accessor('option2', {
      id: 'option2',
      header: 'Option 2',
      cell: ({ getValue }) => <span className="text-gray-600 text-xs">{getValue() || '—'}</span>,
    }),
    // Option 3
    colHelper.accessor('option3', {
      id: 'option3',
      header: 'Option 3',
      cell: ({ getValue }) => <span className="text-gray-600 text-xs">{getValue() || '—'}</span>,
    }),
    // Image 1–8
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      colHelper.display({
        id: `image${n}`,
        header: `Image ${n}`,
        cell: ({ row }) => <ImgCell src={row.original.images[n - 1]?.src} />,
        enableSorting: false,
      }),
    ),
    // Video 1–2
    ...[0, 1].map((i) =>
      colHelper.display({
        id: `video${i + 1}`,
        header: `Video ${i + 1}`,
        cell: ({ row }) => <VideoCell row={row.original} index={i} />,
        enableSorting: false,
      }),
    ),
    // Barcode
    colHelper.accessor('barcode', {
      id: 'barcode',
      header: 'Barcode',
      cell: ({ getValue }) => <span className="font-mono text-xs text-gray-500">{getValue() || '—'}</span>,
    }),
    // Exclude
    colHelper.display({
      id: 'exclude',
      header: 'Exclude',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <button
            onClick={() => toggleExclude.mutate({ id: r.productId, exclude: !r.excludeFromFeeds })}
            className={clsx(
              'text-xs px-2 py-1 rounded-md border font-medium transition-colors',
              r.excludeFromFeeds
                ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100',
            )}
          >
            {r.excludeFromFeeds ? 'Excluded' : 'Included'}
          </button>
        );
      },
      enableSorting: false,
    }),
  ], [toggleExclude]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, rowSelection, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (row) => row.variantId,
  });

  // Selected product IDs for bulk ops
  const selectedProductIds = useMemo(() => {
    return [...new Set(
      Object.keys(rowSelection)
        .filter((vId) => rowSelection[vId])
        .map((vId) => rows.find((r) => r.variantId === vId)?.productId)
        .filter(Boolean) as string[],
    )];
  }, [rowSelection, rows]);

  // Header drag-to-reorder
  const dragHeaderId = useRef<string | null>(null);

  const onHeaderDragStart = (colId: string) => { dragHeaderId.current = colId; };
  const onHeaderDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    if (!dragHeaderId.current || dragHeaderId.current === colId) return;
    const from = columnOrder.indexOf(dragHeaderId.current);
    const to = columnOrder.indexOf(colId);
    if (from === -1 || to === -1) return;
    const next = [...columnOrder];
    next.splice(from, 1);
    next.splice(to, 0, dragHeaderId.current);
    setColumnOrder(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Products</h1>
        <ColManager
          visibility={columnVisibility}
          order={columnOrder}
          onVisChange={setColumnVisibility}
          onOrderChange={setColumnOrder}
        />
      </div>

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
          {vendors.map((v: string) => <option key={v} value={v}>{v}</option>)}
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
          <input type="checkbox" checked={inStock} onChange={(e) => { setInStock(e.target.checked); setPage(1); }} className="rounded" />
          In stock only
        </label>
        <span className="ml-auto text-sm text-gray-500">{rows.length} variants</span>
      </div>

      {/* Bulk actions bar */}
      {selectedProductIds.length > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 mb-4 flex items-center gap-4 text-sm">
          <span className="text-brand-700 font-medium">
            {selectedProductIds.length} product{selectedProductIds.length > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => bulkExclude.mutate({ productIds: selectedProductIds, exclude: true })}
            disabled={bulkExclude.isPending}
            className="px-3 py-1.5 bg-red-500 text-white rounded-md text-xs font-medium hover:bg-red-600 disabled:opacity-50"
          >
            Exclude from feeds
          </button>
          <button
            onClick={() => bulkExclude.mutate({ productIds: selectedProductIds, exclude: false })}
            disabled={bulkExclude.isPending}
            className="px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Include in feeds
          </button>
          <button
            onClick={() => setRowSelection({})}
            className="ml-auto text-gray-500 hover:text-gray-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {isLoading ? (
          <div className="py-20 text-center text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center text-gray-400">No products found. Run a sync first.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className={clsx(
                          'text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap select-none',
                          canSort && 'cursor-pointer hover:bg-gray-100',
                          header.id !== 'select' && 'cursor-grab',
                        )}
                        draggable={header.id !== 'select'}
                        onDragStart={() => onHeaderDragStart(header.id)}
                        onDragOver={(e) => onHeaderDragOver(e, header.id)}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === 'asc' ? <ChevronUp className="w-3 h-3" /> :
                            sorted === 'desc' ? <ChevronDown className="w-3 h-3" /> :
                            <ChevronsUpDown className="w-3 h-3 text-gray-300" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={clsx(
                    'hover:bg-gray-50 transition-colors',
                    row.getIsSelected() && 'bg-brand-50',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
        <span>Page {page} of {meta.totalPages} · {meta.total} products</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
            disabled={page >= meta.totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
