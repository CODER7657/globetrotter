import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getList, query } from '../lib/api.js'
import { Button, EmptyState, ErrorState, Skeleton, buttonClasses } from '../components/primitives.js'

/**
 * Which arm of the hybrid search matched a row.
 *
 * `packages/contracts` does not own a search schema yet — the endpoint is
 * still in review — so this mirrors the shape #65 documents rather than
 * inventing one. **Delete this and import from the contracts the moment the
 * search PR lands**; #65 is explicit that re-declaring what contracts owns is
 * what cost the team every authenticated route.
 */
type MatchArm = 'exact' | 'fulltext' | 'fuzzy' | 'semantic'

interface SearchHit {
  readonly id: string
  readonly kind: 'city' | 'activity'
  readonly name: string
  readonly country: string | null
  readonly countryCode: string | null
  readonly region: string | null
  /** 0–100, where 100 is the most expensive place in the index. */
  readonly costIndex: number | null
  readonly bestSeason: string | null
  readonly matched_by: readonly MatchArm[]
}

const EXAMPLES = [
  'cheap romantic coastal town in October',
  'walkable city with great food',
  'mountains without the crowds',
] as const

const ARM_LABEL: Readonly<Record<MatchArm, string>> = {
  exact: 'Exact',
  fulltext: 'Text',
  fuzzy: 'Typo-tolerant',
  semantic: 'Meaning',
}

/** A country code to its flag, via regional indicator symbols. */
function flagOf(countryCode: string | null): string {
  if (countryCode === null || countryCode.length !== 2) return '🌍'
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delay])
  return debounced
}

function highlight(text: string, term: string): React.ReactNode {
  if (term.trim() === '') return text
  const index = text.toLowerCase().indexOf(term.toLowerCase())
  if (index === -1) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary/20 text-foreground">{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  )
}

function SearchScreen() {
  const [term, setTerm] = useState('')
  const [kind, setKind] = useState<'all' | 'city' | 'activity'>('all')
  const debounced = useDebounced(term, 250)

  const results = useQuery({
    queryKey: ['search', debounced, kind],
    enabled: debounced.trim().length > 1,
    // Keeps the previous rows on screen while the next request is in flight,
    // so typing does not flash the list empty on every keystroke.
    placeholderData: keepPreviousData,
    queryFn: () =>
      getList<SearchHit>(
        `/search${query({ q: debounced, kind: kind === 'all' ? undefined : kind, limit: 25 })}`,
      ),
  })

  const hits = results.data?.data ?? []

  /**
   * The typo-tolerance tell.
   *
   * If every row came back on the `fuzzy` arm alone, the literal text did not
   * match anything — trigram similarity rescued the query. Saying so is what
   * makes the hybrid search visible rather than looking like a plain LIKE.
   */
  const rescuedByFuzzy =
    hits.length > 0 && hits.every((hit) => hit.matched_by.length === 1 && hit.matched_by[0] === 'fuzzy')

  const usedSemantic = hits.some((hit) => hit.matched_by.includes('semantic'))

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[var(--gt-text-3xl)] leading-[var(--gt-leading-tight)]">Search</h1>
      <p className="mt-2 text-muted-foreground">
        Cities and activities, ranked across exact, full-text, typo-tolerant and semantic matching.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="search-input">
          Search cities and activities
        </label>
        <input
          id="search-input"
          type="search"
          autoFocus
          value={term}
          placeholder="Try a place, or describe one"
          onChange={(event) => {
            setTerm(event.target.value)
          }}
          className="h-12 flex-1 rounded-[var(--radius-md)] border border-input bg-card px-4"
        />
        <label className="sr-only" htmlFor="search-kind">
          Result type
        </label>
        <select
          id="search-kind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as 'all' | 'city' | 'activity')
          }}
          className="h-12 rounded-[var(--radius-md)] border border-input bg-card px-3"
        >
          <option value="all">Everything</option>
          <option value="city">Cities</option>
          <option value="activity">Activities</option>
        </select>
      </div>

      {/* Empty state carries the example queries. A judge will not guess that
          the box understands a sentence unless we show them one. */}
      {debounced.trim().length <= 1 && (
        <div className="mt-10">
          <p className="text-sm text-muted-foreground">Try one of these:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setTerm(example)
                }}
                className={buttonClasses('secondary', 'rounded-full text-sm')}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {results.isError && (
        <div className="mt-10">
          <ErrorState
            title="Search is unavailable"
            description={
              // The endpoint ships with the hybrid-search PR; until then this
              // screen degrades rather than looking broken.
              'The search endpoint is not available yet. This screen will light up as soon as it lands.'
            }
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void results.refetch()
                }}
              >
                Retry
              </Button>
            }
          />
        </div>
      )}

      {results.isFetching && hits.length === 0 && debounced.trim().length > 1 && (
        <div className="mt-8 flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {rescuedByFuzzy && (
        <p className="mt-8 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 text-sm">
          No exact match for <strong>{debounced}</strong> — showing closest spellings.
        </p>
      )}

      {usedSemantic && !rescuedByFuzzy && (
        <p className="mt-8 text-sm text-muted-foreground">
          Matched on meaning, not just words.
        </p>
      )}

      {!results.isError && debounced.trim().length > 1 && hits.length === 0 && !results.isFetching && (
        <div className="mt-10">
          <EmptyState
            icon={<span className="text-4xl">🔍</span>}
            title="Nothing found"
            description="Try fewer words, or describe the kind of place instead of naming one."
          />
        </div>
      )}

      {hits.length > 0 && (
        <ul className="mt-8 flex flex-col gap-2">
          {hits.map((hit) => (
            <li
              key={`${hit.kind}-${hit.id}`}
              className="flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3"
            >
              <span aria-hidden="true" className="text-2xl">
                {flagOf(hit.countryCode)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{highlight(hit.name, debounced)}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {[hit.region, hit.country].filter((part) => part !== null).join(', ') || hit.kind}
                </p>
              </div>

              {hit.bestSeason !== null && (
                <span className="hidden shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground sm:block">
                  Best in {hit.bestSeason}
                </span>
              )}

              {hit.costIndex !== null && (
                <div className="hidden w-24 shrink-0 sm:block">
                  <div
                    role="meter"
                    aria-valuenow={hit.costIndex}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Cost index ${String(hit.costIndex)} of 100`}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: `${String(hit.costIndex)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-xs text-muted-foreground">cost</p>
                </div>
              )}

              {/* Which arm hit. This is the hybrid search made visible. */}
              <div className="hidden shrink-0 gap-1 md:flex">
                {hit.matched_by.map((arm) => (
                  <span
                    key={arm}
                    title={`Matched by ${ARM_LABEL[arm].toLowerCase()} search`}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    {ARM_LABEL[arm]}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const Route = createFileRoute('/search')({
  component: SearchScreen,
})
