import { VerifyEmailBodySchema } from '@globetrotter/contracts'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AuthLayout } from '../components/form.js'
import { Button, SkeletonText } from '../components/primitives.js'
import { ApiError, request } from '../lib/api.js'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search['token'] === 'string' ? search['token'] : '',
  }),
  component: VerifyEmail,
})

type State =
  | { readonly kind: 'missing' }
  | { readonly kind: 'verifying' }
  | { readonly kind: 'verified' }
  | { readonly kind: 'failed'; readonly message: string }

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try the link again.'
  switch (error.code) {
    case 'TOKEN_EXPIRED':
      return 'That link has expired. Sign in and we will send a new one.'
    case 'TOKEN_REPLAYED':
      return 'That link has already been used. Your email is most likely already verified.'
    default:
      return error.message
  }
}

function VerifyEmail() {
  const { token } = Route.useSearch()
  const [state, setState] = useState<State>(token === '' ? { kind: 'missing' } : { kind: 'verifying' })
  // StrictMode double-invokes effects in development; a verification token is
  // single-use, so firing twice would burn it and show a spurious "already used".
  const fired = useRef(false)

  useEffect(() => {
    if (token === '' || fired.current) return
    fired.current = true

    let cancelled = false
    void (async () => {
      try {
        const body = VerifyEmailBodySchema.parse({ token })
        await request<void>('/auth/verify-email', { method: 'POST', body })
        if (!cancelled) setState({ kind: 'verified' })
      } catch (error) {
        if (!cancelled) setState({ kind: 'failed', message: messageFor(error) })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  if (state.kind === 'missing') {
    return (
      <AuthLayout
        title="That link is incomplete"
        subtitle="The verification link is missing its token. Open the newest email we sent you."
        footer={
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        <span />
      </AuthLayout>
    )
  }

  if (state.kind === 'verifying') {
    return (
      <AuthLayout title="Verifying your email" subtitle="One moment.">
        <SkeletonText lines={2} />
      </AuthLayout>
    )
  }

  if (state.kind === 'verified') {
    return (
      <AuthLayout
        title="Email verified"
        subtitle="Your account is ready. Everything is unlocked."
      >
        <Link to="/">
          <Button className="w-full">Go to your dashboard</Button>
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="We could not verify that link"
      subtitle={state.message}
      footer={
        <Link to="/login" className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <span />
    </AuthLayout>
  )
}
