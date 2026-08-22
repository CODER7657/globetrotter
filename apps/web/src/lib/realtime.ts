/**
 * Collaborative editing client (issue #7, the demo beat in #67).
 *
 * Pairs with `apps/api/src/modules/realtime/realtime.routes.ts`. The wire
 * contract, restated so this file can be read on its own:
 *
 *   client → server   {type:"auth", token}   ← must arrive within 5s
 *                     {type:"ping"}
 *   server → client   {type:"ready", tripId, connectionId}
 *                     {type:"trip.changed", trip, entity, op, id, version, actor, at}
 *                     {type:"pong"}
 *
 *   close 4400 bad frame · 4401 unauthenticated · 4403 forbidden · 4404 no such trip
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. Events carry IDS ONLY, never row data — deliberately, because the server's
 *    listener connection is not the requesting user and must not be what decides
 *    who may see what. So an event never patches the cache directly. It
 *    invalidates, and the refetch goes through the normal authorized API where
 *    the user's own RLS policies apply.
 *
 * 2. WE DROP THE ECHO OF OUR OWN WRITES. Every event carries `actor`. Without
 *    this, saving a stop would round-trip and overwrite whatever the user typed
 *    in the ~200ms since — the classic collaborative-editing cursor jump.
 *
 * 3. 4401/4403/4404 ARE TERMINAL. Reconnecting after "invalid token" or "no such
 *    trip" is an infinite loop against a server that has already given its
 *    answer. Only transport failures back off and retry.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

// ─────────────────────────────────────────────────────────────── wire types ──

export interface TripChangedEvent {
  trip: string
  entity: 'trip' | 'stop' | 'activity'
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  id: string
  version: number
  /** null when the change came from a migration or admin console, not a request. */
  actor: string | null
  at: string
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'live'
  | 'reconnecting'
  | 'failed'

export interface TripChannel {
  status: ConnectionStatus
  /** Set when the server refused us for a reason retrying cannot fix. */
  error: string | null
  /** Server-assigned id for this socket. Useful for debugging presence. */
  connectionId: string | null
  /** Monotonic count of applied remote events — handy in tests and the demo. */
  eventCount: number
}

// ───────────────────────────────────────────────────────────────── tuning ──

/**
 * WebSocket.OPEN, as a plain number.
 *
 * `socket.OPEN` reads the constant off the instance, which works on the browser
 * WebSocket and silently yields `undefined` anywhere else — making every
 * `readyState === socket.OPEN` guard quietly false. The numeric constant is part
 * of the WHATWG spec and cannot go missing.
 */
const OPEN = 1

const AUTH_DEADLINE_MS = 5_000
const PING_MS = 20_000 // under the server's 25s heartbeat
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 15_000

/** Close codes the server uses to mean "do not come back with this input". */
const TERMINAL_CLOSE = new Set([4401, 4403, 4404])

const CLOSE_REASON: Record<number, string> = {
  4400: 'The server rejected the connection frame.',
  4401: 'Your session expired. Sign in again to keep collaborating.',
  4403: 'You do not have access to this trip.',
  4404: 'This trip no longer exists.',
}

/**
 * Full jitter. Without it, every client dropped by one server restart reconnects
 * in the same millisecond and knocks it over again.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
  return Math.round(random() * ceiling)
}

export function socketUrl(tripId: string, apiBase: string): string {
  const url = new URL(`/api/v1/trips/${tripId}/live`, apiBase)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

/**
 * Which cached queries a given event invalidates.
 *
 * Split out and exported so it can be tested without a socket, and so the key
 * shape lives next to the events that drive it rather than being guessed at
 * three call sites.
 */
export function invalidationKeys(event: TripChangedEvent): unknown[][] {
  const trip = event.trip
  const keys: unknown[][] = [['trip', trip]]

  // Any structural change moves the money, so the cost panel always refetches.
  if (event.entity !== 'trip') keys.push(['trip', trip, 'cost'])
  if (event.entity === 'stop') keys.push(['trip', trip, 'stops'])
  if (event.entity === 'activity') keys.push(['trip', trip, 'stops'], ['trip', trip, 'activities'])
  // A deleted or renamed trip changes the list view too.
  if (event.entity === 'trip') keys.push(['trips'])

  return keys
}

// ───────────────────────────────────────────────── the connection manager ──

export interface ChannelDeps {
  tripId: string
  /** Called at connect time so a refreshed token is picked up on reconnect. */
  getToken: () => string | null
  apiBase: string
  queryClient: QueryClient
  /** Our own user id, so we can drop the echo of our own writes. */
  selfId: string | null
  onState: (patch: Partial<TripChannel>) => void
  onEvent?: (event: TripChangedEvent) => void
  socketFactory?: (url: string) => WebSocket
  now?: () => number
  random?: () => number
}

