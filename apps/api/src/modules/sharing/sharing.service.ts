import { randomBytes } from "node:crypto";
import { ErrorCode, unsafeId } from "@globetrotter/contracts";
import { ConflictError, NotFoundError } from "../../core/errors.js";
import { findTripById } from "../trips/trips.repository.js";
import {
  appendTripEvent,
  copyTripGraph,
  findActiveShare,
  findTripBySlug,
  insertShare,
  listActivitiesForStops,
  listPublicStops,
  recordView,
  revokeShares,
  setVisibility,
} from "./sharing.repository.js";
import type {
  CopiedTrip,
  OpenGraph,
  PublicTrip,
  TripId,
  TripShare,
  TripVisibility,
  UserId,
} from "@globetrotter/contracts";
import type { WithShareTx, WithTx } from "../../db/plugin.js";
import type { ShareRow } from "./sharing.repository.js";

/**
 * Sharing rules (issue #20).
 *
 * The slug is the whole credential for an unlisted trip, so it is minted here
 * and never accepted from a client.
 */

/**
 * 16 random bytes as base64url — 22 characters, ~128 bits.
 *
 * Not sequential and not derived from the trip id: a shareable link that can
 * be incremented or reversed into an id is not a private link. Comfortably
 * inside `trip_shares_slug_shape`, which allows 16–64 of `[A-Za-z0-9_-]`.
 */
function mintSlug(): string {
  return randomBytes(16).toString("base64url");
}

function toShare(row: ShareRow, baseUrl: string): TripShare {
  return {
    slug: row.slug,
    url: `${baseUrl}/t/${row.slug}`,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    viewCount: row.view_count,
  };
}

export interface SharingService {
  share(userId: UserId, tripId: TripId, visibility: "unlisted" | "public"): Promise<TripShare>;
  revoke(userId: UserId, tripId: TripId): Promise<void>;
  getPublic(slug: string): Promise<PublicTrip>;
  openGraph(slug: string): Promise<OpenGraph>;
  copy(userId: UserId, tripId: TripId, name: string | undefined): Promise<CopiedTrip>;
}

