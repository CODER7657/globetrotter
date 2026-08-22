import { ProblemDetailsSchema, type ProblemDetails } from '@globetrotter/contracts'

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
 * `credentials: 'include'` on every call — the refresh token is an httpOnly
 * cookie the browser must send and JavaScript must never read.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, accessToken, signal } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken != null) headers['Authorization'] = `Bearer ${accessToken}`

  const init: RequestInit = { method, headers, credentials: 'include' }
  if (body !== undefined) init.body = JSON.stringify(body)
  if (signal !== undefined) init.signal = signal

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch (cause) {
    // Distinguish "the network failed" from "the server said no" — the first is
    // retryable and the second is not, and the messages differ for the user.
    throw new ApiError(0, null, 'Could not reach the server. Check your connection.')
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readProblem(response), response.statusText)
  }

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json()
  // Unwrap the envelope. A response without `data` is returned as-is so this
  // stays usable for any endpoint that does not use one.
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}
