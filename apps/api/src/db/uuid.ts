import { randomBytes } from "node:crypto";

/**
 * UUIDv7 generated in the application.
 *
 * WHY THIS EXISTS — it is a workaround, not a preference. The schema defaults
 * every id to `uuidv7()` and that is where ids should come from. But
 * `INSERT ... RETURNING` on `trips` is rejected under the current RLS policies:
 * RETURNING is subject to the SELECT policy, `trips_read` is
 * `USING app.can_read_trip(id)`, and that function is STABLE, so it evaluates
 * against the statement's snapshot and cannot see the row being inserted.
 *
 * So the API supplies the id, inserts without RETURNING, and reads the row
 * back in a second statement (which does get a fresh snapshot).
 *
 * Once `trips_read` gains a direct `owner_id = app.current_user_id()` disjunct
 * this file should be deleted and the DEFAULT used again. See the PR thread.
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
