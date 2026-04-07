'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { feedsApi } from '../../lib/api';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Plus, Play, Pencil, Trash2, Clock } from 'lucide-react';
import { clsx } from 'clsx';

const PLATFORM_BADGE: Record<string, string> = {
  GOOGLE: 'bg-blue-100 text-blue-700',
  FACEBOOK: 'bg-indigo-100 text-indigo-700',
  PINTEREST: 'bg-red-100 text-red-600',
};

/** Convert a UTC cron expression to a human-readable IST description. */
function cronToHumanIST(expr: string): string {
  try {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const [minPart, hourPart, , , dowPart] = parts;

    if (hourPart === '*' && minPart.startsWith('*/')) return `Every ${minPart.slice(2)} minutes`;
    if (hourPart.startsWith('*/')) return `Every ${hourPart.slice(2)} hours`;
    if (hourPart === '*') return 'Every hour';

    const utcH = parseInt(hourPart, 10);
    const utcM = parseInt(minPart, 10);
    if (isNaN(utcH) || isNaN(utcM)) return expr;

    const totalMin = utcH * 60 + utcM + 330; // UTC → IST (+5:30)
    const istH = Math.floor(totalMin / 60) % 24;
    const istM = totalMin % 60;
    const period = istH >= 12 ? 'PM' : 'AM';
    const displayH = istH % 12 || 12;
    const timeStr = `${displayH}:${istM.toString().padStart(2, '0')} ${period} IST`;

    if (dowPart === '*') return `Daily at ${timeStr}`;
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNum = parseInt(dowPart, 10);
    if (!isNaN(dayNum) && DAYS[dayNum]) return `Every ${DAYS[dayNum]} at ${timeStr}`;
    return `At ${timeStr}`;
  } catch { return expr; }
}

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
          <Link href="/feeds/new" className="text-brand-600 underline">Create one</Link>.
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed: any) => {
            const lastRun = feed.runs?.[0];
            const schedule = feed.schedule;
            return (
              <div key={feed.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
                <span className={clsx(
                  'shrink-0 text-xs font-medium px-2.5 py-1 rounded-full',
                  PLATFORM_BADGE[feed.platform] || 'bg-gray-100 text-gray-600',
                )}>
                  {feed.platform}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{feed.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-2">
                    <span>{feed.country} · {feed.outputType}</span>
                    {lastRun && (
                      <span>
                        Last run:{' '}
                        <span className={clsx(lastRun.status === 'SUCCESS' ? 'text-green-600' : 'text-red-500')}>
                          {lastRun.status}
                        </span>
                        {lastRun.recordsProcessed != null && ` (${lastRun.recordsProcessed} rows)`}
                        {lastRun.completedAt && (
                          <span className="text-gray-400 ml-1">
                            · {formatDistanceToNow(new Date(lastRun.completedAt), { addSuffix: true })}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {schedule?.cronExpr && (
                  <div className={clsx(
                    'text-xs flex items-center gap-1 shrink-0',
                    schedule.isActive ? 'text-brand-600' : 'text-gray-400',
                  )}>
                    <Clock className="w-3 h-3" />
                    {cronToHumanIST(schedule.cronExpr)}
                    {!schedule.isActive && <span className="ml-1">(paused)</span>}
                  </div>
                )}

                {schedule?.nextRunAt && schedule.isActive && (
                  <div className="text-xs text-gray-400 shrink-0">
                    Next: {formatDistanceToNow(new Date(schedule.nextRunAt), { addSuffix: true })}
                  </div>
                )}

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => triggerRun.mutate(feed.id)}
                    disabled={triggerRun.isPending}
                    className="inline-flex items-center gap-1 text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-3 py-1.5 rounded-md font-medium transition-colors"
                  >
                    <Play className="w-3 h-3" /> Run
                  </button>
                  <Link
                    href={`/feeds/detail?id=${feed.id}`}
                    className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </Link>
                  <button
                    onClick={() => { if (confirm(`Delete feed "${feed.name}"?`)) deleteFeed.mutate(feed.id); }}
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
