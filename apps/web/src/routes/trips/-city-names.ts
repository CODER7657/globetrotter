import type { City, Paginated } from '@globetrotter/contracts'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { requestPage } from '../../lib/api.js'

/**
 * cityId → display name.
 *
 * `TripStop` carries only `cityId`, and the catalogue owns the name. An earlier
 * version remembered names as the user picked them out of search, which meant a
 * trip opened in a fresh session rendered every stop as "City 01a0290c" — the
 * names were only ever in memory from a search that had not happened yet.
 *
 * The catalogue is small and public (`GET /cities` needs no auth), so it is
 * fetched once and cached for the session. `remember` is kept so search results
 * can still seed a name the instant a user picks one, before the list resolves.
 */

const CATALOGUE_LIMIT = 100

export function useCityNames() {
  const seeded = useRef(new Map<string, string>())

  const { data } = useQuery<Paginated<City>>({
    queryKey: ['cities', CATALOGUE_LIMIT],
    queryFn: () => requestPage<City>(`/cities?limit=${String(CATALOGUE_LIMIT)}`),
    // The catalogue is reference data — it does not change during a session.
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const remember = useCallback((cityId: string, name: string): void => {
    seeded.current.set(cityId, name)
  }, [])

  const nameFor = useCallback(
    (cityId: string): string => {
      const fromCatalogue = data?.data.find((city) => city.id === cityId)
      if (fromCatalogue !== undefined) return fromCatalogue.name
      return seeded.current.get(cityId) ?? '…'
    },
    [data],
  )

  return { nameFor, remember }
}
