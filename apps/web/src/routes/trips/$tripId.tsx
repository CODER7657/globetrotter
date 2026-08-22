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
import { Button, ErrorState, Skeleton, SkeletonText } from '../../components/primitives.js'
import { useToast } from '../../components/toast.js'
import { conflictMessage } from '../../lib/constraints.js'
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

  const trip = useTrip(tripId)
  const stopsQuery = useStops(tripId)
  const reorder = useReorderStops(tripId)
  const { nameFor, remember } = useCityNames()

  const [savedAt, setSavedAt] = useState<string | null>(null)

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
        <SaveState pending={reorder.isPending} savedAt={savedAt} />
      </header>

      {/* Three panes: picker · day canvas · live cost. Stacks on mobile. */}
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <StopPicker tripId={tripId} onCityKnown={remember} />

        <section aria-label="Itinerary" className="min-w-0">
          {stopsQuery.isPending && <SkeletonText lines={5} />}

          {!stopsQuery.isPending && stops.length === 0 && (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-10 text-center">
              <p className="font-medium text-foreground">No stops yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Search a city on the left to add your first one.
              </p>
            </div>
          )}

          {stops.length > 0 && (
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
