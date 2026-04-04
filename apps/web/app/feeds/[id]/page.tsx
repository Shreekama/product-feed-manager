// Server component — required for generateStaticParams with static export.
// IDs are unknown at build time; client-side routing handles data fetching.
import FeedDetailClient from './FeedDetailClient';

export function generateStaticParams() {
  return [];
}

export default function FeedDetailPage() {
  return <FeedDetailClient />;
}
