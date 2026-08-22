import type { TripStop } from '@globetrotter/contracts'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from './primitives.js'

/**
 * The itinerary, read-only.
 *
 * Deliberately a component rather than a route: the public share page renders
 * exactly this with `readOnly`, so a shared trip and the owner's own view can
 * never drift into two different renderings of the same data.
 *
 * Stops only. There is no activities endpoint yet — `apps/api` serves
 * `/trips/:id/stops` and nothing else — so day cells show the stay that covers
 * them rather than inventing activity blocks.
 */

export type ItineraryMode = 'timeline' | 'calendar'

const DAY_MS = 86_400_000

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const MONTH_LABEL = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** UTC throughout: a trip's calendar day must not shift with the reader's zone. */
function toUtcDay(iso: string): number {
  const date = new Date(iso)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function eachDay(fromMs: number, toMs: number): number[] {
  const days: number[] = []
  for (let day = fromMs; day <= toMs; day += DAY_MS) days.push(day)
  return days
}

interface DayCell {
  readonly ms: number
  readonly stop: TripStop | undefined
  readonly cityName: string
  /** First day of this stay — the day that carries the city header. */
  readonly isArrival: boolean
}

function buildDays(stops: readonly TripStop[], nameFor: (id: string) => string): DayCell[] {
  if (stops.length === 0) return []

  const spans = stops.map((stop) => ({
    stop,
    from: toUtcDay(stop.arrivesAt),
    to: toUtcDay(stop.departsAt),
  }))
  const first = Math.min(...spans.map((s) => s.from))
  const last = Math.max(...spans.map((s) => s.to))

  return eachDay(first, last).map((ms) => {
    const span = spans.find((s) => ms >= s.from && ms <= s.to)
    return {
      ms,
      stop: span?.stop,
      cityName: span === undefined ? '' : nameFor(span.stop.cityId),
      isArrival: span !== undefined && span.from === ms,
    }
  })
}

function dayAnchor(index: number): string {
  return `day-${String(index + 1)}`
}

export function ItineraryView({
  stops,
  nameFor,
  readOnly = false,
}: {
  readonly stops: readonly TripStop[]
  readonly nameFor: (cityId: string) => string
  readonly readOnly?: boolean
}) {
  const [mode, setMode] = useState<ItineraryMode>('timeline')
  const days = useMemo(() => buildDays(stops, nameFor), [stops, nameFor])

  // Deep links: /trips/x#day-4 scrolls to that day, and the share page relies
  // on it. Runs after the days exist, not on mount.
  useEffect(() => {
    if (days.length === 0) return
    const hash = window.location.hash.replace('#', '')
    if (hash === '') return
    document.getElementById(hash)?.scrollIntoView({ block: 'start' })
  }, [days.length])

  if (days.length === 0) {
    return (
      <EmptyState
        title="Nothing scheduled yet"
        description={
          readOnly
            ? 'This trip has no stops on it yet.'
            : 'Add a city and some dates and the timeline fills in.'
        }
      />
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div
          role="radiogroup"
          aria-label="Itinerary view"
          className="flex gap-1 rounded-[var(--radius-md)] bg-muted p-1"
        >
          {(['timeline', 'calendar'] as const).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={mode === option}
              onClick={() => {
                setMode(option)
              }}
              className={`rounded-[var(--radius-sm)] px-3 py-1 text-xs capitalize transition-colors ${
                mode === option
                  ? 'bg-card text-foreground shadow-[var(--gt-shadow-xs)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ transitionDuration: 'var(--gt-duration-fast)' }}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {days.length} {days.length === 1 ? 'day' : 'days'}
        </p>
      </div>

      {mode === 'timeline' ? (
        <Timeline days={days} />
      ) : (
        <Calendar days={days} />
      )}
    </div>
  )
}

function Timeline({ days }: { readonly days: readonly DayCell[] }) {
  return (
    <ol className="gt-print-flat space-y-0">
      {days.map((day, index) => (
        <li key={day.ms} id={dayAnchor(index)} className="scroll-mt-20">
          {day.isArrival && (
            // Sticky city header. `top-0` inside the scroll container keeps the
            // city visible for the whole stay, which is the point of the header.
            <h3 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 text-sm font-semibold text-foreground backdrop-blur">
              {day.cityName}
            </h3>
          )}
          <div className="flex gap-4 border-l border-border pl-4">
            <div className="w-28 shrink-0 py-3">
              <p className="text-xs tabular-nums text-muted-foreground">
                {DAY_LABEL.format(new Date(day.ms))}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Day {index + 1}
              </p>
            </div>
            <div className="min-w-0 flex-1 py-3">
              {day.stop === undefined ? (
                <p className="text-sm text-muted-foreground">In transit</p>
              ) : (
                <p className="text-sm text-foreground">
                  Staying in {day.cityName}
                  {day.isArrival ? ' — arrival day' : ''}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Stay window for the expanded day cell. UTC, like every other date here. */
const STAY = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function formatStay(stop: TripStop): string {
  return `${STAY.format(new Date(stop.arrivesAt))} – ${STAY.format(new Date(stop.departsAt))}`
}

const FULL_DAY = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function Calendar({ days }: { readonly days: readonly DayCell[] }) {
  // Selection, not navigation. The previous version linked each cell to
  // #day-N, which scrolled the timeline but left the calendar itself inert —
  // a month grid whose dates could not actually be picked.
  const [selected, setSelected] = useState<number | null>(days[0]?.ms ?? null)

  const first = days[0]
  if (first === undefined) return null

  // Pad to a Monday-first grid so the columns line up with a real month view.
  const firstDate = new Date(first.ms)
  const weekday = (firstDate.getUTCDay() + 6) % 7
  const blanks = Array.from({ length: weekday }, (_, index) => index)
  const chosen = days.find((day) => day.ms === selected)

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {MONTH_LABEL.format(firstDate)}
      </h3>

      <div role="grid" aria-label="Trip calendar" className="grid grid-cols-7 gap-1">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((label) => (
          <div key={label} role="columnheader" className="pb-1 text-center text-[10px] text-muted-foreground">
            {label}
          </div>
        ))}
        {blanks.map((key) => (
          <div key={`blank-${String(key)}`} role="presentation" />
        ))}
        {days.map((day, index) => {
          const isSelected = day.ms === selected
          return (
            <button
              key={day.ms}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${FULL_DAY.format(new Date(day.ms))}${
                day.cityName === '' ? ', in transit' : `, ${day.cityName}`
              }`}
              onClick={() => {
                setSelected(day.ms)
                // Keep the timeline in step, so switching back lands in place.
                document.getElementById(dayAnchor(index))?.scrollIntoView({ block: 'start' })
              }}
              className={`min-h-16 rounded-[var(--radius-sm)] border p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${
                isSelected
                  ? 'border-primary bg-accent'
                  : day.stop === undefined
                    ? 'border-dashed border-border text-muted-foreground hover:bg-accent'
                    : 'border-border bg-card hover:bg-accent'
              }`}
              style={{ transitionDuration: 'var(--gt-duration-fast)' }}
            >
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {new Date(day.ms).getUTCDate()}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-card-foreground">
                {day.cityName || '—'}
              </span>
            </button>
          )
        })}
      </div>

      {/* The expanded cell. A month grid that cannot show a day's detail is a picture of a month. */}
      {chosen !== undefined && (
        <section
          aria-live="polite"
          className="mt-4 rounded-[var(--radius-lg)] border border-border bg-card p-4"
        >
          <h4 className="text-sm font-semibold text-card-foreground">
            {FULL_DAY.format(new Date(chosen.ms))}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {chosen.stop === undefined
              ? 'In transit — no stay booked for this day.'
              : `Staying in ${chosen.cityName}${chosen.isArrival ? ' — arrival day' : ''}.`}
          </p>
          {chosen.stop !== undefined && (
            <p className="mt-2 text-xs text-muted-foreground">
              Stay runs {formatStay(chosen.stop)}
              {chosen.stop.arrivalMode === null ? '' : ` · arrived by ${chosen.stop.arrivalMode}`}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
