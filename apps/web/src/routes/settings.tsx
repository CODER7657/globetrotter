import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { PublicUser } from '@globetrotter/contracts'
import { getOne } from '../lib/api.js'
import { Button, ErrorState, Skeleton } from '../components/primitives.js'
import { ThemeToggle } from '../components/theme-toggle.js'
import { useCurrency } from '../lib/currency.js'
import { useToast } from '../components/toast.js'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'AUD'] as const
const CURRENCY_KEY = 'gt-preferred-currency'

function Section({ title, description, children }: {
  readonly title: string
  readonly description?: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <h2 className="font-medium">{title}</h2>
      {description !== undefined && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function SettingsScreen() {
  const { toast } = useToast()

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getOne<PublicUser>('/auth/me'),
    retry: false,
  })

  // The shared preference: the cost panel and every money figure format
  // through it, so changing it here changes the whole app.
  const { preferred: currency, setPreferred: setCurrency } = useCurrency()

  const [confirmEmail, setConfirmEmail] = useState('')

  if (me.isError) {
    return (
      <ErrorState
        title="Could not load your account"
        description="You may need to sign in again."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void me.refetch()
            }}
          >
            Retry
          </Button>
        }
      />
    )
  }

  const user = me.data

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-[var(--gt-text-3xl)] leading-[var(--gt-leading-tight)]">Settings</h1>
      </header>

      <Section title="Profile">
        {me.isPending ? (
          <Skeleton className="h-20" />
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{user?.displayName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="flex items-center gap-2">
                {user?.email}
                {user?.emailVerifiedAt === null ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Unverified
                  </span>
                ) : (
                  <span className="rounded-full bg-chart-4/15 px-2 py-0.5 text-xs text-chart-4">
                    Verified
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{user?.role}</dd>
            </div>
          </dl>
        )}
      </Section>

      <Section title="Appearance" description="Applies immediately and is remembered on this device.">
        <ThemeToggle />
      </Section>

      <Section
        title="Currency"
        description="Used when showing trip budgets and cost estimates."
      >
        <label className="sr-only" htmlFor="currency">
          Preferred currency
        </label>
        <select
          id="currency"
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value)
            try {
              localStorage.setItem(CURRENCY_KEY, event.target.value)
            } catch {
              // Preference storage is a nicety, not a requirement.
            }
            toast('Currency preference saved', 'success')
          }}
          className="h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 sm:w-48"
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </Section>

      <Section
        title="Sessions"
        description="Signing out here ends this session. The refresh token is httpOnly, so it is cleared by the server rather than by the page."
      >
        <Button
          variant="secondary"
          onClick={() => {
            // The session-listing endpoint is not merged; signing out is the
            // half that exists today, and it is the one that matters.
            window.location.href = '/api/v1/auth/logout'
          }}
        >
          Sign out
        </Button>
      </Section>

      {/*
        Delete is gated on typing the account's own email.
        #65: "delete-account behind a type-your-email confirm". A yes/no dialog
        is dismissed reflexively; retyping the address forces the user to read
        which account they are about to destroy.
      */}
      <section className="rounded-[var(--radius-lg)] border border-destructive/40 bg-card p-6">
        <h2 className="font-medium text-destructive">Delete account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This removes your trips, itineraries and shares. It cannot be undone.
        </p>

        <label htmlFor="confirm-email" className="mt-5 block text-sm">
          Type <strong>{user?.email ?? 'your email'}</strong> to confirm
        </label>
        <input
          id="confirm-email"
          type="email"
          value={confirmEmail}
          autoComplete="off"
          onChange={(event) => {
            setConfirmEmail(event.target.value)
          }}
          className="mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3"
        />

        <Button
          variant="destructive"
          className="mt-4"
          disabled={user === undefined || confirmEmail.trim().toLowerCase() !== user.email}
          onClick={() => {
            toast(
              'Account deletion is not wired up yet — the endpoint ships with the account API.',
              'error',
            )
          }}
        >
          Delete my account
        </Button>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/settings')({
  component: SettingsScreen,
})
