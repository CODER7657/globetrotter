# ADR 0001 — Itinerary integrity is enforced by PostgreSQL, not by application code

**Status:** accepted · **Date:** 2026-08-22 · **Verified against:** PostgreSQL 18.6

## Context

An itinerary is a temporal structure. A stop occupies a span of time in a city;
an activity occupies a slot inside that stop. Three things must never be true:

1. A traveller is in two cities at the same time.
2. Two activities occupy the same slot within one stop.
3. An activity is scheduled at a time when its stop is not happening.

The default approach is to check these in the service layer before an `INSERT`.
That is wrong for a reason that has nothing to do with tidiness: **it is not
concurrency-safe.** Two simultaneous requests can both read "no conflict", both
pass validation, and both write. The check and the write are not atomic. Under
the realtime collaborative editing this product is built around, that race is
not theoretical — it is the normal case.

## Decision

Enforce all three in the schema, using index-backed constraints.

```sql
-- 1. no two stops of one trip overlap
CONSTRAINT trip_stops_no_overlap
  EXCLUDE USING gist (trip_id WITH =, period WITH &&)

-- 2. no two activities in one stop overlap
CONSTRAINT trip_activities_no_double_book
  EXCLUDE USING gist (stop_id WITH =, slot WITH &&)

-- 3. an activity's slot is contained in its stop's period — referentially
CONSTRAINT trip_activities_within_stop
  FOREIGN KEY (stop_id, PERIOD slot) REFERENCES trip_stops (id, PERIOD period)
```

(3) is a **temporal foreign key**, new in PostgreSQL 18. It makes containment in
time a referential guarantee rather than a procedural check, and it is what
`trip_stops`' temporal primary key `(id, period WITHOUT OVERLAPS)` exists to
support.

A fourth constraint applies the same idea one level up: one owner cannot hold
two *committed* trips that overlap. Drafts are exempt, because comparing two
alternative plans for the same week is a legitimate thing for a user to do.

## Consequences

**Good.** The race condition has no window; PostgreSQL takes the predicate lock.
Correctness does not depend on every future code path remembering to call a
validator. And the constraints are self-documenting — `\d trip_stops` states the
business rules.

**We inherit two behaviours worth knowing about.**

*Shrinking a stop out from under a scheduled activity is refused* (SQLSTATE
`23503`). We kept this. Silently deleting someone's plans because they trimmed a
date is worse than a clear error; the UI surfaces which activities are in the way.

*Deleting requires help.* PostgreSQL 18 supports only `NO ACTION` and `RESTRICT`
as referential actions on a temporal foreign key — both `ON DELETE CASCADE` and
`ON UPDATE CASCADE` are rejected at DDL time:

```
ERROR:  unsupported ON DELETE action for foreign key constraint using PERIOD
```

Without a workaround, deleting a *trip* fails: the cascade reaches `trip_stops`
and is then blocked by the temporal FK from `trip_activities`. We solve it with
a `BEFORE DELETE` trigger on `trip_stops` that removes child activities first.
The trigger deliberately does **not** extend to `UPDATE`, preserving the
behaviour above.

## Alternatives rejected

- **Validate in the service layer.** Not concurrency-safe. Rejected on correctness.
- **`SERIALIZABLE` isolation.** Would work, but pays a global cost for a local
  problem and pushes retry handling into every write path.
- **Advisory locks per trip.** Correct, but hand-rolled, easy to forget, and
  invisible to anyone reading the schema.

## Fallback

If a deployment target is pinned below PostgreSQL 18, drop the temporal PK/FK
and keep the two `EXCLUDE` constraints (available since 9.0). Guarantees 1 and 2
survive unchanged; guarantee 3 degrades to a `BEFORE INSERT OR UPDATE` trigger
checking containment. Same behaviour, more code, no schema-level documentation.

## Evidence

`db/tests/001_temporal_integrity.sql` — 24 assertions, all passing, covering
each guarantee plus the delete-cascade path and the field-level `CHECK`
constraints. Run with `db/scripts/test.sh`.
