'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { feedsApi } from '../../../lib/api';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const PLATFORMS = ['GOOGLE', 'FACEBOOK', 'PINTEREST'];
const OUTPUT_TYPES = ['CSV', 'XML', 'GOOGLE_SHEETS'];
const SOURCE_TYPES = ['product', 'variant', 'metafield', 'computed', 'fixed'];

const COMPUTED_KEYS = [
  'image_url', 'all_images', 'image_url_2', 'image_url_3',
  'video_url', 'inventory', 'availability', 'product_url', 'full_title', 'base_sku',
];
const PRODUCT_KEYS = ['title', 'vendor', 'product_type', 'handle', 'tags', 'description', 'body_html'];
const VARIANT_KEYS = [
  'sku', 'price', 'compare_at_price', 'barcode',
  'option1', 'option2', 'option3', 'weight', 'weight_unit', 'inventory', 'taxable',
];

const FILTER_FIELDS = [
  { value: 'product_type', label: 'Product Type' },
  { value: 'vendor',       label: 'Vendor' },
  { value: 'availability', label: 'Availability' },
  { value: 'status',       label: 'Status' },
  { value: 'sku',          label: 'SKU' },
  { value: 'price',        label: 'Price' },
  { value: 'inventory',    label: 'Inventory' },
];
const FILTER_OPERATORS = [
  { value: 'in',       label: 'is one of' },
  { value: 'eq',       label: 'equals' },
  { value: 'neq',      label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'gt',       label: '>' },
  { value: 'lt',       label: '<' },
  { value: 'gte',      label: '>=' },
  { value: 'lte',      label: '<=' },
];

function getSourceKeys(sourceType: string): string[] {
  if (sourceType === 'product') return PRODUCT_KEYS;
  if (sourceType === 'variant') return VARIANT_KEYS;
  if (sourceType === 'computed') return COMPUTED_KEYS;
  return [];
}

// Default Google Merchant mapping
const DEFAULT_GOOGLE_MAPPINGS = [
  { feedColumn: 'g:id',           sourceType: 'variant',  sourceKey: 'sku',          transform: ''             },
  { feedColumn: 'g:title',        sourceType: 'computed', sourceKey: 'full_title',   transform: ''             },
  { feedColumn: 'g:description',  sourceType: 'product',  sourceKey: 'description',  transform: 'truncate:5000'},
  { feedColumn: 'g:link',         sourceType: 'computed', sourceKey: 'product_url',  transform: ''             },
  { feedColumn: 'g:image_link',   sourceType: 'computed', sourceKey: 'image_url',    transform: ''             },
  { feedColumn: 'g:price',        sourceType: 'variant',  sourceKey: 'price',        transform: 'append: INR'  },
  { feedColumn: 'g:availability', sourceType: 'computed', sourceKey: 'availability', transform: ''             },
  { feedColumn: 'g:brand',        sourceType: 'product',  sourceKey: 'vendor',       transform: ''             },
  { feedColumn: 'g:gtin',         sourceType: 'variant',  sourceKey: 'barcode',      transform: ''             },
  { feedColumn: 'g:condition',    sourceType: 'fixed',    sourceKey: 'new',          transform: ''             },
];

