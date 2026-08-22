import type { FxRate } from '@globetrotter/contracts'
import { useQuery } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { request } from './api.js'

/**
 * The traveller's display currency.
 *
 * A trip stores costs in its own `baseCurrency`, and the cost engine returns
 * them in that currency. Showing "USD" beside a number the database computed in
 * EUR would be a lie, so the preference only changes what is displayed once a
 * real rate exists — otherwise the amount is shown in the currency it was
 * actually calculated in.
 */

const STORAGE_KEY = 'gt-preferred-currency'

interface CurrencyContextValue {
  readonly preferred: string
  readonly setPreferred: (code: string) => void
  /** Formats `amount`, converting from `from` when a rate is available. */
  readonly format: (amount: number, from: string) => string
  /** True when the last format call had to fall back to the source currency. */
  readonly canConvert: (from: string) => boolean
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'EUR'
  } catch {
    return 'EUR'
  }
}

export function CurrencyProvider({ children }: { readonly children: ReactNode }) {
  const [preferred, setPreferredState] = useState<string>(readStored)

  // Reference data, public, and unchanging within a session.
  const { data } = useQuery<FxRate[]>({
    queryKey: ['fx-rates'],
    queryFn: () => request<FxRate[]>('/fx-rates'),
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const rates = useMemo(() => {
    const map = new Map<string, number>()
    for (const rate of data ?? []) {
      map.set(`${rate.base}->${rate.quote}`, Number(rate.rate))
    }
    return map
  }, [data])

  const rateFor = useCallback(
    (from: string, to: string): number | null => {
      if (from === to) return 1
      const direct = rates.get(`${from}->${to}`)
      if (direct !== undefined) return direct
      // The table is not symmetric, so try the inverse before giving up.
      const inverse = rates.get(`${to}->${from}`)
      if (inverse !== undefined && inverse !== 0) return 1 / inverse
      return null
    },
    [rates],
  )

  const setPreferred = useCallback((code: string): void => {
    setPreferredState(code)
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // A blocked localStorage must not break the app.
    }
  }, [])

  // Another tab changing the preference should not leave this one stale.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY && event.newValue !== null) {
        setPreferredState(event.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const value = useMemo<CurrencyContextValue>(() => {
    const canConvert = (from: string): boolean => rateFor(from, preferred) !== null

    const format = (amount: number, from: string): string => {
      const rate = rateFor(from, preferred)
      const target = rate === null ? from : preferred
      const value = rate === null ? amount : amount * rate
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: target,
          maximumFractionDigits: 0,
        }).format(value)
      } catch {
        // An unknown ISO code should degrade, not throw.
        return `${String(Math.round(value))} ${target}`
      }
    }

    return { preferred, setPreferred, format, canConvert }
  }, [preferred, setPreferred, rateFor])

  return <CurrencyContext value={value}>{children}</CurrencyContext>
}

export function useCurrency(): CurrencyContextValue {
  const context = use(CurrencyContext)
  if (context === null) {
    throw new Error('useCurrency must be used inside <CurrencyProvider>')
  }
  return context
}
