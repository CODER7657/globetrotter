import { createRootRoute, Outlet } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '../components/app-shell.js'
import { ErrorBoundary } from '../components/error-boundary.js'
import { Button, EmptyState, ErrorState } from '../components/primitives.js'
import { ToastProvider } from '../components/toast.js'
import { queryClient } from '../lib/query.js'
import { ThemeProvider } from '../lib/theme.js'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
})

function Providers({ children }: { readonly children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

function RootLayout() {
  return (
    <Providers>
      <AppShell>
        <Outlet />
      </AppShell>
    </Providers>
  )
}

function NotFound() {
  return (
    <EmptyState
      title="That page does not exist"
      description="The link may be out of date, or the trip may have been deleted."
      icon={<span className="text-4xl">🧭</span>}
      action={
        <Button
          onClick={() => {
            window.location.href = '/'
          }}
        >
          Back to dashboard
        </Button>
      }
    />
  )
}

function RouteError({ error }: { readonly error: Error }) {
  return <ErrorState title="This screen failed to load" description={error.message} />
}
