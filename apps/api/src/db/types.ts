import type { ColumnType, Generated } from "kysely";

/**
 * Kysely's view of the schema in db/migrations (owned by @CODER7657, #42).
 * Hand-written to mirror the SQL — the SQL is the source of truth, not this
 * file (issue #13: do not hide the SQL).
 *
 * `ColumnType<Select, Insert, Update>` expresses a column the database owns:
 * readable always, never written from application code.
 */
type Timestamp = ColumnType<Date, string | Date | undefined, string | Date>;

/** Database-maintained: DEFAULT now() plus an app.touch_updated_at() trigger. */
type Managed = ColumnType<Date, never, never>;

/**
 * A range column. Postgres hands ranges back in their text form
 * (`["2026-09-01","2026-09-15")`) and node-pg has no parser for them, so they
 * read as strings. Writes go through an explicit `daterange(...)` /
 * `tstzrange(...)` expression rather than a bare value — hence `never` on
 * insert and update.
 */
type Range = ColumnType<string, string, string>;

export type UserRole = "traveler" | "admin";
export type TripStatus = "draft" | "planned" | "active" | "completed" | "archived";
export type TripVisibility = "private" | "unlisted" | "public";
export type CostCategory = "transport" | "stay" | "activity" | "meal" | "other";
export type TransportMode = "flight" | "train" | "bus" | "car" | "ferry" | "walk" | "other";
export type CollaboratorRole = "viewer" | "editor";

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  role: Generated<UserRole>;
  home_currency: Generated<string>;
  locale: Generated<string>;
  email_verified_at: Timestamp | null;
  last_login_at: Timestamp | null;
  created_at: Managed;
  updated_at: Managed;
  deleted_at: Timestamp | null;
}

export interface RefreshTokenFamiliesTable {
  id: Generated<string>;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: Managed;
  revoked_at: Timestamp | null;
  revoked_reason: string | null;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  family_id: string;
  /** bytea, not hex text — a Buffer on both read and write. */
  token_hash: Buffer;
  issued_at: Managed;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
}

export interface CitiesTable {
  id: Generated<string>;
  country_code: string;
  name: string;
  slug: string;
  admin_area: string | null;
  latitude: string;
  longitude: string;
  timezone: string;
  population: number | null;
  popularity: Generated<number>;
  summary: string | null;
  hero_image_url: string | null;
  best_months: Generated<number[]>;
  created_at: Managed;
  updated_at: Managed;
}

/** Catalogue reference data. Read-only to the API role (005_rls). */
export interface ActivitiesTable {
  id: Generated<string>;
  city_id: string;
  category_id: number;
  name: string;
  slug: string;
  description: string | null;
  duration_minutes: number;
  cost_amount: string;
  currency_code: string;
  rating: string | null;
  image_url: string | null;
  booking_required: Generated<boolean>;
  created_at: Managed;
  updated_at: Managed;
}

export interface TripsTable {
  id: Generated<string>;
  owner_id: string;
  name: string;
  description: string | null;
  /**
   * The source of truth for a trip's dates, as a `[)` daterange. Written via a
   * `daterange(...)` expression; never assigned directly.
   */
  period: Range;
  status: Generated<TripStatus>;
  visibility: Generated<TripVisibility>;
  base_currency: string;
  budget_cap: string | null;
  cover_image_url: string | null;
  /** Optimistic concurrency token. Starts at 1, bumped by trigger. */
  version: ColumnType<number, never, never>;
  created_at: Managed;
  updated_at: Managed;
  deleted_at: Timestamp | null;
  /** GENERATED ALWAYS ... VIRTUAL — readable, never writable. */
  start_date: ColumnType<string, never, never>;
  end_date: ColumnType<string, never, never>;
}

export interface TripStopsTable {
  id: Generated<string>;
  trip_id: string;
  city_id: string;
  seq: number;
  period: Range;
  arrival_mode: TransportMode | null;
  arrival_cost: Generated<string>;
  lodging_cost: Generated<string>;
  notes: string | null;
  created_at: Managed;
  updated_at: Managed;
}

export interface TripActivitiesTable {
  id: Generated<string>;
  stop_id: string;
  activity_id: string | null;
  title: string;
  slot: Range;
  category: Generated<CostCategory>;
  /** NUMERIC arrives as a string. Keeping it a string is deliberate. */
  cost_amount: Generated<string>;
  notes: string | null;
  created_at: Managed;
  updated_at: Managed;
}

export interface TripCollaboratorsTable {
  trip_id: string;
  user_id: string;
  role: Generated<CollaboratorRole>;
  invited_by: string | null;
  created_at: Managed;
}

export interface TripSharesTable {
  id: Generated<string>;
  trip_id: string;
  slug: string;
  created_by: string;
  created_at: Managed;
  revoked_at: Timestamp | null;
  view_count: Generated<number>;
}

export interface Database {
  users: UsersTable;
  refresh_token_families: RefreshTokenFamiliesTable;
  refresh_tokens: RefreshTokensTable;
  cities: CitiesTable;
  activities: ActivitiesTable;
  trips: TripsTable;
  trip_stops: TripStopsTable;
  trip_activities: TripActivitiesTable;
  trip_collaborators: TripCollaboratorsTable;
  trip_shares: TripSharesTable;
}
