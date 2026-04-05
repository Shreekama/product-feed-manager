'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { AuthOverlay } from '../components/auth/AuthOverlay';

interface User {
  email: string;
  name: string;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  const [user, setUser] = useState<User | null>(null);
  const handleAuth = useCallback((u: User) => setUser(u), []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Login overlay — shows when not authenticated, hides itself once signed in */}
      <AuthOverlay onAuth={handleAuth} />
      {children}
    </QueryClientProvider>
  );
}
