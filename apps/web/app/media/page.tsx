'use client';

import { useState } from 'react';
import { mediaApi } from '../../lib/api';
import { Search, ImageIcon } from 'lucide-react';

export default function MediaPage() {
  const [sku, setSku] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resolve = async () => {
    if (!sku.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await mediaApi.resolve(sku.trim());
      setResult(data);
    } catch (e: any) {
      setError('Failed to resolve media');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">Media Preview</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <p className="text-sm text-gray-600">
          Enter a variant SKU to view its Shopify CDN images as they will appear in your product feeds.
        </p>

        <div className="flex gap-3">
          <input
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resolve()}
            placeholder="e.g. SKKE-LHNSTI-0001-01L"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={resolve}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Looking up…' : 'Lookup'}
          </button>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        {result && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">SKU</span>
                <div className="font-mono font-medium">{result.sku}</div>
              </div>
              <div>
                <span className="text-gray-500">Base SKU</span>
                <div className="font-mono font-medium text-brand-700">{result.baseSku || '—'}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="w-4 h-4 text-gray-500" />
                <h3 className="font-medium text-sm">
                  Product Images ({result.images?.length || 0})
                </h3>
                <span className="text-xs text-gray-400 ml-1">from Shopify CDN</span>
              </div>

              {result.images?.length > 0 ? (
                <div className="grid grid-cols-4 gap-3">
                  {result.images.map((url: string, i: number) => (
                    <div key={i} className="space-y-1">
                      <img
                        src={url}
                        alt={result.imageDetails?.[i]?.altText || `Image ${i + 1}`}
                        className="w-full aspect-square object-cover rounded-lg border border-gray-200 bg-gray-50"
                        onError={(e) => {
                          (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                        }}
                      />
                      <p className="text-xs text-gray-400 text-center">
                        #{i + 1}{i === 0 && ' · primary'}
                      </p>
                      {result.imageDetails?.[i]?.width && (
                        <p className="text-xs text-gray-300 text-center">
                          {result.imageDetails[i].width}×{result.imageDetails[i].height}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
                  No images found for this SKU.
                  <br />
                  <span className="text-xs">Run a full sync from Settings to import product images.</span>
                </div>
              )}
            </div>

            {result.primaryImage && (
              <div className="text-xs text-gray-400 bg-gray-50 rounded-md px-3 py-2 font-mono truncate">
                <span className="text-gray-500 font-sans mr-2">feed image_url →</span>
                {result.primaryImage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
