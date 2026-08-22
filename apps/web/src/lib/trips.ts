import type {
  Paginated,
  ReorderStopsBody,
  Trip,
  TripStop,
} from '@globetrotter/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { request, requestPage } from './api.js'
import { useAuth } from './auth.js'
// TEMPORARY: owned by packages/contracts in PR #70. See pending-contracts.ts.
import type { CostBreakdown, SearchHit } from './pending-contracts.js'

/**
 * Trip data access.
 *
 * Every read is one call. Nothing here aggregates, sums or re-ranks: the cost
 * breakdown is computed by `app.trip_cost_breakdown()` and search is ranked by
 * `app.search_places` with RRF. Recomputing either in JavaScript would produce
 * numbers that disagree with the database.
 */

/** Binds the in-memory access token onto the raw request helpers. */
export function useApi() {
  const { getAccessToken } = useAuth()

  const get = useCallback(
    <T,>(path: string) => request<T>(path, { accessToken: getAccessToken() }),
    [getAccessToken],
  )
  const getPage = useCallback(
    <T,>(path: string) => requestPage<T>(path, { accessToken: getAccessToken() }),
    [getAccessToken],
  )
  const send = useCallback(
    <T,>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) =>
      request<T>(path, { method, body, accessToken: getAccessToken() }),
    [getAccessToken],
  )

  return { get, getPage, send }
}

export function useTrips(limit = 20) {
  const { getPage } = useApi()
  const { status } = useAuth()

  return useQuery<Paginated<Trip>>({
    queryKey: ['trips', limit],
    queryFn: () => getPage<Trip>(`/trips?limit=${String(limit)}`),
    enabled: status === 'authenticated',
  })
}

export function useTrip(tripId: string) {
  const { get } = useApi()
  const { status } = useAuth()

  return useQuery<Trip>({
    queryKey: ['trip', tripId],
    queryFn: () => get<Trip>(`/trips/${tripId}`),
    enabled: status === 'authenticated' && tripId !== '',
  })
}

export function useStops(tripId: string) {
  const { getPage } = useApi()
  const { status } = useAuth()

  return useQuery<Paginated<TripStop>>({
    queryKey: ['stops', tripId],
    queryFn: () => getPage<TripStop>(`/trips/${tripId}/stops?limit=100`),
    enabled: status === 'authenticated' && tripId !== '',
  })
}

/**
 * The entire budget panel in one call.
 *
 * `app.trip_cost_breakdown()` returns categories, the per-day series, the
 * cumulative curve and transfer warnings together. Money arrives as a JSON
 * number rather than the decimal string used elsewhere, and the contract is
 * explicit that the client must not do arithmetic on it — summing categories
 * in JavaScript can disagree with the total the database computed in exact
 * numeric. Render what it returns.
 */
export function useCost(tripId: string) {
  const { get } = useApi()
  const { status } = useAuth()

  return useQuery<CostBreakdown>({
    queryKey: ['cost', tripId],
    queryFn: () => get<CostBreakdown>(`/trips/${tripId}/cost`),
    enabled: status === 'authenticated' && tripId !== '',
    // The endpoint ships in #70. Until it merges this 404s; a retry storm
    // behind a loading state helps nobody.
    retry: false,
  })
}

export function useSearch(query: string, kind: 'all' | 'city' | 'activity' = 'city') {
  const { get } = useApi()
  const { status } = useAuth()
  const trimmed = query.trim()

  return useQuery<SearchHit[]>({
    queryKey: ['search', kind, trimmed],
    queryFn: () =>
      get<SearchHit[]>(
        `/search?q=${encodeURIComponent(trimmed)}&kind=${kind}&limit=8`,
      ),
    enabled: status === 'authenticated' && trimmed.length >= 2,
    retry: false,
    staleTime: 60_000,
  })
}

/**
 * Reorder stops optimistically.
 *
 * The move is shown immediately and rolled back if the server rejects it. The
 * caller surfaces the rejection with `conflictMessage`, which turns the
 * constraint name into a sentence naming the actual city.
 */
export function useReorderStops(tripId: string) {
  const { send } = useApi()
  const queryClient = useQueryClient()
  const key = ['stops', tripId]

  return useMutation({
    mutationFn: (body: ReorderStopsBody) =>
      send<void>(`/trips/${tripId}/stops/order`, 'POST', body),

    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Paginated<TripStop>>(key)

      if (previous !== undefined) {
        const bySeq = new Map(body.stopIds.map((id, index) => [id, index]))
        queryClient.setQueryData<Paginated<TripStop>>(key, {
          ...previous,
          data: [...previous.data].sort(
            (a, b) => (bySeq.get(a.id) ?? 0) - (bySeq.get(b.id) ?? 0),
          ),
        })
      }
      return { previous }
    },

    onError: (_error, _body, context) => {
      // Snap back. The toast naming the conflict is raised by the caller.
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous)
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['cost', tripId] })
    },
  })
}
