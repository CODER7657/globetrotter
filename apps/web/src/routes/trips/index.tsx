import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { Trip, TripStatus } from '@globetrotter/contracts'
import { del, getList, query } from '../../lib/api.js'
import { Button, EmptyState, ErrorState, SkeletonCard, buttonClasses } from '../../components/primitives.js'
import { useToast } from '../../components/toast.js'

type Filter = 'all' | 'upcoming' | 'past' | 'draft'
type Sort = 'recent' | 'name' | 'start'

const FILTERS: ReadonlyArray<{ readonly value: Filter; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'draft', label: 'Drafts' },
]

/** Status pill colours come from the chart ramp — the only non-neutral hues. */
const STATUS_CLASS: Readonly<Record<TripStatus, string>> = {
  draft: 'bg-muted text-muted-foreground',
  planned: 'bg-chart-2/15 text-chart-2',
  active: 'bg-chart-4/15 text-chart-4',
  completed: 'bg-chart-3/15 text-chart-3',
  archived: 'bg-muted text-muted-foreground',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** "12–19 Oct 2026", collapsing the month when the range does not cross one. */
function formatRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' })
  const full = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return sameMonth
    ? `${day.format(start)}–${full.format(end)}`
    : `${full.format(start)} – ${full.format(end)}`
}

function nights(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)
  return Math.max(0, Math.round(ms / 86_400_000))
}

/**
 * Money is a decimal *string* in the contracts, not a float, and
 * `common.ts` is explicit that parsing it to a number anywhere is a bug —
 * it crosses the wire exactly as Postgres NUMERIC(12,2) stores it.
 * Intl accepts the string directly and formats it without a float round-trip,
 * so the value is never reconstructed and never loses precision.
 */
function formatMoney(amount: string, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  })
  // TypeScript types `format` as `number | bigint | StringNumericLiteral`, and
  // StringNumericLiteral only matches string *literals*, not a runtime string.
  // The ES2023 runtime does accept a decimal string and formats it exactly,
  // which is the point — `Number(amount)` would be the float round-trip the
  // contract calls a bug.
  return (formatter.format as (value: string) => string)(amount)
}

