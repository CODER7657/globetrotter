import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api.js'

/**
 * Bind an API failure onto a form.
 *
 * The server sends `errors: [{ path, code, message }]`, where `path` is the
 * field name. Setting the server's own message on that field is what makes
 * client and server incapable of disagreeing about why an input was rejected —
 * which is the whole reason both sides validate with the same schema.
 *
 * Returns the message for anything not attributable to a single field, so the
 * caller can show it at form level rather than dropping it.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Please try again.'
  }

  let bound = 0
  for (const [path, message] of error.fieldErrors) {
    // Only bind paths the form actually renders; an unmatched path would set an
    // error the user can never see or clear.
    if ((knownFields as readonly string[]).includes(path)) {
      setError(path as Path<T>, { type: 'server', message })
      bound += 1
    }
  }

  if (bound > 0) return null

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'That email and password do not match an account.'
    case 'DUPLICATE':
      return 'An account with that email already exists.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a minute and try again.'
    case 'TOKEN_EXPIRED':
      return 'That link has expired. Request a new one.'
    case 'TOKEN_REPLAYED':
      return 'That link has already been used. Request a new one.'
    default:
      return error.message
  }
}

/** Form-level error banner content, or null when the form is clean. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0
}
