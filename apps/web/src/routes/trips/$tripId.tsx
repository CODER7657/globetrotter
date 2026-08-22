import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TripStop } from '@globetrotter/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ErrorState, Skeleton, SkeletonText } from '../../components/primitives.js'
import { ItineraryView } from '../../components/itinerary-view.js'
import { useToast } from '../../components/toast.js'
import { useAuth } from '../../lib/auth.js'
import { conflictMessage } from '../../lib/constraints.js'
import { useTripChannel } from '../../lib/realtime.js'
import { CostPanel } from './-cost-panel.js'
import { StopPicker } from './-stop-picker.js'
import { useCityNames } from './-city-names.js'
import { useReorderStops, useStops, useTrip } from '../../lib/trips.js'

export const Route = createFileRoute('/trips/$tripId')({ component: Builder })

const TIME = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function formatStay(stop: TripStop): string {
  return `${TIME.format(new Date(stop.arrivesAt))} – ${TIME.format(new Date(stop.departsAt))}`
}

function StopRow({
  stop,
  cityName,
  position,
  total,
}: {
  readonly stop: TripStop
  readonly cityName: string
  readonly position: number
  readonly total: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card p-3 ${
        isDragging ? 'opacity-60 shadow-[var(--gt-shadow-md)]' : ''
      }`}
    >
      {/*
        The handle carries the dnd-kit listeners AND is a real button, so the
        same affordance works with a pointer and with a keyboard: focus it,
        press space, arrow to move, space to drop. #64 says do not break this.
      */}
      <button
        type="button"
        className="cursor-grab rounded-[var(--radius-sm)] px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        aria-label={`Reorder ${cityName}, currently stop ${String(position)} of ${String(total)}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-card-foreground">{cityName}</p>
        <p className="text-xs text-muted-foreground">{formatStay(stop)}</p>
      </div>
    </li>
  )
}

function Builder() {
  const { tripId } = Route.useParams()
  const { toast } = useToast()
  const { user, getAccessToken } = useAuth()

  // Live collaboration. The channel invalidates ['trip', id], ['trip', id,
  // 'stops'] and ['trip', id, 'cost'] on a remote change — the exact keys
  // lib/trips.ts uses, which is the whole reason sync works without any
  // cache-patching here. It also drops the echo of our own writes, so a save
  // cannot round-trip and overwrite what the user typed in the meantime.
  const channel = useTripChannel({
    tripId,
    token: getAccessToken(),
    selfId: user?.id ?? null,
  })

  const trip = useTrip(tripId)
  const stopsQuery = useStops(tripId)
  const reorder = useReorderStops(tripId)
  const { nameFor, remember } = useCityNames()

  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [pane, setPane] = useState<'build' | 'view'>('build')

  const stops = useMemo(
    () => [...(stopsQuery.data?.data ?? [])].sort((a, b) => a.seq - b.seq),
    [stopsQuery.data],
  )

  const sensors = useSensors(
    // A small distance threshold so a click on the handle is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (over === null || active.id === over.id) return

    const from = stops.findIndex((stop) => stop.id === active.id)
    const to = stops.findIndex((stop) => stop.id === over.id)
    if (from < 0 || to < 0) return

    const moved = stops[from]
    const next = arrayMove(stops, from, to)

    reorder.mutate(
      { stopIds: next.map((stop) => stop.id) },
      {
        onSuccess: () => {
          setSavedAt(new Date().toISOString())
        },
        onError: (error) => {
          // The specific sentence IS the demo beat. A generic red toast here
          // throws away the thing the database was built to make possible.
          toast(
            conflictMessage(error, {
              city: moved === undefined ? undefined : nameFor(moved.cityId),
            }),
            'error',
          )
        },
      },
    )
  }

  if (trip.isError) {
    return <ErrorState title="Could not load this trip" description={trip.error.message} />
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {trip.isPending ? (
            <Skeleton className="h-9 w-64" />
          ) : (
            <h1
              className="truncate text-3xl font-semibold text-foreground"
              style={{ fontFamily: 'var(--gt-font-display)' }}
            >
              {trip.data.name}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <LiveState status={channel.status} error={channel.error} />
          <SaveState pending={reorder.isPending} savedAt={savedAt} />
        </div>
      </header>

      {/* Three panes: picker · day canvas · live cost. Stacks on mobile. */}
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <StopPicker tripId={tripId} onCityKnown={remember} />

        <section aria-label="Itinerary" className="min-w-0">
          <div
            role="radiogroup"
            aria-label="Editing mode"
            className="mb-4 flex w-fit gap-1 rounded-[var(--radius-md)] bg-muted p-1 gt-no-print"
          >
            {(['build', 'view'] as const).map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={pane === option}
                onClick={() => {
                  setPane(option)
                }}
                className={`rounded-[var(--radius-sm)] px-3 py-1 text-xs capitalize transition-colors ${
                  pane === option
                    ? 'bg-card text-foreground shadow-[var(--gt-shadow-xs)]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ transitionDuration: 'var(--gt-duration-fast)' }}
              >
                {option === 'build' ? 'Build' : 'Timeline'}
              </button>
            ))}
          </div>

          {pane === 'view' && <ItineraryView stops={stops} nameFor={nameFor} />}

          {pane === 'build' && stopsQuery.isPending && <SkeletonText lines={5} />}

          {pane === 'build' && !stopsQuery.isPending && stops.length === 0 && (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-10 text-center">
              <p className="font-medium text-foreground">No stops yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Search a city on the left to add your first one.
              </p>
            </div>
          )}

          {pane === 'build' && stops.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={stops.map((stop) => stop.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {stops.map((stop, index) => (
                    <StopRow
                      key={stop.id}
                      stop={stop}
                      cityName={nameFor(stop.cityId)}
                      position={index + 1}
                      total={stops.length}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </section>

        <CostPanel tripId={tripId} />
      </div>
    </div>
  )
}

const LIVE_LABEL: Readonly<Record<string, string>> = {
  idle: '',
  connecting: 'Connecting…',
  authenticating: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  failed: 'Offline',
}

/**
 * Collaboration status. `failed` carries an actionable message from the client
 * (e.g. an expired session), so it is shown rather than flattened to "offline".
 */
function LiveState({ status, error }: { readonly status: string; readonly error: string | null }) {
  if (status === 'idle') return null
  const live = status === 'live'

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
      title={error ?? undefined}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: live ? 'var(--chart-4)' : 'var(--muted-foreground)' }}
      />
      {status === 'failed' && error !== null ? error : LIVE_LABEL[status]}
    </p>
  )
}

/** Honest save state: saving / saved / idle. Never claims a save that failed. */
function SaveState({
  pending,
  savedAt,
}: {
  readonly pending: boolean
  readonly savedAt: string | null
}) {
  if (pending) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Saving…
      </p>
    )
  }
  if (savedAt !== null) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        All changes saved
      </p>
    )
  }
  return <span className="text-sm text-muted-foreground">Up to date</span>
}
