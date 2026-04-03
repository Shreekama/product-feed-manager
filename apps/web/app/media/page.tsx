'use client';

import { useState } from 'react';
import { mediaApi } from '../../lib/api';
import { Search, Image, Video } from 'lucide-react';

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
      setError(e.response?.data?.message || 'Failed to resolve media');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold mb-6">Media Preview</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <p className="text-sm text-gray-600">
          Enter a variant SKU to resolve its media URLs using the deterministic SKU-based naming convention.
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
            {loading ? 'Resolving…' : 'Resolve'}
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
                <span className="text-gray-500">Base SKU (size removed)</span>
                <div className="font-mono font-medium text-brand-700">{result.baseSku}</div>
              </div>
            </div>

            {/* Images */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Image className="w-4 h-4 text-gray-500" />
                <h3 className="font-medium text-sm">
                  Images ({result.images?.length || 0})
                </h3>
              </div>
              {result.images?.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {result.images.map((url: string, i: number) => (
                    <div key={i} className="space-y-1">
                      <img
                        src={url}
                        alt={`Image ${i + 1}`}
                        className="w-full aspect-square object-cover rounded-md border border-gray-200 bg-gray-50"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <p className="text-xs text-gray-400 truncate" title={url}>
                        _{String(i + 1).padStart(2, '0')}
                        {i === 0 && ' (primary)'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No images found</p>
              )}
            </div>

            {/* Videos */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Video className="w-4 h-4 text-gray-500" />
                <h3 className="font-medium text-sm">
                  Videos ({result.videos?.length || 0})
                </h3>
              </div>
              {result.videos?.length > 0 ? (
                <ul className="space-y-1">
                  {result.videos.map((url: string, i: number) => (
                    <li key={i}>
                      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline font-mono">
                        {url.split('/').pop()}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400 italic">No videos found</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
