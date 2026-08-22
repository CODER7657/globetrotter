import {
  ProblemDetailsSchema,
  type Paginated,
  type ProblemDetails,
} from '@globetrotter/contracts'

/**
 * The one place that knows the wire format.
 *
 * Two shapes, both from the API contract and neither obvious:
 *   success → { data: T }            (envelope, issue #14)
 *   failure → application/problem+json, RFC 9457 (issue #16)
 *
 * Screens deal in `T` and `ApiError`. Nothing above this file parses an
 * envelope or reads a status code.
 */

export const API_BASE = '/api/v1'

/**
 * A failed request, with the field-level detail already extracted.
 *
 * `fieldErrors` maps the server's `path` straight onto a form field name, so
 * the message the user reads is the server's own — client and server can not
 * disagree about what is wrong with an input.
 */
export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetails | null
  readonly fieldErrors: ReadonlyMap<string, string>

  constructor(status: number, problem: ProblemDetails | null, fallback: string) {
    super(problem?.detail ?? problem?.title ?? fallback)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
    const fields = new Map<string, string>()
    for (const error of problem?.errors ?? []) {
      // First message per path wins: a form field shows one error at a time.
      if (!fields.has(error.path)) fields.set(error.path, error.message)
    }
    this.fieldErrors = fields
  }

  /** The stable enum from packages/contracts, or null if the body was unusable. */
  get code(): string | null {
    return this.problem?.code ?? null
  }

  /**
   * The database constraint that rejected a write, when one did. The API names
   * the rule rather than phrasing it — it does not know the city or trip name —
   * so the UI turns this into a sentence a traveller understands (issue #41).
   */
  get constraint(): string | null {
    return this.problem?.constraint ?? null
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly body?: unknown
  readonly accessToken?: string | null
  readonly signal?: AbortSignal
  /** Optimistic concurrency: sent as `If-Match` so a stale write 409s (#17). */
  readonly ifMatch?: number
}

async function readProblem(response: Response): Promise<ProblemDetails | null> {
  try {
    const parsed = ProblemDetailsSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The raw body, with no unwrapping.
 *
 * `credentials: 'include'` on every call — the refresh token is an httpOnly
 * cookie the browser must send and JavaScript must never read.
 */
export async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, accessToken, signal, ifMatch } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken != null) headers['Authorization'] = `Bearer ${accessToken}`
  if (ifMatch !== undefined) headers['If-Match'] = `"${String(ifMatch)}"`

  const init: RequestInit = { method, headers, credentials: 'include' }
  if (body !== undefined) init.body = JSON.stringify(body)
  if (signal !== undefined) init.signal = signal

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    // Distinguish "the network failed" from "the server said no" — the first is
    // retryable and the second is not, and the messages differ for the user.
    throw new ApiError(0, null, 'Could not reach the server. Check your connection.')
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readProblem(response), response.statusText)
  }

  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

/**
 * A single resource: unwraps the `{ data: T }` envelope.
 *
 * A body without `data` is returned as-is, so this stays usable for any
 * endpoint that does not use an envelope.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const payload = await rawRequest<unknown>(path, options)
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

/**
 * A list: `{ data: T[], page: { nextCursor, hasMore } }`, kept intact.
 *
 * `request` would unwrap `data` and discard the cursor, which is how a "load
 * more" silently stops working. The cursor is an opaque keyset token — hand it
 * back verbatim, never parse it.
 */
export async function requestPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Paginated<T>> {
  return rawRequest<Paginated<T>>(path, options)
}

// ── Convenience helpers ─────────────────────────────────────────────────────
//
// These wrap `request` / `requestPage` rather than opening a second client.
// #65 and #54 both say a duplicate is the thing to avoid: two API layers means
// two places that decode an envelope, two ApiError shapes, and two chances to
// get the auth header wrong.

/** GET a single resource, envelope unwrapped. */
export async function getOne<T>(path: string, accessToken?: string | null): Promise<T> {
  return request<T>(path, accessToken == null ? {} : { accessToken })
}

/** GET a list, keeping `page` so the caller can keep paging. */
export async function getList<T>(
  path: string,
  accessToken?: string | null,
): Promise<Paginated<T>> {
  return requestPage<T>(path, accessToken == null ? {} : { accessToken })
}

export async function post<T>(path: string, body: unknown, accessToken?: string | null): Promise<T> {
  return request<T>(path, { method: 'POST', body, ...(accessToken == null ? {} : { accessToken }) })
}

/**
 * PATCH with optimistic concurrency. The API hands the version back as an ETag
 * on GET (#17); sending it as `If-Match` is what makes a concurrent edit fail
 * loudly instead of silently overwriting someone else's change.
 */
export async function patch<T>(
  path: string,
  body: unknown,
  version?: number,
  accessToken?: string | null,
): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body,
    ...(version === undefined ? {} : { ifMatch: version }),
    ...(accessToken == null ? {} : { accessToken }),
  })
}

export async function del(path: string, version?: number, accessToken?: string | null): Promise<void> {
  return request<void>(path, {
    method: 'DELETE',
    ...(version === undefined ? {} : { ifMatch: version }),
    ...(accessToken == null ? {} : { accessToken }),
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
