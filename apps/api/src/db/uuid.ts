import { randomBytes } from "node:crypto";

/**
 * UUIDv7 generated in the application.
 *
 * WHY THIS EXISTS. `INSERT ... RETURNING` cannot work on RLS-protected tables
 * whose SELECT policy is a STABLE function: RETURNING is subject to that
 * policy, and the function evaluates against the statement's snapshot, so it
 * cannot see the row being inserted. `trips_read` is
 * `USING app.can_read_trip(id)`, so the insert is rejected outright.
 *
 * The API therefore supplies the id, inserts without RETURNING, and reads the
 * row back in a second statement, which does get a fresh snapshot.
 *
 * This is the sanctioned approach, not a stopgap — 008_auth_support settles it
 * explicitly: adding a SECURITY DEFINER function to avoid one line of
 * application code would be the worse trade. Do not delete this expecting the
 * column DEFAULT to take over.
 *
 * Layout per RFC 9562 §5.7:
 *   48 bits  unix_ts_ms   (big-endian)
 *    4 bits  version (7)
 *   12 bits  rand_a
 *    2 bits  variant (0b10)
 *   62 bits  rand_b
 *
 * Time-ordered, which is what the keyset pagination in this module relies on.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48-bit timestamp, most significant byte first.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 in the high nibble of byte 6, keeping the random low nibble.
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  // RFC 9562 variant: top two bits 10.
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
