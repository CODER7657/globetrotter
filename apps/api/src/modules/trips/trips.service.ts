import { unsafeId } from "@globetrotter/contracts";
import { NotFoundError } from "../../core/errors.js";
import { findTripById, insertTrip, listTripsByOwner } from "./trips.repository.js";
import type { Paginated, Trip, TripId, UserId } from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { CreateTripBody, CursorQuery } from "./trips.schema.js";
import type { TripRow } from "./trips.repository.js";

/**
 * Business rules and transaction boundaries. Knows nothing about Fastify:
 * it takes plain arguments and throws AppErrors, which is what makes it
 * testable without a server.
 */

/** Row -> contract. The one place snake_case becomes camelCase. */
function toTrip(row: TripRow): Trip {
  return {
    id: unsafeId<TripId>(row.id),
    ownerId: unsafeId<UserId>(row.owner_id),
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    visibility: row.visibility,
    baseCurrency: row.base_currency,
    budgetCap: row.budget_cap,
    coverImageUrl: row.cover_image_url,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const encodeCursor = (id: string): string => Buffer.from(id, "utf8").toString("base64url");

const decodeCursor = (cursor: string | undefined): string | undefined =>
  cursor === undefined ? undefined : Buffer.from(cursor, "base64url").toString("utf8");

export interface TripsService {
  create(userId: UserId, body: CreateTripBody): Promise<Trip>;
  getById(userId: UserId, tripId: TripId): Promise<Trip>;
  list(userId: UserId, query: CursorQuery): Promise<Paginated<Trip>>;
}

export function createTripsService(withTx: WithTx): TripsService {
  return {
    async create(userId, body) {
      const row = await withTx(userId, (trx) =>
        insertTrip(trx, {
          ownerId: userId,
          name: body.name,
          description: body.description ?? null,
          startDate: body.startDate,
          endDate: body.endDate,
          baseCurrency: body.baseCurrency,
          budgetCap: body.budgetCap ?? null,
          coverImageUrl: body.coverImageUrl ?? null,
        }),
      );

      return toTrip(row);
    },

    async getById(userId, tripId) {
      const row = await withTx(userId, (trx) => findTripById(trx, tripId));

      // RLS already filtered rows this user may not read, so "no row" covers
      // both "does not exist" and "not yours". 404 either way, deliberately.
      if (row === undefined) {
        throw new NotFoundError("Trip");
      }

      return toTrip(row);
    },

    async list(userId, query) {
      const rows = await withTx(userId, (trx) =>
        listTripsByOwner(trx, {
          ownerId: userId,
          afterId: decodeCursor(query.cursor),
          limit: query.limit,
        }),
      );

      // The repository fetched limit+1; the extra row only tells us there is
      // another page and is not itself returned.
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return {
        data: page.map(toTrip),
        page: {
          hasMore,
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.id) : null,
        },
      };
    },
  };
}
