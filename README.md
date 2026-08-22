# globetrotter
GlobeTrotter — a Postgres-native, offline-first multi-city travel planner. Odoo Hackathon '26.

## Quickstart

Requires Node 22.12+ and Docker.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

`pnpm db:up` starts Postgres 18, MailHog and the one-shot migrate container,
which applies `db/migrations` and seeds reference data. The API then listens on
<http://127.0.0.1:3000>; MailHog's inbox is at <http://127.0.0.1:8025>.

```bash
curl http://127.0.0.1:3000/ready
```

## Layout

```
apps/api             Fastify 5 modular monolith (issue #13)
packages/contracts   Zod schemas shared by client and server (issue #14)
db/                  Schema, migrations and seeds — owned per #42
docs/                Design docs and ADRs
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the API with reload |
| `pnpm build` | Build all workspace packages |
| `pnpm typecheck` | Strict typecheck, including tests |
| `pnpm lint` | ESLint, including the layering rules |
| `pnpm test` | Vitest against a real Postgres |
| `pnpm db:up` | Start the stack and apply migrations |
| `pnpm db:migrate` | Re-run the migrate container |
| `pnpm db:status` | Show applied and pending migrations |

## Two database roles, on purpose

The API connects as `globetrotter_app` (`NOSUPERUSER NOBYPASSRLS`) via
`APP_DATABASE_URL`, so Row-Level Security actually applies — a superuser
connection bypasses every RLS policy silently, which makes the whole
authorization layer a no-op. Migrations and test fixtures use the superuser in
`DATABASE_URL`.

## API layering

```
apps/api/src/modules/<domain>/
  <domain>.routes.ts      HTTP only
  <domain>.service.ts     business rules, transactions
  <domain>.repository.ts  SQL only
  <domain>.schema.ts      re-export from packages/contracts
```

`routes → service → repository → db`, never upward and never skipping, enforced
by `eslint-plugin-boundaries`.

## Architecture

- [Backend skeleton](docs/superpowers/specs/2026-08-22-backend-skeleton-design.md)
  — layering rules, the error model, and the seams left for later issues.
