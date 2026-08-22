import { useEffect, useId, useState } from 'react'
import { Skeleton } from '../../components/primitives.js'
import { useSearch } from '../../lib/trips.js'

/**
 * City autocomplete over the hybrid search endpoint.
 *
 * Ranking is `app.search_places` — full-text and trigram fused with RRF, all in
 * Postgres. Nothing here re-sorts the results: the score is only comparable
 * across result kinds because the database produced it.
 */
export function StopPicker({
  tripId,
  onCityKnown,
}: {
  readonly tripId: string
  readonly onCityKnown: (cityId: string, name: string) => void
}) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const inputId = useId()

  // Debounced so a fast typist does not issue a query per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(term)
    }, 200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [term])

  const { data, isFetching, isError } = useSearch(debounced, 'city')

  // Remember every name we see, so a stop added from this list can be labelled
  // without another round trip.
  useEffect(() => {
    for (const hit of data ?? []) {
      if (hit.kind === 'city') onCityKnown(hit.id, hit.name)
    }
  }, [data, onCityKnown])

  return (
    <aside aria-label="Add a stop" className="lg:sticky lg:top-4 lg:self-start">
      <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
        Add a stop
      </label>
      <input
        id={inputId}
        type="search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value)
        }}
        placeholder="Search a city…"
        autoComplete="off"
        className="mt-1.5 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      />

      <div className="mt-3 space-y-1.5" aria-live="polite">
        {debounced.trim().length < 2 && (
          <p className="text-xs text-muted-foreground">Type at least two letters.</p>
        )}

        {isFetching && (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        )}

        {isError && (
          <p className="text-xs text-muted-foreground">
            Search is unavailable — the endpoint ships in #70.
          </p>
        )}

        {(data ?? []).map((hit) => (
          <button
            key={hit.id}
            type="button"
            data-trip={tripId}
            className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <span className="min-w-0">
              <span className="block truncate text-card-foreground">{hit.name}</span>
              {hit.subtitle !== null && (
                <span className="block truncate text-xs text-muted-foreground">
                  {hit.subtitle}
                </span>
              )}
            </span>
            {/*
              A trigram-only hit matched fuzzily — worth flagging so the user
              can confirm it is what they meant, rather than presenting a
              typo-match with the same confidence as an exact one.
            */}
            {!hit.matchedBy.includes('fulltext') && hit.matchedBy.includes('trigram') && (
              <span className="shrink-0 rounded-[var(--radius-sm)] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                did you mean?
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
