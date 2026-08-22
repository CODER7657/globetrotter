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
apps/api                  Fastify 5 modular monolith (issue #13)
apps/web                  Vite + React 19 + TanStack Router app shell (issue #25)
packages/contracts        Zod schemas shared by client and server (issue #14)
packages/design-system    Design tokens, generated theme.css, contrast gate (issue #24)
db/                       Schema, migrations and seeds — owned per #42
docs/                     Design docs and ADRs
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

## Design system

**[Figma — GlobeTrotter Design System](https://www.figma.com/design/vRN4zO5BcDW4G1KErsxbBB)**
· **[docs/DESIGN.md](docs/DESIGN.md)** · **`/kitchen-sink`** in the running app

`packages/design-system/tokens.json` is the single source of truth. It generates
`theme.css` (the Tailwind v4 `@theme` block plus the `:root` and `.dark` layers),
a Tailwind preset, Tokens Studio JSON for Figma, and token name union types.

The Figma file carries the same values as variables — 32 semantic colours per
theme plus the spacing, type and radius scales — so design and code read from one
set of numbers rather than two that drift.

Contrast is enforced as a test, not a promise:

```bash
pnpm --filter @globetrotter/design-system test
```

216 assertions across both themes. Text pairs are gated at 4.5:1, `--input` and
`--ring` at 3:1, chart series at 3:1, and every colour is checked for sRGB gamut.
A token that fails fails the build, so `pnpm test` and CI inherit the gate.

Two decisions that look like inconsistencies and are not, both recorded in
[ADR 0003](docs/adr/0003-design-tokens.md):

- **`--ring` is not `--primary` in light mode.** The sunset accent at `L 0.70`
  reaches only 2.84:1 on white, below the 3:1 focus indicators require.
- **`--border` and `--input` differ.** WCAG 1.4.11 exempts a decorative card edge
  but not a form field boundary, which is what identifies the control.

## Architecture

- [Backend skeleton](docs/superpowers/specs/2026-08-22-backend-skeleton-design.md)
  — layering rules, the error model, and the seams left for later issues.
- [Design system + token pipeline](docs/superpowers/specs/2026-08-22-design-system-design.md)
  — the three-layer token model, the shadcn/ui contract pin, and the contrast gate.
