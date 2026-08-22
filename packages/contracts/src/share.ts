import { z } from "zod";
import { TripId, UserId } from "./ids.js";
import { IsoDateTimeSchema } from "./common.js";
import { TripActivitySchema, TripSchema, TripStopSchema, TripVisibilitySchema } from "./trip.js";

/**
 * Sharing contracts (issue #20).
 *
 * The slug is the entire credential for an unlisted trip, so it is generated
 * server-side and never accepted from a client.
 */

/** Matches `trip_shares_slug_shape` in 004_trips. */
export const ShareSlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, "malformed share link");

export type ShareSlug = z.infer<typeof ShareSlugSchema>;

export const TripShareSchema = z.object({
  slug: ShareSlugSchema,
  /** Absolute link, built from APP_BASE_URL so the client never assembles it. */
  url: z.string().url(),
  createdAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  viewCount: z.number().int().nonnegative(),
});

export type TripShare = z.infer<typeof TripShareSchema>;

/**
 * Visibility transitions the API accepts. `private` is the resting state;
 * `unlisted` needs a link; `public` is discoverable.
 */
export const ShareTripBodySchema = z.object({
  visibility: TripVisibilitySchema.exclude(["private"]),
});

export type ShareTripBody = z.infer<typeof ShareTripBodySchema>;

/**
 * A trip as an anonymous link-holder sees it.
 *
 * Everything identifying the owner is omitted — no id, no email, no display
 * name. `ownerId` on the private TripSchema is exactly the field that must not
 * appear here, which is why this is a separate schema rather than a `.omit()`
 * on a shared base that someone could later widen by accident.
 */
export const PublicTripSchema = z.object({
  name: TripSchema.shape.name,
  description: TripSchema.shape.description,
  startDate: TripSchema.shape.startDate,
  endDate: TripSchema.shape.endDate,
  visibility: TripVisibilitySchema,
  baseCurrency: TripSchema.shape.baseCurrency,
  coverImageUrl: TripSchema.shape.coverImageUrl,
  stops: z.array(
    TripStopSchema.omit({ tripId: true }).extend({
      cityName: z.string(),
      countryCode: z.string().length(2),
      activities: z.array(TripActivitySchema.omit({ stopId: true })),
    }),
  ),
});

export type PublicTrip = z.infer<typeof PublicTripSchema>;

/** Open Graph metadata for link previews. */
export const OpenGraphSchema = z.object({
  title: z.string(),
  description: z.string(),
  url: z.string().url(),
  image: z.string().url().nullable(),
  type: z.literal("website"),
});

export type OpenGraph = z.infer<typeof OpenGraphSchema>;

export const CopyTripBodySchema = z.object({
  /** Defaults to the source name prefixed with "Copy of". */
  name: z.string().min(1).max(120).trim().optional(),
});

export type CopyTripBody = z.infer<typeof CopyTripBodySchema>;

export const CopiedTripSchema = z.object({
  id: TripId,
  ownerId: UserId,
  name: z.string(),
  stopCount: z.number().int().nonnegative(),
  activityCount: z.number().int().nonnegative(),
});

export type CopiedTrip = z.infer<typeof CopiedTripSchema>;