export function createSharingService(
  withTx: WithTx,
  withShareTx: WithShareTx,
  appBaseUrl: string,
): SharingService {
  /**
   * private -> unlisted -> public is a one-way ratchet; the only way back is
   * revoke(), which drops straight to private and kills every live link. That
   * asymmetry is deliberate: widening access should be a deliberate step,
   * narrowing it should be one action that cannot be half-applied.
   */
  function assertTransition(from: TripVisibility, to: "unlisted" | "public"): void {
    if (from === "public" && to === "unlisted") {
      throw new ConflictError(
        ErrorCode.VALIDATION_FAILED,
        "A public trip cannot be narrowed to unlisted — revoke it and share again",
      );
    }
  }

  return {
    async share(userId, tripId, visibility) {
      const row = await withTx(userId, async (trx) => {
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        // RLS lets a collaborator read a trip, but only the owner may publish
        // it. `trip_shares_write` enforces the same thing; this produces a
        // 403 with an explanation instead of an opaque policy rejection.
        if (trip.owner_id !== userId) {
          throw new ConflictError(
            ErrorCode.FORBIDDEN,
            "Only the trip owner can share it",
          );
        }

        assertTransition(trip.visibility, visibility);
        await setVisibility(trx, tripId, visibility);

        // Audited in the same transaction as the change itself, so the log
        // cannot disagree with the state it describes (#20). The chain hash is
        // computed by a trigger, and actor_id comes from app.current_user_id()
        // inside the function, so neither can be forged from here.
        await appendTripEvent(trx, tripId, "trip.shared", {
          from: trip.visibility,
          to: visibility,
        });

        // Re-sharing returns the existing link rather than minting a second
        // one. Two live slugs for one trip would mean revoking felt done while
        // the other link kept working.
        const existing = await findActiveShare(trx, tripId);
        if (existing !== undefined) return existing;

        return insertShare(trx, { tripId, createdBy: userId, slug: mintSlug() });
      });

      return toShare(row, appBaseUrl);
    },

    async revoke(userId, tripId) {
      await withTx(userId, async (trx) => {
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        if (trip.owner_id !== userId) {
          throw new ConflictError(ErrorCode.FORBIDDEN, "Only the trip owner can revoke sharing");
        }

        // Both, in one transaction. Setting visibility without revoking would
        // leave a live slug behind, and revoking without resetting visibility
        // would leave a public trip discoverable.
        const revoked = await revokeShares(trx, tripId);
        await setVisibility(trx, tripId, "private");

        await appendTripEvent(trx, tripId, "trip.share_revoked", {
          from: trip.visibility,
          to: "private",
          linksRevoked: revoked,
        });
      });
    },

    /**
     * ALWAYS ANONYMOUS, including for the trip's own owner.
     *
     * This is deliberate, not incidental. The route sets
     * `Cache-Control: public, max-age=60`; a response that varied by identity
     * under a public cache directive would let a shared cache serve
     * owner-shaped data to a stranger. Making it owner-aware would require
     * `private` + `Vary: Authorization`, which discards caching on exactly the
     * route that needs it — crawlers and link previews.
     *
     * A logged-in owner following their own link is the client's problem to
     * solve, by redirecting them to the private view.
     */
    async getPublic(slug) {
      return withShareTx(slug, async (trx) => {
        const trip = await findTripBySlug(trx, slug);
        // A revoked or unknown slug is filtered out by policy, not by a
        // predicate here — see findTripBySlug.
        if (trip === undefined) throw new NotFoundError("Shared trip");

        const stops = await listPublicStops(trx, trip.id);
        const activities = await listActivitiesForStops(
          trx,
          stops.map((s) => s.id),
        );

        const byStop = new Map<string, typeof activities>();
        for (const activity of activities) {
          const list = byStop.get(activity.stop_id) ?? [];
          list.push(activity);
          byStop.set(activity.stop_id, list);
        }

        await recordView(trx, slug);

        return {
          name: trip.name,
          description: trip.description,
          startDate: trip.start_date,
          endDate: trip.end_date,
          visibility: trip.visibility,
          baseCurrency: trip.base_currency,
          coverImageUrl: trip.cover_image_url,
          stops: stops.map((stop) => ({
            id: unsafeId<PublicTrip["stops"][number]["id"]>(stop.id),
            cityId: unsafeId<PublicTrip["stops"][number]["cityId"]>(stop.city_id),
            cityName: stop.city_name,
            countryCode: stop.country_code,
            seq: stop.seq,
            arrivesAt: stop.arrives_at.toISOString(),
            departsAt: stop.departs_at.toISOString(),
            arrivalMode: stop.arrival_mode,
            arrivalCost: stop.arrival_cost,
            lodgingCost: stop.lodging_cost,
            notes: stop.notes,
            activities: (byStop.get(stop.id) ?? []).map((a) => ({
              id: unsafeId<PublicTrip["stops"][number]["activities"][number]["id"]>(a.id),
              activityId:
                a.activity_id === null
                  ? null
                  : unsafeId<
                      NonNullable<PublicTrip["stops"][number]["activities"][number]["activityId"]>
                    >(a.activity_id),
              title: a.title,
              startsAt: a.starts_at.toISOString(),
              endsAt: a.ends_at.toISOString(),
              category: a.category,
              costAmount: a.cost_amount,
              notes: a.notes,
            })),
          })),
        };
      });
    },

    async openGraph(slug) {
      const trip = await withShareTx(slug, (trx) => findTripBySlug(trx, slug));
      if (trip === undefined) throw new NotFoundError("Shared trip");

      const stops = await withShareTx(slug, (trx) => listPublicStops(trx, trip.id));
      const cities = stops.map((s) => s.city_name);

      const where =
        cities.length === 0
          ? "A trip on GlobeTrotter"
          : `${cities.slice(0, 3).join(" → ")}${cities.length > 3 ? " and more" : ""}`;

      return {
        title: trip.name,
        description: `${where} · ${trip.start_date} to ${trip.end_date}`,
        url: `${appBaseUrl}/t/${slug}`,
        image: trip.cover_image_url,
        type: "website" as const,
      };
    },

    async copy(userId, tripId, name) {
      const result = await withTx(userId, async (trx) => {
        // RLS decides whether the caller may see the source at all: their own
        // trip, one shared with them, or a public one. Nothing here needs to
        // re-derive that.
        const source = await findTripById(trx, tripId);
        if (source === undefined) throw new NotFoundError("Trip");

        // trips_name_len caps the column at 120, and "Copy of " can push a
        // long name past it.
        const finalName = name ?? `Copy of ${source.name}`.slice(0, 120);

        const copied = await copyTripGraph(trx, {
          sourceTripId: tripId,
          newOwnerId: userId,
          name: finalName,
        });

        // Recorded against the SOURCE trip, not the copy: the fact worth
        // auditing is that someone took a copy of this itinerary, and that is
        // the owner's log to read.
        await appendTripEvent(trx, tripId, "trip.copied", {
          copyId: copied.tripId,
          stopCount: copied.stopCount,
          activityCount: copied.activityCount,
        });

        return { ...copied, name: finalName };
      });

      return {
        id: unsafeId<TripId>(result.tripId),
        ownerId: userId,
        name: result.name,
        stopCount: result.stopCount,
        activityCount: result.activityCount,
      };
    },
  };
}