export default function NewFeedPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Fetch connected Google Sheets
  const { data: sheetsData } = useQuery({
    queryKey: ['google-sheets'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/auth/google/sheets`);
      if (!res.ok) return { sheets: [] };
      return res.json() as any;
    },
  });
  const googleSheets: { id: string; name: string }[] = sheetsData?.sheets || [];

  const { register, control, handleSubmit, watch, setValue } = useForm({
    defaultValues: {
      name:            '',
      platform:        'GOOGLE',
      country:         'IN',
      outputType:      'CSV',
      googleSheetId:   '',
      googleSheetTab:  'Feed',
      columnMappings:  DEFAULT_GOOGLE_MAPPINGS,
      filterRules:     [] as { field: string; operator: string; value: string }[],
      scheduleEnabled: false,
      cronExpr:        '0 */6 * * *',
    },
  });

  const { fields, append, remove }                            = useFieldArray({ control, name: 'columnMappings' });
  const { fields: filterFields, append: appendFilter,
          remove: removeFilter }                              = useFieldArray({ control, name: 'filterRules' });
  const scheduleEnabled  = watch('scheduleEnabled');
  const watchedMappings  = watch('columnMappings');

  const applyTemplate = (p: string) => {
    if (p.toUpperCase() === 'GOOGLE') setValue('columnMappings', DEFAULT_GOOGLE_MAPPINGS as any);
  };

  const onSubmit = async (data: any) => {
    setSaving(true); setError('');
    try {
      await feedsApi.create({
        name:           data.name,
        platform:       data.platform,
        country:        data.country,
        outputType:     data.outputType,
        googleSheetId:  data.googleSheetId  || null,
        googleSheetTab: data.googleSheetTab || null,
        columnMappings: data.columnMappings,
        filterRules:    data.filterRules,
        ...(data.scheduleEnabled && { schedule: { cronExpr: data.cronExpr } }),
      });
      router.push('/feeds');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create feed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/feeds" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">Create Feed</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Info */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-medium text-gray-700">Basic Information</h2>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Feed Name</label>
            <input
              {...register('name', { required: true })}
              placeholder="My Google Feed – IN"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Platform</label>
              <input
                {...register('platform')}
                list="new-platform-list"
                placeholder="e.g. GOOGLE"
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <datalist id="new-platform-list">
                {PLATFORMS.map((p) => <option key={p} value={p} />)}
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
          {googleSheets.length === 0 && (
            <p className="text-xs text-gray-400">
              Connect Google in{' '}
              <Link href="/settings" className="underline text-brand-600">Settings</Link>
              {' '}to browse your sheets, or enter the Sheet ID manually.
            </p>
          )}
        </section>

        {/* Filter Rules */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-medium text-gray-700">Product Filters</h2>
              <p className="text-xs text-gray-400 mt-0.5">Only products matching ALL rules will be included in the feed.</p>
            </div>
            <button
              type="button"
              onClick={() => appendFilter({ field: 'product_type', operator: 'in', value: '' })}
              className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md"
            >
              <Plus className="w-3 h-3" /> Add Filter
            </button>
          </div>

          {filterFields.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No filters — all active products will be included.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1.5fr_1.2fr_2fr_auto] gap-2 text-xs font-medium text-gray-500 px-1">
                <span>Field</span>
                <span>Operator</span>
                <span>Value(s) — comma separated for "is one of"</span>
                <span />
              </div>
              {filterFields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1.5fr_1.2fr_2fr_auto] gap-2 items-center">
                  <select
                    {...register(`filterRules.${i}.field`)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    {FILTER_FIELDS.map((ff) => (
                      <option key={ff.value} value={ff.value}>{ff.label}</option>
                    ))}
                  </select>
                  <select
                    {...register(`filterRules.${i}.operator`)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    {FILTER_OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                  <input
                    {...register(`filterRules.${i}.value`)}
                    placeholder='e.g. Lehenga, Gown, Co-ordset'
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeFilter(i)}
                    className="text-red-400 hover:text-red-600 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
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
              <span>Source Key / Value</span>
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
                  {srcType === 'metafield' || srcType === 'fixed' ? (
                    <input
                      {...register(`columnMappings.${i}.sourceKey`)}
                      placeholder={srcType === 'fixed' ? 'literal value to output' : 'namespace.key'}
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
                    placeholder="e.g. map:Lehenga=Apparel"
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                  />
                  <button type="button" onClick={() => remove(i)} className="text-red-400 hover:text-red-600 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Transforms: <code>uppercase</code>, <code>lowercase</code>, <code>truncate:150</code>, <code>append: INR</code>, <code>default:new</code>, <code>map:From=To|From2=To2</code>
          </p>
        </section>

        {/* Schedule */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="sched" {...register('scheduleEnabled')} className="rounded" />
            <label htmlFor="sched" className="font-medium text-gray-700 cursor-pointer">Enable Schedule</label>
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

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-brand-600 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Feed'}
          </button>
          <Link href="/feeds" className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