export function createTripChannel(deps: ChannelDeps): { close: () => void } {
  const makeSocket = deps.socketFactory ?? ((url: string) => new WebSocket(url))
  const random = deps.random ?? Math.random

  let socket: WebSocket | null = null
  let attempt = 0
  let events = 0
  let disposed = false
  let authTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const clearTimers = (): void => {
    if (authTimer !== undefined) clearTimeout(authTimer)
    if (pingTimer !== undefined) clearInterval(pingTimer)
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    authTimer = pingTimer = retryTimer = undefined
  }

  const scheduleRetry = (): void => {
    if (disposed) return
    const delay = backoffDelay(attempt, random)
    attempt += 1
    deps.onState({ status: 'reconnecting' })
    retryTimer = setTimeout(connect, delay)
  }

  function connect(): void {
    if (disposed) return

    const token = deps.getToken()
    if (token === null) {
      // Not signed in yet. Not an error — wait to be re-enabled.
      deps.onState({ status: 'idle' })
      return
    }

    deps.onState({ status: 'connecting', error: null })

    let ws: WebSocket
    try {
      ws = makeSocket(socketUrl(deps.tripId, deps.apiBase))
    } catch {
      scheduleRetry()
      return
    }
    socket = ws

    ws.onopen = () => {
      deps.onState({ status: 'authenticating' })
      ws.send(JSON.stringify({ type: 'auth', token }))
      // The server closes us at 5s; fail slightly after so its close code —
      // which is more specific than ours — is the one the user sees.
      authTimer = setTimeout(() => {
        if (ws.readyState === OPEN) ws.close()
      }, AUTH_DEADLINE_MS + 500)
    }

    ws.onmessage = (raw: MessageEvent) => {
      let frame: unknown
      try {
        frame = JSON.parse(String(raw.data))
      } catch {
        return // a malformed frame is the server's bug; do not tear down over it
      }
      const msg = frame as { type?: string } & Partial<TripChangedEvent> & {
        connectionId?: string
      }

      if (msg.type === 'ready') {
        if (authTimer !== undefined) clearTimeout(authTimer)
        attempt = 0 // a successful session resets the backoff ladder
        deps.onState({
          status: 'live',
          error: null,
          connectionId: msg.connectionId ?? null,
        })
        pingTimer = setInterval(() => {
          if (ws.readyState === OPEN) ws.send(JSON.stringify({ type: 'ping' }))
        }, PING_MS)
        return
      }

      if (msg.type === 'pong') return

      if (msg.type === 'trip.changed') {
        const event = msg as TripChangedEvent

        // Our own write, echoed back. Applying it would clobber whatever the
        // user has typed since — see the file header.
        if (event.actor !== null && event.actor === deps.selfId) return

        events += 1
        deps.onState({ eventCount: events })
        for (const key of invalidationKeys(event)) {
          void deps.queryClient.invalidateQueries({ queryKey: key })
        }
        deps.onEvent?.(event)
      }
    }

    ws.onerror = () => {
      // `error` is always followed by `close`; retry is handled there so we do
      // not schedule two reconnects for one failure.
    }

    ws.onclose = (ev: CloseEvent) => {
      clearTimers()
      socket = null
      if (disposed) return

      if (TERMINAL_CLOSE.has(ev.code)) {
        deps.onState({
          status: 'failed',
          error: CLOSE_REASON[ev.code] ?? 'The server closed the connection.',
        })
        return
      }
      scheduleRetry()
    }
  }

  connect()

  return {
    close(): void {
      disposed = true
      clearTimers()
      // 1000 = normal closure, so the server drops our presence row cleanly
      // instead of leaving a ghost avatar until the 90s reaper sweeps it.
      if (socket !== null && socket.readyState <= OPEN) socket.close(1000, 'client navigating away')
      socket = null
    },
  }
}

// ─────────────────────────────────────────────────────────────── the hook ──

export interface UseTripChannelOptions {
  tripId: string | undefined
  /** Access token. Held in memory by the auth layer — never localStorage. */
  token: string | null
  /** Current user id, so our own echoes are dropped. */
  selfId: string | null
  enabled?: boolean
  onEvent?: (event: TripChangedEvent) => void
}

const IDLE: TripChannel = { status: 'idle', error: null, connectionId: null, eventCount: 0 }

/**
 * Subscribes to live changes for one trip and keeps the query cache honest.
 *
 * @example
 * const { status } = useTripChannel({ tripId, token, selfId: user.id })
 */
export function useTripChannel(options: UseTripChannelOptions): TripChannel {
  const { tripId, token, selfId, enabled = true, onEvent } = options
  const queryClient = useQueryClient()
  const [state, setState] = useState<TripChannel>(IDLE)

  // Read through refs so a new token or a new callback does not tear down and
  // rebuild a healthy socket. Only tripId and enabled should do that.
  const tokenRef = useRef(token)
  const selfRef = useRef(selfId)
  const eventRef = useRef(onEvent)
  tokenRef.current = token
  selfRef.current = selfId
  eventRef.current = onEvent

  const apiBase = useMemo(
    () => (import.meta.env['VITE_API_URL'] as string | undefined) ?? window.location.origin,
    [],
  )

  // Only re-run when the trip changes, we are toggled, or a token appears for
  // the first time (signing in should connect a channel that was idle).
  const hasToken = token !== null

  useEffect(() => {
    if (!enabled || tripId === undefined || !hasToken) {
      setState(IDLE)
      return
    }

    setState({ ...IDLE, status: 'connecting' })

    const channel = createTripChannel({
      tripId,
      apiBase,
      queryClient,
      getToken: () => tokenRef.current,
      selfId: selfRef.current,
      onState: (patch) => setState((prev) => ({ ...prev, ...patch })),
      onEvent: (event) => eventRef.current?.(event),
    })

    return () => channel.close()
  }, [tripId, enabled, hasToken, apiBase, queryClient])

  return state
}
