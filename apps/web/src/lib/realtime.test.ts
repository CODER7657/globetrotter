import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backoffDelay,
  createTripChannel,
  invalidationKeys,
  socketUrl,
  type TripChangedEvent,
} from './realtime'

/**
 * A WebSocket stand-in with the handful of members the client touches, plus
 * hooks to drive it from a test. The real thing cannot be used here: the point
 * is to assert what happens on a 4401 versus a 1006, and a live server will not
 * produce those on demand.
 */
class FakeSocket {
  static instances: FakeSocket[] = []

  readyState = 0 // CONNECTING
  sent: string[] = []
  closedWith: { code: number | undefined; reason: string | undefined } | null = null

  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason }
    this.readyState = 3
  }

  // ── test drivers ───────────────────────────────────────────────────────────
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }

  deliverRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  serverClose(code: number): void {
    this.readyState = 3
    this.onclose?.({ code } as CloseEvent)
  }

  static latest(): FakeSocket {
    const s = FakeSocket.instances.at(-1)
    if (s === undefined) throw new Error('no socket was created')
    return s
  }

  static reset(): void {
    FakeSocket.instances = []
  }
}

const TRIP = '11111111-1111-7111-8111-111111111111'
const ME = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const THEM = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'

function event(over: Partial<TripChangedEvent> = {}): TripChangedEvent {
  return {
    trip: TRIP,
    entity: 'stop',
    op: 'INSERT',
    id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    version: 2,
    actor: THEM,
    at: '2026-08-22T10:00:00.000Z',
    ...over,
  }
}

function harness(over: Partial<Parameters<typeof createTripChannel>[0]> = {}) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  const states: Record<string, unknown>[] = []
  const seen: TripChangedEvent[] = []

  const channel = createTripChannel({
    tripId: TRIP,
    apiBase: 'http://localhost:3000',
    queryClient,
    getToken: () => 'tok-123',
    selfId: ME,
    onState: (patch) => states.push(patch),
    onEvent: (e) => seen.push(e),
    socketFactory: (url) => new FakeSocket(url) as unknown as WebSocket,
    random: () => 1, // deterministic: full jitter always returns the ceiling
    ...over,
  })

  const status = (): string | undefined =>
    [...states].reverse().find((s) => 'status' in s)?.['status'] as string | undefined

  return { channel, states, seen, invalidate, status }
}

beforeEach(() => {
  FakeSocket.reset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ───────────────────────────────────────────────────────────── pure helpers ──

describe('socketUrl', () => {
  it('upgrades http to ws', () => {
    expect(socketUrl(TRIP, 'http://localhost:3000')).toBe(
      `ws://localhost:3000/api/v1/trips/${TRIP}/live`,
    )
  })

  it('upgrades https to wss — never downgrades a secure page to a plaintext socket', () => {
    expect(socketUrl(TRIP, 'https://globetrotter.app')).toBe(
      `wss://globetrotter.app/api/v1/trips/${TRIP}/live`,
    )
  })
})

describe('backoffDelay', () => {
  it('grows exponentially', () => {
    expect(backoffDelay(0, () => 1)).toBe(500)
    expect(backoffDelay(1, () => 1)).toBe(1000)
    expect(backoffDelay(3, () => 1)).toBe(4000)
  })

  it('caps so a long outage does not become a 9-hour wait', () => {
    expect(backoffDelay(30, () => 1)).toBe(15_000)
  })

  it('applies full jitter — clients dropped together must not return together', () => {
    expect(backoffDelay(5, () => 0)).toBe(0)
    expect(backoffDelay(5, () => 0.5)).toBe(7500)
    expect(backoffDelay(5, () => 1)).toBe(15_000)
  })
})

describe('invalidationKeys', () => {
  it('always refetches the trip itself', () => {
    expect(invalidationKeys(event())).toContainEqual(['trip', TRIP])
  })

  it('refetches cost for any structural change — every edit moves the money', () => {
    expect(invalidationKeys(event({ entity: 'stop' }))).toContainEqual(['trip', TRIP, 'cost'])
    expect(invalidationKeys(event({ entity: 'activity' }))).toContainEqual(['trip', TRIP, 'cost'])
  })

  it('does not refetch cost for a trip-level rename', () => {
    expect(invalidationKeys(event({ entity: 'trip' }))).not.toContainEqual(['trip', TRIP, 'cost'])
  })

  it('refetches the trips list when the trip row itself changed', () => {
    expect(invalidationKeys(event({ entity: 'trip' }))).toContainEqual(['trips'])
  })
})

// ─────────────────────────────────────────────────────────── the connection ──

describe('handshake', () => {
  it('sends auth as the FIRST frame, and never puts the token in the URL', () => {
    harness()
    const ws = FakeSocket.latest()
    ws.open()

    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'tok-123' })
    expect(ws.url).not.toContain('tok-123')
    expect(ws.url).not.toContain('token')
  })

  it('reaches live on ready and reports the connection id', () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'conn-1' })

    expect(h.status()).toBe('live')
    expect(h.states.at(-1)).toMatchObject({ connectionId: 'conn-1' })
  })

  it('does not connect at all when there is no token yet', () => {
    const h = harness({ getToken: () => null })
    expect(FakeSocket.instances).toHaveLength(0)
    expect(h.status()).toBe('idle')
  })

  it('pings inside the server heartbeat window so the socket is not reaped', () => {
    harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })
    ws.sent.length = 0

    vi.advanceTimersByTime(20_000)
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'ping' })
  })
})