function MyTrips() {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [search, setSearch] = useState('')
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const trips = useQuery({
    queryKey: ['trips'],
    queryFn: () => getList<Trip>(`/trips${query({ limit: 50 })}`),
  })

  /**
   * Delete is optimistic and reversible rather than confirmed up front.
   *
   * The row disappears immediately, and the toast offers undo for as long as
   * it is on screen. #65: "an undo toast, never a bare confirm()". The request
   * only fires once the window has closed, so undo costs nothing — there is
   * no delete to reverse server-side.
   */
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(new Set())

  const remove = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      del(`/trips/${id}`, version),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
    },
    onError: (error: Error) => {
      toast(`Could not delete the trip. ${error.message}`, 'error')
    },
  })

  function requestDelete(trip: Trip): void {
    setPendingDelete((current) => new Set(current).add(trip.id))

    let undone = false
    const timer = window.setTimeout(() => {
      if (undone) return
      remove.mutate({ id: trip.id, version: trip.version })
    }, 5000)

    toast(`“${trip.name}” deleted`, 'info', {
      label: 'Undo',
      onAct: () => {
        undone = true
        window.clearTimeout(timer)
        setPendingDelete((current) => {
          const next = new Set(current)
          next.delete(trip.id)
          return next
        })
      },
    })
  }

  const visible = useMemo(() => {
    const all = trips.data?.data ?? []
    const today = todayIso()

    const matched = all.filter((trip) => {
      if (pendingDelete.has(trip.id)) return false
      if (search !== '' && !trip.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'upcoming') return trip.endDate >= today && trip.status !== 'draft'
      if (filter === 'past') return trip.endDate < today
      if (filter === 'draft') return trip.status === 'draft'
      return true
    })

    return [...matched].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'start') return a.startDate.localeCompare(b.startDate)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [trips.data, filter, sort, search, pendingDelete])

  if (trips.isError) {
    return (
      <ErrorState
        title="Could not load your trips"
        description={trips.error.message}
        action={
          <Button
            onClick={() => {
              void trips.refetch()
            }}
          >
            Try again
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[var(--gt-text-3xl)] leading-[var(--gt-leading-tight)]">My trips</h1>
          <p className="mt-2 text-muted-foreground">
            Everything you are planning, and everywhere you have been.
          </p>
        </div>
        <Link to="/trips/new" className={buttonClasses('primary')}>
          New trip
        </Link>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter trips" className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => {
                setFilter(option.value)
              }}
              className={
                filter === option.value
                  ? buttonClasses('secondary', 'px-3 py-1.5')
                  : buttonClasses('ghost', 'px-3 py-1.5')
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="trip-search">
            Search trips
          </label>
          <input
            id="trip-search"
            type="search"
            value={search}
            placeholder="Search trips"
            onChange={(event) => {
              setSearch(event.target.value)
            }}
            className="h-9 rounded-[var(--radius-md)] border border-input bg-card px-3 text-sm"
          />

          <label className="sr-only" htmlFor="trip-sort">
            Sort trips
          </label>
          <select
            id="trip-sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as Sort)
            }}
            className="h-9 rounded-[var(--radius-md)] border border-input bg-card px-3 text-sm"
          >
            <option value="recent">Recently updated</option>
            <option value="start">Start date</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {trips.isPending ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-12">
          <EmptyState
            icon={<span className="text-4xl">🧳</span>}
            title={search === '' && filter === 'all' ? 'No trips yet' : 'Nothing matches that'}
            description={
              search === '' && filter === 'all'
                ? 'Start with one city. Add the rest as you figure them out.'
                : 'Try a different filter, or clear the search.'
            }
            action={
              search === '' && filter === 'all' ? (
                <Link to="/trips/new" className={buttonClasses('primary')}>
                  Plan your first trip
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((trip) => (
            <li
              key={trip.id}
              className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card"
            >
              <Link
                to="/trips/$tripId"
                params={{ tripId: trip.id }}
                className="block aspect-[16/10] overflow-hidden bg-muted"
              >
                {trip.coverImageUrl === null ? (
                  <span
                    aria-hidden="true"
                    className="flex size-full items-center justify-center text-3xl opacity-40"
                  >
                    🗺
                  </span>
                ) : (
                  <img
                    src={trip.coverImageUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-[var(--gt-duration-slow)] group-hover:scale-105"
                  />
                )}
              </Link>

              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to="/trips/$tripId"
                    params={{ tripId: trip.id }}
                    className="font-medium hover:underline"
                  >
                    {trip.name}
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs capitalize ${STATUS_CLASS[trip.status]}`}
                  >
                    {trip.status}
                  </span>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">
                  <time dateTime={trip.startDate}>{formatRange(trip.startDate, trip.endDate)}</time>
                  {' · '}
                  {nights(trip.startDate, trip.endDate)} nights
                </p>

                {trip.budgetCap !== null && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Budget {formatMoney(trip.budgetCap, trip.baseCurrency)}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-1 border-t border-border pt-3">
                  <Link
                    to="/trips/$tripId"
                    params={{ tripId: trip.id }}
                    className={buttonClasses('ghost', 'px-2.5 py-1.5 text-xs')}
                  >
                    Open
                  </Link>
                  <Button
                    variant="ghost"
                    className="px-2.5 py-1.5 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        `${window.location.origin}/trips/${trip.id}`,
                      )
                      toast('Link copied', 'success')
                    }}
                  >
                    Share
                  </Button>
                  <Button
                    variant="ghost"
                    className="ml-auto px-2.5 py-1.5 text-xs text-destructive"
                    onClick={() => {
                      requestDelete(trip)
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const Route = createFileRoute('/trips/')({
  component: MyTrips,
})
