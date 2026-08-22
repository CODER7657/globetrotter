import type { Envelope, Paginated } from '@globetrotter/contracts'

/**
 * The one place the frontend talks to the API.
 *
 * Every response shape and every field name comes from `@globetrotter/contracts`
 * — nothing here re-declares a type the contracts package already owns. #65 is
 * explicit that the drift from doing so cost the team every authenticated route.
 */

const BASE = '/api/v1'

/**
 * RFC 9457 problem+json, which is what the API returns on failure (#16).
 * Surfaced as a typed error so screens can show `detail` rather than a status
 * code, and quote `correlationId` when something needs chasing in the logs.
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string
  readonly correlationId: string | undefined

  constructor(status: number, title: string, detail: string, correlationId?: string) {
    super(detail || title)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail || title
    this.correlationId = correlationId
  }
}

interface ProblemJson {
  readonly title?: string
  readonly detail?: string
  readonly correlationId?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    // Auth is a rotating refresh cookie (#15), so every call must send it.
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    let problem: ProblemJson = {}
    try {
      problem = (await response.json()) as ProblemJson
    } catch {
      // A non-JSON error body (a proxy or gateway page). Status is all we have.
    }
    throw new ApiError(
      response.status,
      problem.title ?? response.statusText,
      problem.detail ?? '',
      problem.correlationId,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** GET a single resource. Unwraps the `{ data }` envelope. */
export async function getOne<T>(path: string): Promise<T> {
  const body = await request<Envelope<T>>(path)
  return body.data
}

/** GET a list. Returns `data` and `page` so the caller can keep paging. */
export async function getList<T>(path: string): Promise<Paginated<T>> {
  return request<Paginated<T>>(path)
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const result = await request<Envelope<T>>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return result.data
}

/**
 * PATCH with optimistic concurrency. The API hands back the version as an
 * ETag on GET (#17); sending it as `If-Match` is what makes a concurrent edit
 * fail loudly instead of silently overwriting someone else's change.
 */
export async function patch<T>(path: string, body: unknown, version?: number): Promise<T> {
  const result = await request<Envelope<T>>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: version === undefined ? {} : { 'If-Match': `"${String(version)}"` },
  })
  return result.data
}

export async function del(path: string, version?: number): Promise<void> {
  await request<void>(path, {
    method: 'DELETE',
    headers: version === undefined ? {} : { 'If-Match': `"${String(version)}"` },
  })
}

/** Build a query string, dropping empty values so URLs stay readable. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs === '' ? '' : `?${qs}`
}
