import type { ColumnType, Generated } from "kysely";

/**
 * Kysely's view of the schema. Hand-written to mirror db/migrations — the SQL
 * is the source of truth, not this file (issue #13: do not hide the SQL).
 *
 * `ColumnType<Select, Insert, Update>` is how a DB-generated column is
 * expressed: readable always, never supplied on insert or update.
 */
type Timestamp = ColumnType<Date, string | Date | undefined, string | Date>;
type CreatedAt = ColumnType<Date, never, never>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  role: "user" | "admin";
  email_verified_at: Timestamp | null;
  deleted_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface RefreshTokenFamiliesTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  revoked_at: Timestamp | null;
  expires_at: Timestamp;
  created_at: CreatedAt;
}

export interface CitiesTable {
  id: Generated<string>;
  name: string;
  country_code: string;
  created_at: CreatedAt;
}

export interface ActivitiesTable {
  id: Generated<string>;
  city_id: string;
  name: string;
  created_at: CreatedAt;
}

export interface TripsTable {
  id: Generated<string>;
  owner_id: string;
  title: string;
  description: string | null;
  /** DATE columns come back as `YYYY-MM-DD` strings, not Date. */
  start_date: string;
  end_date: string;
  cover_image_url: string | null;
  /** Defaults to 'private' in SQL, so it is optional on insert. */
  visibility: Generated<"private" | "unlisted" | "public">;
  /** Maintained by trg_trips_version; never written from application code. */
  version: ColumnType<number, never, never>;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, never, never>;
}

export interface TripStopsTable {
  id: Generated<string>;
  trip_id: string;
  city_id: string;
  position: number;
  arrival_date: string;
  departure_date: string;
  notes: string | null;
  created_at: CreatedAt;
}

export interface TripActivitiesTable {
  id: Generated<string>;
  stop_id: string;
  activity_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  /** NUMERIC arrives as a string. Keeping it a string is deliberate. */
  cost_amount: string | null;
  currency_code: string | null;
  notes: string | null;
  created_at: CreatedAt;
}

export interface Database {
  users: UsersTable;
  refresh_token_families: RefreshTokenFamiliesTable;
  cities: CitiesTable;
  activities: ActivitiesTable;
  trips: TripsTable;
  trip_stops: TripStopsTable;
  trip_activities: TripActivitiesTable;
}
