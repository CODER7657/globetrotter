import { z } from "zod";

/**
 * Branded ID schemas.
 *
 * Every entity ID is a UUIDv7 string at runtime, but a *distinct* type at
 * compile time. This makes `deleteStop(tripId)` a type error rather than a
 * production incident — the single highest-value 40 lines in this package.
 */

const uuid = z.string().uuid();

export const UserId = uuid.brand<"UserId">();
export const TripId = uuid.brand<"TripId">();
export const StopId = uuid.brand<"StopId">();
export const ActivityId = uuid.brand<"ActivityId">();
export const TripActivityId = uuid.brand<"TripActivityId">();
export const CityId = uuid.brand<"CityId">();

export type UserId = z.infer<typeof UserId>;
export type TripId = z.infer<typeof TripId>;
export type StopId = z.infer<typeof StopId>;
export type ActivityId = z.infer<typeof ActivityId>;
export type TripActivityId = z.infer<typeof TripActivityId>;
export type CityId = z.infer<typeof CityId>;

/**
 * Escape hatch for the repository layer, which receives untyped `string`
 * columns back from the driver. Never call this in a route or service.
 */
export const unsafeId = <T extends string>(value: string): T => value as T;
