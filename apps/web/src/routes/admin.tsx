import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getOne, query } from '../lib/api.js'
import { Button, EmptyState, ErrorState, Skeleton } from '../components/primitives.js'
import { countUp, useReducedMotion } from '../lib/motion/index.js'

/**
 * Analytics shapes.
 *
 * `packages/contracts` does not own an analytics schema yet — the
 * materialized-view endpoints are still in review — so this mirrors the shape
 * #65 documents. **Replace with the contract types when that PR lands**, per
 * #65's rule about never re-declaring what contracts owns.
 */
interface AdminOverview {
  readonly totals: {
    readonly users: number
    readonly trips: number
    readonly dau: number
    readonly wau: number
    readonly avgTripDays: number
  }
  readonly tripsOverTime: ReadonlyArray<{ readonly date: string; readonly count: number }>
  readonly topCities: ReadonlyArray<{ readonly name: string; readonly count: number }>
  readonly topActivities: ReadonlyArray<{ readonly name: string; readonly count: number }>
}

interface AdminUser {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
  readonly tripCount: number
  readonly createdAt: string
  readonly suspended: boolean
}

type Range = '7d' | '30d' | '90d'

/** A KPI figure that counts up when it first appears. */
function Kpi({ label, value, format }: {
  readonly label: string
  readonly value: number
  readonly format?: (n: number) => string
}) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    if (reduced) {
      el.textContent = format === undefined ? value.toLocaleString() : format(value)
      return
    }
    countUp(el, { to: value, ...(format === undefined ? {} : { format }) })
  }, [value, format, reduced])

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
      {/* Tabular figures so the number does not jitter as it ticks. */}
      <p
        ref={ref}
        className="text-[var(--gt-text-3xl)] leading-[var(--gt-leading-tight)] [font-variant-numeric:tabular-nums]"
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

/** Sparkline-style line chart. Inline SVG rather than a charting dependency —
 *  a polyline is a few lines of maths and keeps the bundle where #65 wants it. */
function TripsOverTime({ points }: { readonly points: AdminOverview['tripsOverTime'] }) {
  if (points.length < 2) {
    return <p className="text-sm text-muted-foreground">Not enough data yet.</p>
  }
  const width = 720
  const height = 180
  const max = Math.max(...points.map((p) => p.count), 1)
  const step = width / (points.length - 1)

  const path = points
    .map((point, index) => {
      const x = index * step
      const y = height - (point.count / max) * (height - 12)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={`Trips created per day. Peak ${String(max)}.`}
      className="h-44 w-full"
      preserveAspectRatio="none"
    >
      <path d={`${path} L${String(width)},${String(height)} L0,${String(height)} Z`}
        fill="var(--chart-1)" opacity="0.12" />
      <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function BarList({ title, rows }: {
  readonly title: string
  readonly rows: ReadonlyArray<{ readonly name: string; readonly count: number }>
}) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No data yet.</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {rows.slice(0, 6).map((row) => (
            <li key={row.name}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{row.name}</span>
                <span className="shrink-0 text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {row.count.toLocaleString()}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-2"
                  style={{ width: `${String(Math.round((row.count / max) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function AdminScreen() {
  const [range, setRange] = useState<Range>('30d')
  const [userSearch, setUserSearch] = useState('')

  const overview = useQuery({
    queryKey: ['admin', 'overview', range],
    queryFn: () => getOne<AdminOverview>(`/admin/overview${query({ range })}`),
    retry: false,
  })

  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => getOne<{ readonly data: AdminUser[] }>('/admin/users'),
    retry: false,
  })

  const filteredUsers = useMemo(() => {
    const all = users.data?.data ?? []
    if (userSearch === '') return all
    const needle = userSearch.toLowerCase()
    return all.filter(
      (user) =>
        user.email.toLowerCase().includes(needle) ||
        (user.displayName ?? '').toLowerCase().includes(needle),
    )
  }, [users.data, userSearch])

  /**
   * Client-side guarding is a courtesy, not the control.
   *
   * A 403 here means RLS refused the query server-side, which is the actual
   * boundary — #65 requires both, and this is the half that cannot be
   * bypassed by editing local state.
   */
  const forbidden =
    (overview.error as { status?: number } | null)?.status === 403 ||
    (users.error as { status?: number } | null)?.status === 403

  if (forbidden) {
    return (
      <EmptyState
        icon={<span className="text-4xl">🔒</span>}
        title="Admins only"
        description="This screen is restricted, and the database enforces it independently of the app."
      />
    )
  }

  if (overview.isError) {
    return (
      <ErrorState
        title="Analytics are unavailable"
        description="The admin endpoints are not merged yet. This screen will populate as soon as they land."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void overview.refetch()
            }}
          >
            Retry
          </Button>
        }
      />
    )
  }

  const totals = overview.data?.totals

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[var(--gt-text-3xl)] leading-[var(--gt-leading-tight)]">Admin</h1>
          <p className="mt-2 text-muted-foreground">
            Every figure comes from a materialized view. Nothing is aggregated in the browser.
          </p>
        </div>
        <div role="tablist" aria-label="Date range" className="flex gap-1">
          {(['7d', '30d', '90d'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={range === option}
              onClick={() => {
                setRange(option)
              }}
              className={`rounded-[var(--radius-md)] px-3 py-1.5 text-sm ${
                range === option ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      {overview.isPending ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : totals !== undefined ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Users" value={totals.users} />
          <Kpi label="Trips" value={totals.trips} />
          <Kpi label="Daily active" value={totals.dau} />
          <Kpi label="Weekly active" value={totals.wau} />
          <Kpi
            label="Avg trip length"
            value={totals.avgTripDays}
            format={(n) => `${n.toFixed(1)}d`}
          />
        </div>
      ) : null}

      <section className="mt-6 rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Trips created</h2>
        <div className="mt-4">
          {overview.isPending ? (
            <Skeleton className="h-44" />
          ) : (
            <TripsOverTime points={overview.data?.tripsOverTime ?? []} />
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BarList title="Top cities" rows={overview.data?.topCities ?? []} />
        <BarList title="Top activities" rows={overview.data?.topActivities ?? []} />
      </div>

      <section className="mt-6 rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <h2 className="text-sm font-medium">Users</h2>
          <label className="sr-only" htmlFor="user-search">
            Search users
          </label>
          <input
            id="user-search"
            type="search"
            value={userSearch}
            placeholder="Search by name or email"
            onChange={(event) => {
              setUserSearch(event.target.value)
            }}
            className="h-9 rounded-[var(--radius-md)] border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-border text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">Name</th>
                <th scope="col" className="px-5 py-2 font-medium">Email</th>
                <th scope="col" className="px-5 py-2 font-medium">Trips</th>
                <th scope="col" className="px-5 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.isPending && (
                <tr>
                  <td colSpan={4} className="px-5 py-6">
                    <Skeleton className="h-5" />
                  </td>
                </tr>
              )}
              {!users.isPending && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    No users to show.
                  </td>
                </tr>
              )}
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">{user.displayName ?? '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{user.email}</td>
                  <td className="px-5 py-3 [font-variant-numeric:tabular-nums]">{user.tripCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    <time dateTime={user.createdAt}>{user.createdAt.slice(0, 10)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/admin')({
  component: AdminScreen,
})
