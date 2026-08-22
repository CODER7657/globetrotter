import { describe, expect, it } from "vitest";
import { uuidv7 } from "./uuid.js";

describe("uuidv7", () => {
  it("produces a well-formed version 7, RFC 9562 variant UUID", () => {
    const id = uuidv7();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts lexicographically in time order", () => {
    // Keyset pagination orders by id and assumes that equals creation order.
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_700_000_001_000);

    expect(early < late).toBe(true);
  });

  it("does not collide within the same millisecond", () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(now)));

    expect(ids.size).toBe(1000);
  });

  it("encodes the timestamp in the leading 48 bits", () => {
    const now = 1_700_000_000_000;
    const hex = uuidv7(now).replaceAll("-", "").slice(0, 12);

    expect(parseInt(hex, 16)).toBe(now);
  });
});
