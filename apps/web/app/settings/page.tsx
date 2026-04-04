'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, ExternalLink } from 'lucide-react';

function SettingsInner() {
  const params = useSearchParams();
  const googleConnected = params.get('google_connected') === 'true';
  const shop = params.get('shop') || '';

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Google Sheets */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-medium text-gray-700">Google Sheets Integration</h2>

        {googleConnected ? (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle className="w-4 h-4" />
            Google account connected successfully!
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Connect your Google account to export feeds directly to Google Sheets.
          </p>
        )}

        <a
          href={`${API_URL}/auth/google?shop=${shop}`}
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

      {/* Sync */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-medium text-gray-700">Product Sync</h2>
        <p className="text-sm text-gray-500">
          Trigger a full product re-sync from Shopify. This uses the Bulk Operations API and may take a few minutes.
        </p>
        <button
          onClick={async () => {
            const shopDomain = prompt('Enter shop domain (e.g. mystore.myshopify.com):');
            if (!shopDomain) return;
            try {
              const res = await fetch(`${API_URL}/shopify/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopDomain }),
              });
              const data = await res.json();
              alert(data.message || 'Sync started');
            } catch {
              alert('Failed to trigger sync');
            }
          }}
          className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Trigger Full Sync
        </button>
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