describe('events', () => {
  it("drops the echo of our OWN write — otherwise it clobbers what the user is typing", () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })
    h.invalidate.mockClear()

    ws.deliver({ type: 'trip.changed', ...event({ actor: ME }) })

    expect(h.invalidate).not.toHaveBeenCalled()
    expect(h.seen).toHaveLength(0)
  })

  it("applies another user's write", () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })
    h.invalidate.mockClear()

    ws.deliver({ type: 'trip.changed', ...event({ actor: THEM }) })

    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['trip', TRIP] })
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['trip', TRIP, 'cost'] })
    expect(h.seen).toHaveLength(1)
  })

  it('applies a change with a null actor (migration or admin console)', () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })
    h.invalidate.mockClear()

    ws.deliver({ type: 'trip.changed', ...event({ actor: null }) })
    expect(h.seen).toHaveLength(1)
  })

  it('survives a malformed frame instead of tearing down the session', () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })

    expect(() => ws.deliverRaw('{not json')).not.toThrow()
    expect(h.status()).toBe('live')
  })
})

describe('reconnection', () => {
  it('retries a transport drop', () => {
    const h = harness()
    FakeSocket.latest().serverClose(1006) // abnormal closure

    expect(h.status()).toBe('reconnecting')
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it.each([
    [4401, 'expired session'],
    [4403, 'no access'],
    [4404, 'no such trip'],
  ])('does NOT retry on %i (%s) — the server already gave its answer', (code) => {
    const h = harness()
    FakeSocket.latest().serverClose(code)

    expect(h.status()).toBe('failed')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('surfaces an actionable message rather than a close code', () => {
    const h = harness()
    FakeSocket.latest().serverClose(4401)
    expect(h.states.at(-1)?.['error']).toMatch(/sign in again/i)
  })

  it('resets the backoff ladder after a successful session', () => {
    const h = harness()
    FakeSocket.latest().serverClose(1006)
    vi.advanceTimersByTime(500)

    const second = FakeSocket.latest()
    second.open()
    second.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })
    second.serverClose(1006)

    // Back to the first rung (500ms), not the second (1000ms).
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(3)
    expect(h.status()).toBe('connecting')
  })

  it('re-reads the token on reconnect so a refreshed one is picked up', () => {
    let token = 'old'
    harness({ getToken: () => token })
    FakeSocket.latest().serverClose(1006)
    token = 'refreshed'

    vi.advanceTimersByTime(500)
    const ws = FakeSocket.latest()
    ws.open()
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'refreshed' })
  })
})

describe('teardown', () => {
  it('closes with 1000 so presence is dropped instead of leaving a ghost avatar', () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })

    h.channel.close()
    expect(ws.closedWith?.code).toBe(1000)
  })

  it('does not reconnect after close() — navigating away must end it', () => {
    const h = harness()
    h.channel.close()
    FakeSocket.latest().serverClose(1006)

    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('stops pinging after close()', () => {
    const h = harness()
    const ws = FakeSocket.latest()
    ws.open()
    ws.deliver({ type: 'ready', tripId: TRIP, connectionId: 'c' })
    h.channel.close()
    ws.sent.length = 0

    vi.advanceTimersByTime(120_000)
    expect(ws.sent).toHaveLength(0)
  })
})
