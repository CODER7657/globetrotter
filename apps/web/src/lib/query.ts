import { QueryClient } from '@tanstack/react-query'

/**
 * Defaults chosen so screens do not refetch on every focus during a demo, and
 * so a genuine 4xx fails fast instead of retrying three times behind a spinner.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status
        if (typeof status === 'number' && status >= 400 && status < 500) return false
        return failureCount < 2
      },
    },
    mutations: { retry: 0 },
  },
})
