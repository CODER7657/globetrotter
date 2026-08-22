import { unsafeId } from "@globetrotter/contracts";
import { listTripSummaries } from "./summary.repository.js";
import type { CursorQuery, Paginated, TripId, TripSummary, UserId } from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { TripSummaryRow } from "./summary.repository.js";

/**
 * Trip cards for the dashboard (#66 item 3).
 *
 * `remaining` and `overBudget` are derived here rather than in the view
 * because they are presentation of the same two numbers, not new facts — and
 * NUMERIC arrives as an exact decimal string, so the subtraction is done on
 * strings-as-decimals rather than floats.
 */

/** Exact decimal subtraction, avoiding a float round trip. */
function subtractMoney(a: string, b: string): string {
  const scale = 100n;
  const toCents = (v: string): bigint => {
    const [whole = "0", frac = ""] = v.split(".");
    const cents = `${frac}00`.slice(0, 2);
    const sign = whole.startsWith("-") ? -1n : 1n;
    return sign * (BigInt(whole.replace("-", "")) * scale + BigInt(cents));
  };

  const result = toCents(a) - toCents(b);
  const negative = result < 0n;
  const abs = negative ? -result : result;

  return `${negative ? "-" : ""}${abs / scale}.${String(abs % scale).padStart(2, "0")}`;
}

function toSummary(row: TripSummaryRow): TripSummary {
  const remaining = row.budget_cap === null ? null : subtractMoney(row.budget_cap, row.total_cost);

  return {
    tripId: unsafeId<TripId>(row.trip_id),
    ownerId: unsafeId<UserId>(row.owner_id),
    name: row.name,
    status: row.status,
    visibility: row.visibility,
    baseCurrency: row.base_currency,
    budgetCap: row.budget_cap,
    coverImageUrl: row.cover_image_url,
    startDate: row.start_date,
    endDate: row.end_date,
    totalDays: row.total_days,
    stopCount: row.stop_count,
    activityCount: row.activity_count,
    totalCost: row.total_cost,
    remaining,
    overBudget: remaining !== null && remaining.startsWith("-"),
  };
}

const encodeCursor = (id: string): string => Buffer.from(id, "utf8").toString("base64url");

const decodeCursor = (cursor: string | undefined): string | undefined =>
  cursor === undefined ? undefined : Buffer.from(cursor, "base64url").toString("utf8");

export interface SummaryService {
  list(userId: UserId, query: CursorQuery): Promise<Paginated<TripSummary>>;
}

export function createSummaryService(withTx: WithTx): SummaryService {
  return {
    async list(userId, query) {
      const rows = await withTx(userId, (trx) =>
        listTripSummaries(trx, {
          afterId: decodeCursor(query.cursor),
          limit: query.limit,
        }),
      );

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return {
        data: page.map(toSummary),
        page: {
          hasMore,
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.trip_id) : null,
        },
      };
    },
  };
}
