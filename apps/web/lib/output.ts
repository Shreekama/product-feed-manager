/**
 * Normalise a feed run's stored output URL to something the browser can open.
 *
 * Older runs saved a raw R2 public URL like
 *   https://feeds.r2.dev/feeds/My_Feed_1775719879467.csv
 * but that host is not actually served, so the link 500s. CSV/XML output is now
 * served through the Worker at /api/feeds/file?key=<r2-key>. This rewrites any
 * legacy *.r2.dev URL to that endpoint and leaves everything else (Google
 * Sheets links, already-correct /api/ paths) untouched.
 */
export function resolveOutputUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/api/')) return url;

  const m = url.match(/^https?:\/\/[^/]*r2\.dev\/(.+)$/i);
  if (m) return `/api/feeds/file?key=${encodeURIComponent(m[1])}`;

  return url;
}

/** Whether a stored output URL is something we can render as a link. */
export function isOpenableOutput(url?: string | null): boolean {
  if (!url) return false;
  return url.startsWith('http') || url.startsWith('/api/');
}
