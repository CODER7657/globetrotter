import { QueryClientProvider } from '@tanstack/react-query'
import { Outlet, createRootRoute, useRouterState } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell.js'
import { ErrorBoundary } from '../components/error-boundary.js'
import { Button, EmptyState, ErrorState, SkeletonText } from '../components/primitives.js'
import { ToastProvider } from '../components/toast.js'
import { AuthProvider, useAuth } from '../lib/auth.js'
import { queryClient } from '../lib/query.js'
import { ThemeProvider } from '../lib/theme.js'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
})

/**
 * Routes rendered without the app shell — no sidebar, no nav, no command
 * palette. Signing in is not a place you navigate away from.
 */
const BARE_ROUTES = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
])

function Providers({ children }: { readonly children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

function Shell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { status } = useAuth()

  if (BARE_ROUTES.has(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Outlet />
      </div>
    )
  }

  // Hold the shell until the refresh call resolves. Rendering the app and then
  // swapping to a login screen is the flash #25 exists to prevent; rendering a
  // login screen first is worse, because a signed-in user sees it every reload.
  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-8">
        <SkeletonText lines={4} />
      </div>
    )
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function RootLayout() {
  return (
    <Providers>
      <Shell />
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
