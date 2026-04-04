'use client';

import { useQuery } from '@tanstack/react-query';
import { feedsApi } from '../../lib/api';
import { format } from 'date-fns';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  SUCCESS: { label: 'Success', icon: CheckCircle, color: 'text-green-600' },
  FAILED: { label: 'Failed', icon: XCircle, color: 'text-red-600' },
  RUNNING: { label: 'Running', icon: Clock, color: 'text-blue-600' },
  PENDING: { label: 'Pending', icon: Clock, color: 'text-yellow-600' },
};

export default function FeedDetailPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';

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

  if (!id) return <div className="py-20 text-center text-red-500">No feed ID specified</div>;
  if (isLoading) return <div className="py-20 text-center text-gray-400">Loading…</div>;
  if (!feed) return <div className="py-20 text-center text-red-500">Feed not found</div>;

  const mappings = (feed.columnMappings as any[]) || [];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/feeds" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">{feed.name}</h1>
        <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
          {feed.platform}
        </span>
      </div>

      {/* Config summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-3 gap-4 text-sm">
        <div><span className="text-gray-500">Platform</span><div className="font-medium mt-0.5">{feed.platform}</div></div>
        <div><span className="text-gray-500">Country</span><div className="font-medium mt-0.5">{feed.country}</div></div>
        <div><span className="text-gray-500">Output</span><div className="font-medium mt-0.5">{feed.outputType}</div></div>
        <div><span className="text-gray-500">Status</span><div className="font-medium mt-0.5 capitalize">{feed.status.toLowerCase()}</div></div>
        <div>
          <span className="text-gray-500">Schedule</span>
          <div className="font-medium mt-0.5">
            {feed.schedule ? (
              <span>{feed.schedule.cronExpr} <span className="text-gray-400 text-xs">(next: {format(new Date(feed.schedule.nextRunAt), 'MMM d HH:mm')})</span></span>
            ) : 'Manual only'}
          </div>
        </div>
        <div><span className="text-gray-500">Mappings</span><div className="font-medium mt-0.5">{mappings.length} columns</div></div>
      </div>

      {/* Column mappings */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium text-gray-700 mb-4">Column Mappings</h2>
        <div className="space-y-1">
          <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-500 px-1 mb-2">
            <span>Feed Column</span><span>Source</span><span>Field</span><span>Transform</span>
          </div>
          {mappings.map((m: any, i: number) => (
            <div key={i} className="grid grid-cols-4 gap-2 text-xs py-1 px-1 rounded hover:bg-gray-50">
              <span className="font-mono font-medium text-brand-700">{m.feedColumn}</span>
              <span className="text-gray-500 capitalize">{m.sourceType}</span>
              <span className="font-mono text-gray-600">{m.sourceKey}</span>
              <span className="text-gray-400">{m.transform || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Run history */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium text-gray-700 mb-4">Run History</h2>
        {runs.length === 0 ? (
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
              {runs.map((run: any) => {
                const cfg = STATUS_CONFIG[run.status] || { label: run.status, icon: Clock, color: 'text-gray-500' };
                const Icon = cfg.icon;
                return (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="py-2 px-2">
                      <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', cfg.color)}>
                        <Icon className="w-3.5 h-3.5" />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-gray-700">{run.recordsProcessed}</td>
                    <td className="py-2 px-2 text-gray-400">{run.recordsSkipped}</td>
                    <td className="py-2 px-2 text-gray-500">
                      {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="py-2 px-2 text-gray-500">
                      {format(new Date(run.startedAt), 'MMM d HH:mm:ss')}
                    </td>
                    <td className="py-2 px-2 text-gray-400 text-xs truncate max-w-[200px]">
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
