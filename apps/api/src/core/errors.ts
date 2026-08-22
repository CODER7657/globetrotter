import { ERROR_STATUS, ErrorCode, TemporalConstraintSchema } from "@globetrotter/contracts";
import type { FieldError, TemporalConstraint } from "@globetrotter/contracts";

/**
 * The single error hierarchy (issue #16). Anything thrown that is not an
 * AppError is treated as a bug: logged with its stack, reported to the client
 * as an opaque 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: FieldError[] | undefined;
  /** Set when a database temporal constraint rejected the write (issue #41). */
  readonly constraint: TemporalConstraint | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      fieldErrors?: FieldError[];
      cause?: unknown;
      constraint?: TemporalConstraint;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.constraint = options.constraint;
    Error.captureStackTrace(this, new.target);
  }

  /** `true` for 5xx — the class of error that means *we* are broken. */
  get isInternal(): boolean {
    return this.status >= 500;
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: FieldError[], message = "Request validation failed") {
    super(ErrorCode.VALIDATION_FAILED, message, { fieldErrors });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super(ErrorCode.UNAUTHENTICATED, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super(ErrorCode.FORBIDDEN, message);
  }
}

/**
 * Note that RLS makes "forbidden" and "not found" indistinguishable at the
 * query level — a trip you may not see simply is not there. We deliberately
 * return 404 rather than 403 so the API does not confirm that a private trip
 * exists.
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(ErrorCode.NOT_FOUND, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    options: { cause?: unknown; constraint?: TemporalConstraint } = {},
  ) {
    super(code, message, options);
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error", cause?: unknown) {
    super(ErrorCode.INTERNAL, message, cause === undefined ? {} : { cause });
  }
}

/**
 * The temporal constraints from 004_trips, with a fallback sentence each.
 *
 * These are the demo (#41): the schema makes an impossible itinerary
 * unstorable, and the client should say why in the user's own terms. The API
 * cannot compose the best sentence — it does not have the city or trip name in
 * scope at the point the constraint fires — so it returns both a usable
 * message and the machine-readable `constraint`, and the UI upgrades it to
 * "You'd already be in Rome on those dates".
 *
 * Note that trip_activities_within_stop arrives as 23503, not 23P01: it is a
 * temporal FOREIGN KEY, not an exclusion constraint.
 */
const CONSTRAINT_MAP: Record<
  TemporalConstraint,
  { code: ErrorCode; message: string }
> = {
  trip_stops_no_overlap: {
    code: ErrorCode.OVERLAP,
    message: "You are already somewhere else during those dates",
  },
  trip_activities_no_double_book: {
    code: ErrorCode.OVERLAP,
    message: "That time slot is already taken by another activity",
  },
  trip_activities_within_stop: {
    code: ErrorCode.VALIDATION_FAILED,
    message: "That activity falls outside the stop it belongs to",
  },
  trips_owner_no_overlap: {
    code: ErrorCode.OVERLAP,
    message: "This overlaps another trip you have already committed to",
  },
};

/** Reads the `constraint` field Postgres puts on integrity violations. */
function violatedConstraint(error: unknown): TemporalConstraint | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const parsed = TemporalConstraintSchema.safeParse(
    (error as { constraint?: unknown }).constraint,
  );

  return parsed.success ? parsed.data : undefined;
}

/** Postgres SQLSTATE codes we translate rather than leak (issue #16). */
const PG_CODE_MAP: Record<string, { code: ErrorCode; message: string }> = {
  "23505": { code: ErrorCode.DUPLICATE, message: "That value already exists" },
  "23P01": { code: ErrorCode.OVERLAP, message: "That range overlaps an existing one" },
  "23503": { code: ErrorCode.FK_VIOLATION, message: "Referenced record does not exist" },
  "23514": { code: ErrorCode.VALIDATION_FAILED, message: "A value failed a database constraint" },
};

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Normalises anything thrown into an AppError. The original error is kept as
 * `cause` so the log line has full detail while the client gets none of it.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // A named temporal constraint is more specific than its SQLSTATE, so it
  // wins: 23503 from trip_activities_within_stop is a 422 about containment,
  // not a generic "referenced record does not exist".
  const constraint = violatedConstraint(error);
  if (constraint !== undefined) {
    const mapped = CONSTRAINT_MAP[constraint];
    return new ConflictError(mapped.code, mapped.message, { cause: error, constraint });
  }

  const sqlState = pgErrorCode(error);
  if (sqlState !== undefined) {
    const mapped = PG_CODE_MAP[sqlState];
    if (mapped !== undefined) {
      return new ConflictError(mapped.code, mapped.message, { cause: error });
    }
  }

  return new InternalError("Internal server error", error);
}
