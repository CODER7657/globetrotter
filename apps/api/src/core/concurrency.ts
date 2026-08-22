import { ErrorCode } from "@globetrotter/contracts";
import { AppError } from "./errors.js";

/**
 * Optimistic concurrency via `If-Match` (#66).
 *
 * `trips.version` advances on every mutation anywhere in the trip graph —
 * `notify_trip_change` calls `app.bump_trip_version` from triggers on trips,
 * trip_stops and trip_activities. So one version guards the whole itinerary:
 * a client holding version 7 is refused if anyone touched any part of it.
 *
 * That is what makes the collaboration beat honest. Two people editing one
 * trip is the demo; a stale write silently winning would undercut the claim
 * the whole project makes.
 */

/**
 * Parses an `If-Match` header into a version.
 *
 * Accepts `"7"`, `W/"7"` and bare `7`. Returns undefined when the header is
 * absent — per RFC 9110 a missing `If-Match` means "no precondition", so the
 * request proceeds. Present-but-unparseable is a client error, not a silent
 * pass: sending a malformed precondition and having it ignored is how a stale
 * write sneaks through.
 */
export function parseIfMatch(header: string | string[] | undefined): number | undefined {
  if (header === undefined) return undefined;

  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim().length === 0) return undefined;

  const trimmed = raw.trim();

  // `*` means "any current representation", which for a resource that exists
  // is always satisfied.
  if (trimmed === "*") return undefined;

  const match = /^(?:W\/)?"?(\d+)"?$/.exec(trimmed);
  if (match?.[1] === undefined) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Malformed If-Match header: ${trimmed}. Expected an ETag such as "7".`,
    );
  }

  return Number(match[1]);
}

/**
 * Thrown when the caller's version is not the current one.
 *
 * Carries the current version so the route can hand back the server's state
 * alongside the 409 — a client that just learns "conflict" has to re-fetch to
 * find out what happened, and during a live collaboration that is another
 * round trip in the middle of a race it already lost.
 */
export class VersionConflictError extends AppError {
  readonly currentVersion: number;

  constructor(expected: number, currentVersion: number) {
    super(
      ErrorCode.VERSION_MISMATCH,
      `Trip has changed since you loaded it (you have version ${expected}, current is ${currentVersion})`,
    );
    this.currentVersion = currentVersion;
  }
}

/** Throws unless `expected` is undefined or matches `actual`. */
export function assertVersion(expected: number | undefined, actual: number): void {
  if (expected === undefined) return;
  if (expected === actual) return;

  throw new VersionConflictError(expected, actual);
}
