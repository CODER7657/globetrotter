import { ApiError } from './api.js'

/**
 * Database constraint → a sentence a traveller understands.
 *
 * This is the demo beat. The database makes an impossible itinerary
 * unstorable, and the API names the rule that rejected the write — it cannot
 * phrase it, because it does not know which city or activity the user was
 * looking at. Turning `trip_stops_no_overlap` into "You'd already be in Rome
 * on those dates" is this layer's job.
 *
 * A generic red toast throws the beat away. The specific sentence is the point.
 */

export interface ConflictContext {
  /** City the user was acting on, when known. */
  readonly city?: string | undefined
  /** Activity the user was placing, when known. */
  readonly activity?: string | undefined
  /** The city or activity already occupying the slot, when the API says. */
  readonly conflictsWith?: string | undefined
}

const FALLBACK = 'That change collides with something already in this trip.'

export function conflictMessage(error: unknown, context: ConflictContext = {}): string {
  if (!(error instanceof ApiError)) return FALLBACK

  const city = context.city ?? 'that city'
  const activity = context.activity ?? 'that activity'
  const other = context.conflictsWith

  switch (error.constraint) {
    case 'trip_stops_no_overlap':
      return `You'd already be in ${city} on those dates.`

    case 'trip_activities_no_double_book':
      return other !== undefined
        ? `That slot already has ${other}.`
        : `That slot already has something else booked.`

    case 'trip_activities_within_stop':
      return `That's outside your ${city} stay.`

    case 'trips_owner_no_overlap':
      return `You already have another trip running on those dates.`

    default:
      break
  }

  // Not a temporal constraint — still worth being specific where the error
  // model lets us be.
  switch (error.code) {
    case 'VERSION_MISMATCH':
      return 'Someone else changed this trip while you were editing. Reload to see their version.'
    case 'OVERLAP':
      return `${activity} overlaps something already scheduled.`
    case 'FK_VIOLATION':
      return 'That referenced something which no longer exists.'
    case 'NOT_FOUND':
      return 'That item has already been removed.'
    default:
      return error.problem?.detail ?? error.message ?? FALLBACK
  }
}

/** True when the failure is a conflict the user can resolve by editing. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.constraint !== null)
}
