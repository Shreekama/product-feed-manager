'use client';

import { Suspense, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { feedsApi } from '../../../lib/api';
import { format } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Plus, Trash2,
  Play, Save,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { parseDate } from '../../../lib/dates';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const OUTPUT_TYPES = ['CSV', 'XML', 'GOOGLE_SHEETS'];
const SOURCE_TYPES = ['product', 'variant', 'metafield', 'computed'];
const COMPUTED_KEYS = [
  'image_url', 'all_images', 'image_url_2', 'image_url_3',
  'video_url', 'inventory', 'availability', 'product_url', 'full_title', 'base_sku',
];
const PRODUCT_KEYS = ['title', 'vendor', 'product_type', 'handle', 'tags', 'description', 'body_html'];
const VARIANT_KEYS = [
  'sku', 'price', 'compare_at_price', 'barcode',
  'option1', 'option2', 'option3', 'weight', 'weight_unit', 'inventory', 'taxable',
];

function getSourceKeys(sourceType: string): string[] {
  if (sourceType === 'product') return PRODUCT_KEYS;
  if (sourceType === 'variant') return VARIANT_KEYS;
  if (sourceType === 'computed') return COMPUTED_KEYS;
  return [];
}

function parseJsonField(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
  return [];
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  SUCCESS: { label: 'Success', icon: CheckCircle, color: 'text-green-600' },
  FAILED:  { label: 'Failed',  icon: XCircle,     color: 'text-red-600'   },
  RUNNING: { label: 'Running', icon: Clock,        color: 'text-blue-600'  },
  PENDING: { label: 'Pending', icon: Clock,        color: 'text-yellow-600'},
};

// ── Edit form inner ───────────────────────────────────────────────────────────

function FeedEditInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = searchParams.get('id') ?? '';

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedOk, setSavedOk]     = useState(false);
  const [formReady, setFormReady] = useState(false);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);
  const [sheetChecking, setSheetChecking] = useState(false);

  // ── Feed data ──────────────────────────────────────────────────────────────
  const { data: feed, isLoading } = useQuery({
    queryKey: ['feed', id],
    queryFn: () => feedsApi.get(id),
    enabled: !!id,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ['feed-runs', id],
    queryFn: () => feedsApi.getRuns(id, 20),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  // ── Google sheets list ─────────────────────────────────────────────────────
  const { data: sheetsData } = useQuery({
    queryKey: ['google-sheets'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/auth/google/sheets`);
      if (!res.ok) return { sheets: [] };
      return res.json() as any;
    },
  });
  const googleSheets: { id: string; name: string }[] = sheetsData?.sheets || [];

  // ── Trigger run ────────────────────────────────────────────────────────────
  const triggerRun = useMutation({
    mutationFn: () => feedsApi.triggerRun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed-runs', id] }),
  });

  // ── Form ───────────────────────────────────────────────────────────────────
  const { register, control, handleSubmit, watch, reset } = useForm({
    defaultValues: {
      name: '',
      platform: '',
      country: '',
      outputType: 'CSV',
      googleSheetId: '',
      googleSheetTab: 'Feed',
      columnMappings: [] as { feedColumn: string; sourceType: string; sourceKey: string; transform: string }[],
      scheduleEnabled: false,
      cronExpr: '0 */6 * * *',
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'columnMappings' });
  const scheduleEnabled  = watch('scheduleEnabled');
  const watchedMappings  = watch('columnMappings');
  const watchedSheetId   = watch('googleSheetId');

  // Verify the sheet ID whenever it changes (debounced)
  useEffect(() => {
    const trimmed = (watchedSheetId || '').trim();
    if (!trimmed) { setSheetTitle(null); return; }
    // Skip verification if it came from the dropdown (already verified by the list)
    if (googleSheets.some((s) => s.id === trimmed)) {
      setSheetTitle(googleSheets.find((s) => s.id === trimmed)?.name || null);
      return;
    }
    const timer = setTimeout(async () => {
      setSheetChecking(true);
      try {
        const res = await fetch(`${API_URL}/auth/google/sheet-info?sheetId=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json() as any;
          setSheetTitle(data.title || null);
        } else {
          setSheetTitle(null);
        }
      } catch { setSheetTitle(null); }
      finally { setSheetChecking(false); }
    }, 800);
    return () => clearTimeout(timer);
  }, [watchedSheetId, googleSheets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Populate form when feed loads (once)
  useEffect(() => {
    if (feed && !formReady) {
      const mappings = parseJsonField(feed.columnMappings);
      reset({
        name:            feed.name,
        platform:        feed.platform    || '',
        country:         feed.country     || '',
        outputType:      feed.outputType  || 'CSV',
        googleSheetId:   (feed as any).googleSheetId  || '',
        googleSheetTab:  (feed as any).googleSheetTab || 'Feed',
        columnMappings:  mappings,
        scheduleEnabled: !!(feed as any).schedule,
        cronExpr:        (feed as any).schedule?.cronExpr || '0 */6 * * *',
      });
      setFormReady(true);
    }
  }, [feed, formReady, reset]);

  const onSubmit = async (data: any) => {
    setSaving(true); setSaveError(''); setSavedOk(false);
    try {
      await feedsApi.update(id, {
        name:           data.name,
        platform:       data.platform,
        country:        data.country,
        outputType:     data.outputType,
        googleSheetId:  data.googleSheetId  || null,
        googleSheetTab: data.googleSheetTab || null,
        columnMappings: data.columnMappings,
        ...(data.scheduleEnabled && { schedule: { cronExpr: data.cronExpr } }),
      });
      qc.invalidateQueries({ queryKey: ['feed', id] });
      qc.invalidateQueries({ queryKey: ['feeds'] });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err: any) {
      setSaveError(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!id)        return <div className="py-20 text-center text-red-500">No feed ID specified</div>;
  if (isLoading)  return <div className="py-20 text-center text-gray-400">Loading…</div>;
  if (!feed)      return <div className="py-20 text-center text-red-500">Feed not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/feeds" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-semibold">Edit Feed</h1>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
            {(feed as any).platform}
          </span>
        </div>
        <button
          type="button"
          onClick={() => triggerRun.mutate()}
          disabled={triggerRun.isPending}
          className="inline-flex items-center gap-1.5 text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-3 py-1.5 rounded-md font-medium"
        >
          <Play className="w-3 h-3" />
          {triggerRun.isPending ? 'Starting…' : 'Run Now'}
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Info */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-medium text-gray-700">Basic Information</h2>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Feed Name</label>
            <input
              {...register('name', { required: true })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Platform</label>
              <input
                {...register('platform')}
                list="edit-platform-list"
                placeholder="e.g. GOOGLE"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <datalist id="edit-platform-list">
                {['GOOGLE', 'FACEBOOK', 'PINTEREST'].map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Country</label>
              <input
                {...register('country')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Output Type</label>
              <select {...register('outputType')} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                {OUTPUT_TYPES.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Google Sheet */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-medium text-gray-700">Google Sheet Output</h2>
          <div className="grid grid-cols-[1fr_180px] gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Sheet</label>
              {googleSheets.length > 0 ? (
                <select
                  {...register('googleSheetId')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">— select a sheet —</option>
                  {googleSheets.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  {...register('googleSheetId')}
                  placeholder="Sheet ID (e.g. 1BxiMVs0XYZ…)"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Tab Name</label>
              <input
                {...register('googleSheetTab')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          {/* Sheet verification badge */}
          {watchedSheetId && (
            <div className="text-xs">
              {sheetChecking ? (
                <span className="text-gray-400">Checking sheet…</span>
              ) : sheetTitle ? (
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> {sheetTitle}
                </span>
              ) : (
                <span className="text-red-500">Sheet not found or no access</span>
              )}
            </div>
          )}
          {googleSheets.length === 0 && (
            <p className="text-xs text-gray-400">
              Connect Google in{' '}
              <Link href="/settings" className="underline text-brand-600">Settings</Link>
              {' '}to browse your sheets, or enter the Sheet ID manually.
            </p>
          )}
        </section>

        {/* Column Mappings */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-gray-700">Column Mappings</h2>
            <button
              type="button"
              onClick={() => append({ feedColumn: '', sourceType: 'product', sourceKey: '', transform: '' })}
              className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md"
            >
              <Plus className="w-3 h-3" /> Add Row
            </button>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[2fr_1fr_2fr_1.5fr_auto] gap-2 text-xs font-medium text-gray-500 px-1">
              <span>Feed Column</span>
              <span>Source Type</span>
              <span>Source Key</span>
              <span>Transform</span>
              <span />
            </div>

            {fields.map((field, i) => {
              const srcType = watchedMappings?.[i]?.sourceType || 'product';
              const keys    = getSourceKeys(srcType);
              return (
                <div key={field.id} className="grid grid-cols-[2fr_1fr_2fr_1.5fr_auto] gap-2 items-center">
                  <input
                    {...register(`columnMappings.${i}.feedColumn`)}
                    placeholder="g:title"
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <select
                    {...register(`columnMappings.${i}.sourceType`)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {srcType === 'metafield' ? (
                    <input
                      {...register(`columnMappings.${i}.sourceKey`)}
                      placeholder="namespace.key"
                      className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  ) : (
                    <select
                      {...register(`columnMappings.${i}.sourceKey`)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs"
                    >
                      <option value="">— select field —</option>
                      {keys.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  )}
                  <input
                    {...register(`columnMappings.${i}.transform`)}
                    placeholder="e.g. uppercase"
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-red-400 hover:text-red-600 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Schedule */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="sched-edit" {...register('scheduleEnabled')} className="rounded" />
            <label htmlFor="sched-edit" className="font-medium text-gray-700 cursor-pointer">Enable Schedule</label>
          </div>
          {scheduleEnabled && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Cron Expression (UTC)</label>
              <input
                {...register('cronExpr')}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm font-mono w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Examples: <code>0 */6 * * *</code> (every 6h), <code>0 9 * * *</code> (daily 9 AM UTC)
              </p>
            </div>
          )}
        </section>

        {saveError && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {saveError}
          </p>
        )}

        <div className="flex gap-3 items-center">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-brand-600 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <Link href="/feeds" className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            Cancel
          </Link>
          {savedOk && (
            <span className="flex items-center gap-1.5 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" /> Saved!
            </span>
          )}
        </div>
      </form>

      {/* Run History */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-700">Run History</h2>
          <button
            type="button"
            onClick={() => triggerRun.mutate()}
            disabled={triggerRun.isPending}
            className="inline-flex items-center gap-1.5 text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-3 py-1.5 rounded-md font-medium"
          >
            <Play className="w-3 h-3" />
            {triggerRun.isPending ? 'Starting…' : 'Run Now'}
          </button>
        </div>

        {(runs as any[]).length === 0 ? (
          <p className="text-gray-400 text-sm">No runs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                {['Status', 'Records', 'Skipped', 'Duration', 'Started', 'Output'].map((h) => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(runs as any[]).map((run) => {
                const cfg  = STATUS_CONFIG[run.status] || { label: run.status, icon: Clock, color: 'text-gray-500' };
                const Icon = cfg.icon;
                return (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="py-2 px-2">
                      <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', cfg.color)}>
                        <Icon className="w-3.5 h-3.5" />{cfg.label}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-gray-700">{run.recordsProcessed ?? '—'}</td>
                    <td className="py-2 px-2 text-gray-400">{run.recordsSkipped ?? '—'}</td>
                    <td className="py-2 px-2 text-gray-500">
                      {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="py-2 px-2 text-gray-500">
                      {(() => { const d = parseDate(run.startedAt); return d ? format(d, 'MMM d HH:mm:ss') : '—'; })()}
                    </td>
                    <td className="py-2 px-2 text-xs">
                      {run.outputUrl ? (
                        run.outputUrl.startsWith('http') ? (
                          <a href={run.outputUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                            Open
                          </a>
                        ) : (
                          <span title={run.outputUrl}>{run.outputUrl.split('/').pop()}</span>
                        )
                      ) : run.errorMessage ? (
                        <span className="text-red-400" title={run.errorMessage}>Error</span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function FeedEditPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-gray-400">Loading…</div>}>
      <FeedEditInner />
    </Suspense>
  );
}
