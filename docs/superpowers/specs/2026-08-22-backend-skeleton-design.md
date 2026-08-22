# Backend skeleton — design

**Issue:** [#13](https://github.com/CODER7657/globetrotter/issues/13) (plus [#14](https://github.com/CODER7657/globetrotter/issues/14), which it depends on)
**Date:** 2026-08-22
**Owner:** @ayush

## Goal

A layered Fastify + TypeScript modular monolith that every other backend issue
(#15–#23) can be built into without rework, proven end-to-end against a real
Postgres.

## Scope

In scope: monorepo, `packages/contracts`, the `apps/api` skeleton, a
provisional schema, and an integration test that exercises all three layers.

Out of scope, deliberately: auth (#15), the full trips API (#17), search (#19),
sharing (#20), admin (#21), observability (#22). Each has a seam waiting for it.

## Layering

```
apps/api/src/modules/<domain>/
  <domain>.routes.ts      HTTP only — parse, delegate, choose a status
  <domain>.service.ts     business rules, transaction boundaries
  <domain>.repository.ts  SQL only — takes a Tx, returns rows
  <domain>.schema.ts      re-export from packages/contracts
```

Direction of allowed imports: `routes → service → repository → db`. Never
upward, never skipping a layer.

This is enforced by `eslint-plugin-boundaries`, and the enforcement is
**verified** — a deliberate `routes → repository` import was introduced and
confirmed to fail lint with `routes must not import repository — see issue #13`.

One trap worth recording: NodeNext requires relative imports to end in `.js`
while the file on disk is `.ts`. Without `eslint-import-resolver-typescript`,
the plugin cannot resolve a single import, classifies every dependency as
"unknown", and the layering rules pass vacuously. The rules looked correct and
enforced nothing.

## packages/contracts

One Zod schema per request and response, consumed by both sides:

- the API derives Fastify validation and serialisation from it,
- the frontend derives form resolvers from it,
- so client and server validation cannot disagree.

Branded IDs (`TripId`, `UserId`, `StopId`, …) are UUID strings at runtime and
distinct types at compile time, which makes passing a `TripId` where a `StopId`
belongs a build error.

Money is a decimal **string** (`{ amount, currency }`), never a float, matching
`NUMERIC(12,2) + CHAR(3)` in the database.

## Data access

Kysely, not Prisma — the SQL is the graded artifact and hiding it defeats the
purpose. Every service goes through:

```ts
withTx(userId, async (trx) => { ... })
```

which opens a transaction and publishes the caller's identity to Postgres as
`app.user_id` for that transaction only (`set_config(..., true)`, so a pooled
connection never leaks one request's identity into the next). RLS policies read
it via `current_app_user_id()`.

Querying `app.db` directly from a service bypasses RLS and is a review-blocking
mistake.

## Authorization lives in the database

RLS policies on `trips`, `trip_stops`, `trip_activities` are the authorization
layer; there is no middleware `if` that can be forgotten.

**The finding that shaped this design:** the first run of the cross-user
isolation test returned `200` where `404` was expected — user B could read user
A's private trip. Every policy was correct. The connection was not: RLS is
silently bypassed for superusers, and `POSTGRES_USER` is a superuser, so
`ENABLE`/`FORCE ROW LEVEL SECURITY` bought nothing.

Fix: migration `0002_app_role` creates `globetrotter_app` —
`NOSUPERUSER NOBYPASSRLS`, owner of no table — and the API connects as it.
Migrations and test fixtures use the owner connection via a separate
`ADMIN_DATABASE_URL`.

This is the kind of hole that ships silently. It was caught only because the
integration test ran against real Postgres rather than a mocked query layer.

## Error model

One `AppError` hierarchy serialised as RFC 9457 `application/problem+json`.
Every response carries `traceId`, and every log line for that request carries
the same `traceId` (via `childLoggerFactory`) — verified against a live server.

Postgres SQLSTATE codes are translated, never leaked: `23505 → 409 DUPLICATE`,
`23P01 → 409 OVERLAP`, `23503 → 422 FK_VIOLATION`, `23514 → 422
VALIDATION_FAILED`. In production a 5xx `detail` is always the generic string.

`NOT_FOUND` is returned rather than `FORBIDDEN` for a trip the caller may not
see — with RLS the row simply is not there, and 404 avoids confirming that a
private trip exists.

## Provisional schema

`0001_bootstrap` creates only what the skeleton needs: `users`,
`refresh_token_families`, `cities`, `activities`, `trips`, `trip_stops`,
`trip_activities`.

**It is superseded wholesale by [#1](https://github.com/CODER7657/globetrotter/issues/1).**
Conventions match #1 exactly — `uuidv7()` PKs, `citext` email, `TIMESTAMPTZ`,
`NUMERIC(12,2)` money, native enums, `CHECK` on bounded values, a covering
index on every FK, `COMMENT ON` every table — so the swap is mechanical.

Both migrations have a `down`, and the full down → up cycle is tested.

## Seams left for later issues

| Issue | Seam |
|---|---|
| #15 auth | `core/identity.ts` — `requireUserId()`. Currently reads an `x-user-id` header and **throws unconditionally when `NODE_ENV=production`**, so the bypass cannot ship by accident. |
| #17 trips API | `trips.repository.ts` — `version` column and `ETag` already carry the optimistic-concurrency token; `trip_stops_position_unique` is `DEFERRABLE` so a whole-list reorder fits in one transaction. |
| #18 security | helmet CSP, CORS allowlist, rate limits, and a 1 MiB body cap are wired; per-route budgets and CSRF remain. |
| #22 observability | `/health` and `/ready` are already separated; pino with secret redaction is configured. OpenTelemetry and `/metrics` remain. |
| #23 tests | `fastify.inject()` harness and a real-Postgres integration suite exist; coverage gate configured at 70%. |

## Verification

| Check | Result |
|---|---|
| `eslint .` | clean; layering violation confirmed to fail |
| `tsc -b` + test typecheck | clean, strict + `noUncheckedIndexedAccess` |
| `vitest run` | 8/8 passing |
| migrations down → up | both revert and reapply cleanly |
| live server | `/health` 200, `/ready` 200, unknown route → problem+json with matching `traceId` |

Not verified: SIGTERM-triggered graceful shutdown. The handlers are wired and
`app.close()` is exercised by test teardown, but Node's signal emulation on
Windows meant the signal path could not be confirmed locally. It should be
re-checked in the Linux container under #9.
