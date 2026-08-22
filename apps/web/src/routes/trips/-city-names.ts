import { useCallback, useRef, useState } from 'react'

/**
 * cityId → display name.
 *
 * `TripStop` carries only `cityId`; the name lives in the catalogue. Rather
 * than fetch each city individually, we remember the name at the moment the
 * user picks it out of search — which is the only way a stop gets created, so
 * the map is populated by construction.
 *
 * A stop loaded from a previous session has no entry until the catalogue
 * endpoint lands in #70, so `nameFor` degrades to a short id rather than
 * rendering an empty row.
 */
export function useCityNames() {
  const map = useRef(new Map<string, string>())
  const [, forceRender] = useState(0)

  const remember = useCallback((cityId: string, name: string): void => {
    if (map.current.get(cityId) === name) return
    map.current.set(cityId, name)
    forceRender((n) => n + 1)
  }, [])

  const nameFor = useCallback(
    (cityId: string): string => map.current.get(cityId) ?? `City ${cityId.slice(0, 8)}`,
    [],
  )

  return { nameFor, remember }
}
