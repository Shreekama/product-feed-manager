'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { feedsApi } from '../../lib/api';
import Link from 'next/link';
import { format } from 'date-fns';
import { Plus, Play, Pencil, Trash2, Clock } from 'lucide-react';
import { clsx } from 'clsx';

const PLATFORM_BADGE: Record<string, string> = {
  GOOGLE: 'bg-blue-100 text-blue-700',
  FACEBOOK: 'bg-indigo-100 text-indigo-700',
  PINTEREST: 'bg-red-100 text-red-600',
};

export default function FeedsPage() {
  const qc = useQueryClient();

  const { data: feeds = [], isLoading } = useQuery({
    queryKey: ['feeds'],
    queryFn: feedsApi.list,
  });

  const deleteFeed = useMutation({
    mutationFn: (id: string) => feedsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feeds'] }),
  });

  const triggerRun = useMutation({
    mutationFn: (id: string) => feedsApi.triggerRun(id),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Feeds</h1>
        <Link
          href="/feeds/new"
          className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700"
        >
          <Plus className="w-4 h-4" />
          New Feed
        </Link>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-gray-400">Loading…</div>
      ) : feeds.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          No feeds yet.{' '}
          <Link href="/feeds/new" className="text-brand-600 underline">
            Create one
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed: any) => {
            const lastRun = feed.runs?.[0];
            return (
              <div
                key={feed.id}
                className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4"
              >
                {/* Platform badge */}
                <span
                  className={clsx(
                    'shrink-0 text-xs font-medium px-2.5 py-1 rounded-full',
                    PLATFORM_BADGE[feed.platform] || 'bg-gray-100 text-gray-600',
                  )}
                >
                  {feed.platform}
                </span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{feed.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {feed.country} · {feed.outputType}
                    {lastRun && (
                      <span className="ml-2">
                        Last run:{' '}
                        <span
                          className={clsx(
                            lastRun.status === 'SUCCESS' ? 'text-green-600' : 'text-red-500',
                          )}
                        >
                          {lastRun.status}
                        </span>{' '}
                        ({lastRun.recordsProcessed} records)
                      </span>
                    )}
                  </div>
                </div>

                {/* Next run */}
                {feed.schedule?.nextRunAt && (
                  <div className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {format(new Date(feed.schedule.nextRunAt), 'MMM d, HH:mm')}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => triggerRun.mutate(feed.id)}
                    disabled={triggerRun.isPending}
                    className="inline-flex items-center gap-1 text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-3 py-1.5 rounded-md font-medium transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    Run
                  </button>
                  <Link
                    href={`/feeds/${feed.id}`}
                    className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm(`Delete feed "${feed.name}"?`)) {
                        deleteFeed.mutate(feed.id);
                      }
                    }}
                    className="inline-flex items-center text-xs text-red-400 hover:text-red-600 px-2 py-1.5 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
