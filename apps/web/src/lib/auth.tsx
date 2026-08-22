import type {
  AuthSession,
  LoginBody,
  PublicUser,
  SignupBody,
} from '@globetrotter/contracts'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, request } from './api.js'

/**
 * Session state.
 *
 * The access token lives in a ref and nowhere else — never localStorage, never
 * sessionStorage, never a non-httpOnly cookie. Anything readable by JavaScript
 * is readable by injected JavaScript. Durability comes from the refresh cookie,
 * which the browser sends and scripts cannot see.
 */

type Status = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  readonly status: Status
  readonly user: PublicUser | null
  readonly login: (body: LoginBody) => Promise<void>
  readonly signup: (body: SignupBody) => Promise<void>
  readonly logout: () => Promise<void>
  readonly getAccessToken: () => string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const tokenRef = useRef<string | null>(null)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  const adopt = useCallback((session: AuthSession): void => {
    tokenRef.current = session.accessToken
    setUser(session.user)
    setStatus('authenticated')
  }, [])

  const clear = useCallback((): void => {
    tokenRef.current = null
    setUser(null)
    setStatus('anonymous')
  }, [])

  // On boot, try to trade the refresh cookie for a session. A 401 here is the
  // normal "not signed in" path, not an error worth surfacing.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const session = await request<AuthSession>('/auth/refresh', { method: 'POST' })
        if (!cancelled) adopt(session)
      } catch {
        if (!cancelled) clear()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adopt, clear])

  const login = useCallback(
    async (body: LoginBody): Promise<void> => {
      adopt(await request<AuthSession>('/auth/login', { method: 'POST', body }))
    },
    [adopt],
  )

  const signup = useCallback(
    async (body: SignupBody): Promise<void> => {
      adopt(await request<AuthSession>('/auth/signup', { method: 'POST', body }))
    },
    [adopt],
  )

  const logout = useCallback(async (): Promise<void> => {
    try {
      await request<void>('/auth/logout', { method: 'POST' })
    } catch (error) {
      // The cookie is cleared server-side regardless; a failure here must not
      // strand the user in a half-signed-in state.
      if (!(error instanceof ApiError)) throw error
    } finally {
      clear()
    }
  }, [clear])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, signup, logout, getAccessToken: () => tokenRef.current }),
    [status, user, login, signup, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
