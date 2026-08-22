# globetrotter

GlobeTrotter — a Postgres-native, offline-first multi-city travel planner. Odoo Hackathon '26.

## Quickstart

Requires Node 22.12+ and Docker.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

The API listens on <http://127.0.0.1:3000>, and MailHog's inbox is at
<http://127.0.0.1:8025>. Check the API is alive:

```bash
curl http://127.0.0.1:3000/ready
```

## Layout

```
apps/api             Fastify 5 modular monolith (issue #13)
packages/contracts   Zod schemas shared by client and server (issue #14)
db/migrations        Hand-written SQL, up and down (issue #1)
scripts/migrate.mjs  Migration runner — no ORM auto-migrate
docs/                Design docs
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the API with reload |
| `pnpm build` | Build all workspace packages |
| `pnpm typecheck` | Strict typecheck, including tests |
| `pnpm lint` | ESLint, including the layering rules |
| `pnpm test` | Vitest against a real Postgres |
| `pnpm db:up` | Start Postgres in Docker |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:rollback` | Revert the most recent migration |
| `pnpm db:status` | Show applied and pending migrations |

## Two database roles, on purpose

The API connects as `globetrotter_app` (`NOSUPERUSER NOBYPASSRLS`) so that
Row-Level Security actually applies — a superuser connection bypasses every RLS
policy silently, which makes the whole authorization layer a no-op. Migrations
and test fixtures use the owner connection via `ADMIN_DATABASE_URL`.

## Auth

Access tokens are short-lived JWTs sent as `Authorization: Bearer`. The refresh
token lives only in an `httpOnly` cookie and is rotated on every use — if a
rotated token is ever presented again, the entire token family is revoked, on
the assumption that it leaked.

```bash
curl -X POST http://127.0.0.1:3000/api/v1/auth/signup -H 'content-type: application/json' -d '{"email":"you@example.test","password":"correct-horse-battery-staple-72","displayName":"You"}'
```

## Architecture

- [Backend skeleton](docs/superpowers/specs/2026-08-22-backend-skeleton-design.md)
  — layering rules, error model, and the seams left for later issues.
- [Auth](docs/superpowers/specs/2026-08-22-auth-design.md) — token design,
  rotation and replay handling, and why login is timing-safe.
