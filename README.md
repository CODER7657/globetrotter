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

The API listens on <http://127.0.0.1:3000>. Check it is alive:

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

## Architecture

See [the backend skeleton design](docs/superpowers/specs/2026-08-22-backend-skeleton-design.md)
for the layering rules, the error model, and what is deliberately left as a
seam for later issues.
