import { unsafeId } from "@globetrotter/contracts";
import {
  averages,
  engagement,
  listUsers,
  topActivities,
  topCities,
  totals,
  tripsOverTime,
} from "./admin.repository.js";
import type {
  AdminMetrics,
  AdminMetricsQuery,
  AdminUser,
  AdminUserQuery,
  Paginated,
  UserId,
} from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { AdminUserRow } from "./admin.repository.js";

/** Admin analytics (#66 item 3). */

const TOP_N = 10;

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: unsafeId<UserId>(row.id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    homeCurrency: row.home_currency,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    tripCount: row.trip_count ?? 0,
  };
}

const encodeCursor = (key: string, id: string): string =>
  Buffer.from(`${key}\u0000${id}`, "utf8").toString("base64url");

function decodeCursor(cursor: string | undefined): { key: string; id: string } | undefined {
  if (cursor === undefined) return undefined;

  // NUL-separated rather than space-separated: a timestamp contains a space,
  // so splitting on one would truncate the key.
  const [key, id] = Buffer.from(cursor, "base64url").toString("utf8").split("\u0000");
  if (key === undefined || id === undefined) return undefined;

  return { key, id };
}

export interface AdminService {
  metrics(userId: UserId, query: AdminMetricsQuery): Promise<AdminMetrics>;
  users(userId: UserId, query: AdminUserQuery): Promise<Paginated<AdminUser>>;
}

export function createAdminService(withTx: WithTx): AdminService {
  return {
    async metrics(userId, query) {
      return withTx(userId, async (trx) => {
        // One transaction for all six queries, so every number on the screen
        // describes the same instant. Separate round trips could show a trip
        // count that disagrees with the per-day series beside it.
        const [counts, series, cities, activities, avgs, active] = await Promise.all([
          totals(trx),
          tripsOverTime(trx, query.days),
          topCities(trx, TOP_N),
          topActivities(trx, TOP_N),
          averages(trx),
          engagement(trx),
        ]);

        return {
          totals: counts,
          tripsOverTime: series,
          topCities: cities.map((c) => ({
            cityId: c.city_id,
            name: c.name,
            countryCode: c.country_code,
            tripCount: c.trip_count,
          })),
          topActivities: activities.map((a) => ({
            activityId: a.activity_id,
            name: a.name,
            scheduledCount: a.scheduled_count,
          })),
          averages: {
            tripLengthDays: avgs.trip_length_days,
            budget: avgs.budget,
            stopsPerTrip: avgs.stops_per_trip,
          },
          engagement: active,
        };
      });
    },

    async users(userId, query) {
      const rows = await withTx(userId, (trx) =>
        listUsers(trx, {
          q: query.q,
          role: query.role,
          includeSuspended: query.includeSuspended,
          sort: query.sort,
          after: decodeCursor(query.cursor),
          limit: query.limit,
        }),
      );

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      const keyOf = (row: AdminUserRow): string =>
        query.sort === "email"
          ? row.email
          : query.sort === "lastLoginAt"
            ? (row.last_login_at?.toISOString() ?? "")
            : row.created_at.toISOString();

      return {
        data: page.map(toAdminUser),
        page: {
          hasMore,
          nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last), last.id) : null,
        },
      };
    },
  };
}
