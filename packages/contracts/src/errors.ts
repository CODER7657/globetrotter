import { z } from "zod";

/**
 * Shared error vocabulary (issue #16).
 *
 * The server maps every failure to one of these codes; the client switches on
 * the same enum. Adding a code here is the only way to add a failure mode.
 */
export const ErrorCode = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REPLAYED: "TOKEN_REPLAYED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  OVERLAP: "OVERLAP",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  FK_VIOLATION: "FK_VIOLATION",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCodeSchema = z.enum([
  ErrorCode.VALIDATION_FAILED,
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.INVALID_CREDENTIALS,
  ErrorCode.TOKEN_EXPIRED,
  ErrorCode.TOKEN_REPLAYED,
  ErrorCode.FORBIDDEN,
  ErrorCode.NOT_FOUND,
  ErrorCode.DUPLICATE,
  ErrorCode.OVERLAP,
  ErrorCode.VERSION_MISMATCH,
  ErrorCode.FK_VIOLATION,
  ErrorCode.RATE_LIMITED,
  ErrorCode.PAYLOAD_TOO_LARGE,
  ErrorCode.INTERNAL,
]);

/** One field-level failure, shaped so a form library can bind it directly. */
export const FieldErrorSchema = z.object({
  /** JSON Pointer-ish dotted path, e.g. `stops.0.arrivalDate`. */
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;

/**
 * RFC 9457 `application/problem+json`, plus two extension members we always
 * send: `code` (the enum above) and `traceId` (correlates to the log line).
 */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: ErrorCodeSchema,
  traceId: z.string(),
  errors: z.array(FieldErrorSchema).optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Default HTTP status for each code, so route handlers never hand-pick one. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_REPLAYED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.DUPLICATE]: 409,
  [ErrorCode.OVERLAP]: 409,
  [ErrorCode.VERSION_MISMATCH]: 409,
  [ErrorCode.FK_VIOLATION]: 422,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.INTERNAL]: 500,
};
