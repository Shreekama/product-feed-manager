'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { feedsApi } from '../lib/api';
import { format } from 'date-fns';
import { parseDate } from '../lib/dates';
import { CheckCircle, XCircle, Clock, Play, Rss } from 'lucide-react';
import Link from 'next/link';

const PLATFORM_LABELS: Record<string, string> = {
  GOOGLE: 'Google Merchant',
  FACEBOOK: 'Facebook Catalog',
  PINTEREST: 'Pinterest',
};

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: 'text-green-600',
  FAILED: 'text-red-600',
  RUNNING: 'text-blue-600',
  PENDING: 'text-yellow-600',
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'SUCCESS') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'FAILED') return <XCircle className="w-4 h-4 text-red-500" />;
  return <Clock className="w-4 h-4 text-yellow-500" />;
}

export default function DashboardPage() {
  const { data: feeds = [], isLoading } = useQuery({
    queryKey: ['feeds-dashboard'],
    queryFn: feedsApi.dashboard,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Feed Dashboard</h1>
        <Link
          href="/feeds/new"
          className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Rss className="w-4 h-4" />
          New Feed
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-gray-400">Loading feeds…</div>
      ) : feeds.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          No feeds yet.{' '}
          <Link href="/feeds/new" className="text-brand-600 underline">
            Create your first feed
          </Link>
          .
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Feed Name', 'Platform', 'Country', 'Output', 'Status', 'Last Run', 'Next Run', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {feeds.map((feed: any) => (
                <tr key={feed.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium">{feed.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {PLATFORM_LABELS[feed.platform] || feed.platform}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{feed.country}</td>
                  <td className="px-4 py-3 text-gray-600">{feed.outputType}</td>
                  <td className="px-4 py-3">
                    {feed.lastRun ? (
                      <span
                        className={`inline-flex items-center gap-1 ${STATUS_COLORS[feed.lastRun.status] || 'text-gray-500'}`}
                      >
                        <StatusIcon status={feed.lastRun.status} />
                        {feed.lastRun.status}
                      </span>
                    ) : (
                      <span className="text-gray-400">Never run</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {(() => {
                      const d = parseDate(feed.lastRun?.completedAt) ?? parseDate(feed.lastRun?.startedAt);
                      return d ? format(d, 'MMM d, HH:mm') : '—';
                    })()}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {feed.nextRun && parseDate(feed.nextRun)
                      ? format(parseDate(feed.nextRun)!, 'MMM d, HH:mm')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/feeds/detail?id=${feed.id}`}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Edit
                      </Link>
                      <RunButton feedId={feed.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunButton({ feedId }: { feedId: string }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const run = useMutation({
    mutationFn: () => feedsApi.triggerRun(feedId),
    onSuccess: () => {
      setMsg({ text: 'Run queued', ok: true });
      qc.invalidateQueries({ queryKey: ['feeds-dashboard'] });
      setTimeout(() => setMsg(null), 4000);
    },
    onError: () => {
      setMsg({ text: 'Failed to queue run', ok: false });
      setTimeout(() => setMsg(null), 5000);
    },
  });

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => run.mutate()}
        disabled={run.isPending}
        className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded transition-colors disabled:opacity-50"
      >
        <Play className="w-3 h-3" />
        {run.isPending ? 'Queuing…' : 'Run'}
      </button>
      {msg && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}
        >
          {msg.ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {msg.text}
        </span>
      )}
    </span>
  );
}
