import type { Trip } from '@globetrotter/contracts'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Button, EmptyState, ErrorState, SkeletonCard } from '../components/primitives.js'
import { useAuth } from '../lib/auth.js'
import { useTrips } from '../lib/trips.js'

export const Route = createFileRoute('/')({ component: Dashboard })

const DAY_MS = 86_400_000

function daysUntil(iso: string): number {
  // Compare calendar days in UTC. Using local midnight would make the
  // countdown flip at a different moment depending on the traveller's zone.
  const start = Date.parse(`${iso}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((start - todayUtc) / DAY_MS)
}

function nights(trip: Trip): number {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${trip.endDate}T00:00:00Z`) - Date.parse(`${trip.startDate}T00:00:00Z`)) /
        DAY_MS,
    ),
  )
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatRange(trip: Trip): string {
  return `${DATE_FORMAT.format(new Date(`${trip.startDate}T00:00:00Z`))} – ${DATE_FORMAT.format(
    new Date(`${trip.endDate}T00:00:00Z`),
  )}`
}

function countdownLabel(days: number): string {
  if (days === 0) return 'Starts today'
  if (days === 1) return 'Starts tomorrow'
  if (days > 1) return `In ${String(days)} days`
  if (days === -1) return 'Started yesterday'
  return `Started ${String(Math.abs(days))} days ago`
}

/** Staggered mount, driven by the motion tokens so reduced-motion is free. */
function Stagger({ index, children }: { readonly index: number; readonly children: React.ReactNode }) {
  return (
    <div
      className="gt-rise"
      style={{ animationDelay: `${String(index * 60)}ms` }}
    >
      {children}
    </div>
  )
}

function TripCard({ trip }: { readonly trip: Trip }) {
  return (
    <Link
      to="/trips/$tripId"
      params={{ tripId: trip.id }}
      className="group block rounded-[var(--radius-lg)] border border-border bg-card p-5 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--gt-shadow-md)]"
      style={{ transitionDuration: 'var(--gt-duration-fast)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-card-foreground">{trip.name}</h3>
        <span className="shrink-0 rounded-[var(--radius-sm)] bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {trip.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{formatRange(trip)}</p>
      <p className="mt-3 text-xs text-muted-foreground">
        {nights(trip)} nights · {trip.baseCurrency}
        {trip.budgetCap !== null ? ` · cap ${trip.budgetCap}` : ''}
      </p>
    </Link>
  )
}

function Dashboard() {
  const { user } = useAuth()
  const { data, isPending, isError, error, refetch } = useTrips(12)

  const trips = data?.data ?? []
  const upcoming = [...trips]
    .filter((trip) => daysUntil(trip.startDate) >= 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]

  const firstName = user?.displayName.split(' ')[0] ?? 'traveller'

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <h1
          className="text-3xl font-semibold text-foreground"
          style={{ fontFamily: 'var(--gt-font-display)' }}
        >
          {`Welcome back, ${firstName}`}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {upcoming !== undefined
            ? `${upcoming.name} — ${countdownLabel(daysUntil(upcoming.startDate)).toLowerCase()}.`
            : 'Nothing on the calendar yet.'}
        </p>
      </header>

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {isError && (
        <ErrorState
          title="Could not load your trips"
          description={error.message}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void refetch()
              }}
            >
              Try again
            </Button>
          }
        />
      )}

      {!isPending && !isError && trips.length === 0 && (
        <EmptyState
          title="No trips yet"
          description="Start with a city and a date range. You can add stops, activities and costs as you go — nothing has to be right first time."
          icon={<span className="text-4xl">🧳</span>}
          action={
            <Link to="/trips/new">
              <Button>Plan your first trip</Button>
            </Link>
          }
        />
      )}

      {!isPending && !isError && trips.length > 0 && (
        // Bento: the countdown claims two columns on wide screens, the CTA one,
        // and the rest of the trips flow underneath.
        <div className="grid auto-rows-min gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming !== undefined && (
            <Stagger index={0}>
              <section className="flex h-full flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-card p-6 sm:col-span-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Next trip
                  </p>
                  <h2
                    className="mt-2 text-2xl font-semibold text-card-foreground"
                    style={{ fontFamily: 'var(--gt-font-display)' }}
                  >
                    {upcoming.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{formatRange(upcoming)}</p>
                </div>
                <div className="mt-6 flex items-end justify-between gap-4">
                  <p className="text-4xl font-semibold tabular-nums text-primary">
                    {countdownLabel(daysUntil(upcoming.startDate))}
                  </p>
                  <Link to="/trips/$tripId" params={{ tripId: upcoming.id }}>
                    <Button variant="secondary">Open builder</Button>
                  </Link>
                </div>
              </section>
            </Stagger>
          )}

          <Stagger index={1}>
            <section className="flex h-full flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-card p-6">
              <div>
                <h2 className="font-medium text-card-foreground">Plan a new trip</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Multi-city, with costs that add up as you build.
                </p>
              </div>
              <Link to="/trips/new" className="mt-6">
                <Button className="w-full">Plan new trip</Button>
              </Link>
            </section>
          </Stagger>

          {trips.map((trip, index) => (
            <Stagger key={trip.id} index={index + 2}>
              <TripCard trip={trip} />
            </Stagger>
          ))}
        </div>
      )}
    </div>
  )
}
