# Design system + token pipeline — design

**Issue:** #24 · **Owner:** @Hem60 · **Date:** 2026-08-22 · **Status:** approved, pre-implementation

## 1. Context

The frontend has no code on the repo. Three consumers share one visual language: @Hem60
(#25–#32), @harshpansuriya71-sudo (#33–#40), and every shadcn component we install. Without a
single token source we get three palettes, three spacing rhythms, and a rewrite during the
accessibility pass (#32).

Odoo scores *"consistent color schemes and layout"* by name, so consistency here is a graded
line item, not housekeeping.

The token **contract** (variable names) was published on #24 before implementation so the
`apps/web` scaffold could proceed in parallel without a merge conflict. This spec defines the
**values and the machinery** behind that contract.

## 2. Scope

**In:** `packages/design-system` — `tokens.json`, generator, contrast gate, generated
`theme.css` / Tailwind preset / Figma JSON / type declarations, `DESIGN.md`, ADR.

**Out, deliberately:**

- The monorepo root — `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `eslint.config.js` already exist. This package conforms; it does not redefine them.
- `apps/web` scaffold — owned by @harshpansuriya71-sudo.
- `/kitchen-sink` route and the README Figma link — both need `apps/web` to exist. They ship as
  a small follow-up PR, and #24 does not close until they land.
- Component implementations. #24 defines the system; components arrive with the screens.

## 3. Package architecture

```
packages/design-system/
├── package.json          @globetrotter/design-system
├── tsconfig.json         extends ../../tsconfig.base.json + DOM libs
├── tokens.json           single source of truth (DTCG-shaped)
├── scripts/
│   ├── build-tokens.ts   tokens.json -> dist/*
│   └── contrast.ts       OKLCH -> sRGB -> WCAG, pure functions
├── src/
│   ├── index.ts          typed re-exports
│   ├── contrast.test.ts  the accessibility gate
│   └── build.test.ts     generator output assertions
└── dist/                 generated, gitignored
    ├── theme.css         <- the single artifact apps/web imports
    ├── tailwind.preset.ts
    ├── tokens.figma.json
    └── tokens.d.ts
```

Data flows one direction. No loops, no round-tripping through CSS:

```
tokens.json ──► build-tokens.ts ──► theme.css + preset + figma.json + tokens.d.ts
     └────────► contrast.test.ts ──► non-zero exit below threshold
```

### Conventions inherited from the workspace

| Concern | Value | Source |
|---|---|---|
| Package manager | pnpm 9.15.0 | root `package.json` |
| Node | >= 22.12.0 | root `engines` |
| Naming | `@globetrotter/<name>` | `packages/contracts` |
| Build | `tsc -b`, project references, `composite: true` | `tsconfig.base.json` |
| Scripts | `build`, `typecheck`, `test` | root `pnpm -r` scripts |
| Test runner | vitest ^2.1.8 | `packages/contracts` |
| Modules | ESM, `verbatimModuleSyntax`, `NodeNext` | `tsconfig.base.json` |

**Required local override:** `tsconfig.base.json` declares `lib: ["ES2023"]` with no `DOM`. This
package's `tsconfig.json` sets `"lib": ["ES2023", "DOM", "DOM.Iterable"]`.

**One shared file is touched:** root `tsconfig.json` gains
`{ "path": "./packages/design-system" }` in `references`. One line, and the only place this work
overlaps anyone else's.

## 4. Token architecture — three layers

```
primitive   --gt-slate-900, --gt-space-4, --gt-text-lg   generated; never referenced by components
semantic    --background, --primary, --border            what components use
component   --btn-primary-bg, --card-radius              only when a component needs its own knob
```

Primitives carry a `--gt-` prefix so a stray primitive reference inside a component is a
one-command grep in review. That turns "components reference semantic only" from a convention
into something checkable.

Semantic names are **shadcn/ui's contract**, verified against `shadcn-ui/ui@main` on 2026-08-22.
Renaming any of them breaks every shadcn component, and #25–#30 all sit on shadcn.

Dark mode is a `.dark` class on `<html>` — the shadcn/Tailwind v4 convention — not
`[data-theme]`. The toggle itself belongs to #25.

## 5. Palette

Authored in OKLCH for perceptually even ramps, and because Tailwind v4 and shadcn both emit
OKLCH. Every value verified inside sRGB gamut.

### Light

| Token | OKLCH | Paired with | Ratio |
|---|---|---|---|
| `--background` | `1 0 0` | `--foreground` `0.21 0.02 260` | 17.72:1 |
| `--card` / `--popover` | `1 0 0` | their foregrounds | 17.72:1 |
| `--primary` | `0.70 0.17 45` | `--primary-foreground` `0.21 0.02 260` | 6.23:1 |
| `--secondary` | `0.97 0.01 260` | `0.28 0.03 260` | 13.39:1 |
| `--muted` | `0.97 0.01 260` | `--muted-foreground` `0.54 0.02 260` | 4.64:1 |
| `--accent` | `0.96 0.01 260` | `0.28 0.03 260` | 13.00:1 |
| `--destructive` | `0.55 0.20 27` | `0.98 0.01 17` | 5.05:1 |
| `--input` | `0.65 0.02 260` | on background | 3.23:1 |
| `--ring` | `0.66 0.17 45` | on background | 3.32:1 |
| `--border` | `0.92 0.01 260` | decorative | 1.27:1 (advisory) |

### Dark

| Token | OKLCH | Paired with | Ratio |
|---|---|---|---|
| `--background` | `0.19 0.02 260` | `--foreground` `0.97 0.01 260` | 16.94:1 |
| `--card` / `--popover` | `0.23 0.02 260` | their foregrounds | 15.49:1 |
| `--primary` | `0.75 0.16 55` | `--primary-foreground` `0.19 0.02 260` | 7.93:1 |
| `--secondary` | `0.28 0.02 260` | `0.97 0.01 260` | 13.38:1 |
| `--muted` | `0.28 0.02 260` | `--muted-foreground` `0.71 0.02 260` | 5.67:1 |
| `--accent` | `0.30 0.02 260` | `0.97 0.01 260` | 12.50:1 |
| `--destructive` | `0.65 0.20 25` | `0.19 0.02 260` | 5.19:1 |
| `--input` | `0.50 0.02 260` | on background | 3.08:1 |
| `--ring` | `0.75 0.16 55` | on background | 7.93:1 |
| `--border` | `0.32 0.02 260` | decorative | 1.46:1 (advisory) |

### Two decisions that look like inconsistencies and are not

**`--ring` is not `--primary` in light mode.** Sunset at `L 0.70` reaches only 2.84:1 on white;
focus indicators require 3:1 (WCAG 2.4.11). The light ring is a darker `L 0.66`. In dark mode the
two coincide legitimately. Nothing may write `--ring: var(--primary)`.

**`--border` and `--input` diverge.** shadcn ships both at the same subtle value. That is correct
for a decorative card edge, which WCAG 1.4.11 exempts, and wrong for a form field, whose boundary
is what identifies the control. `--input` is gated at 3:1; `--border` is advisory. #26 is
explicitly a graded exhibit, so this matters.

**One accent, plus status colours.** #24 requires exactly one accent — that is `--primary`
(sunset), and it is the only brand hue. Status colours (success, warning, destructive) are
functional signals rather than accents: #25 needs them for toasts, #30 for over-budget days.
Charts get their own `--chart-1…5` sequential ramp instead of reusing brand hues; #30 loads the
`dataviz` skill before writing chart code.

The tables above cover the shadcn contract only. Status and chart values are derived during
implementation and are **not yet verified** — they enter `tokens.json` through the same gate in
§7, and any that fail get solved for rather than hand-tuned, exactly as the contract palette was.

## 6. Scales

**Type — 1.250 major third, 16px base:** `12.8 · 16 · 20 · 25 · 31.25 · 39.06 · 48.83 · 61.04px`
(`sm` through `5xl`). The ramp stops at `sm`; below it the ratio is too tight to be useful, and an
`xs` step invites 10px UI text that fails legibility.

Line heights: `1.1` display · `1.3` headings · `1.5` body · `1.65` long-form.

**Fonts:** `--gt-font-display` Fraunces (warm editorial serif — landing hero and page titles),
`--gt-font-sans` Inter (all UI; has tabular figures for cost tables), `--gt-font-mono` JetBrains
Mono (currency, codes). Every stack carries a real system fallback so a blocked font request never
yields invisible text.

**Spacing — 4pt grid:** `4 8 12 16 20 24 32 40 48 64 80 96`. No 2px half-step: once a half-step
exists it gets used, and the grid stops meaning anything.

**Radius — one scale from `--radius: 0.75rem`**, with `sm/md/lg/xl` derived by multiplier, matching
shadcn's v4 convention so its components inherit correctly. 12px reads rounded, not bubbly.

**Shadow — five steps**, tinted with the midnight neutral rather than pure black, so elevation
stays in the same colour family as the surfaces.

**Motion — one language:** durations `150 / 250 / 400ms`; easings `ease-out`
`cubic-bezier(0.16, 1, 0.3, 1)` for entrances, `ease-in-out` `cubic-bezier(0.65, 0, 0.35, 1)` for
transitions, `ease-spring` `cubic-bezier(0.34, 1.56, 0.64, 1)` for playful overshoot. A
`prefers-reduced-motion: reduce` block collapses every duration to `1ms` at the token layer, so
honouring the preference is the default rather than something each animation must remember.

#24 defines this vocabulary; applying it across screens is #40.

## 7. Contrast policy and the gate

| Pair class | Threshold | Enforcement |
|---|---|---|
| Body text on its surface | 4.5:1 (WCAG 1.4.3 AA) | gated |
| Foreground/background semantic pairs | 4.5:1 | gated |
| `--input`, `--ring` against their surfaces | 3:1 (1.4.11, 2.4.11) | gated |
| `--border` against its surface | — | reported, not gated |
| sRGB gamut for every colour token | in-gamut | gated |

The gate is a **vitest test**, not a standalone script. The root `package.json` already runs
`pnpm -r test`, so contrast verification joins the workspace test run automatically and CI (#10)
inherits it with no extra wiring. A script would depend on someone remembering to call it.

This is also what makes #24's "audited for contrast" and #32's "contrast >= 4.5:1, verified not
assumed" the same enforced fact rather than two manual passes.

The policy is already load-bearing: the first draft of this palette had five failures, including a
focus ring below the 3:1 minimum. The checker caught them before they reached the repo.

## 8. Generated artifacts

| File | Consumer | Purpose |
|---|---|---|
| `dist/theme.css` | `apps/web` | `@theme inline` mapping + `:root` / `.dark` semantic layers |
| `dist/tailwind.preset.ts` | anything needing JS token access | satisfies #24's `tailwind.config.ts` line without pretending we are on v3 |
| `dist/tokens.figma.json` | Figma MCP | Tokens Studio format; the code-to-Figma push |
| `dist/tokens.d.ts` | all TS consumers | union types of every token name — upholds "no `any`" with autocomplete |

`dist/` is generated and gitignored (root `.gitignore` already covers `dist/`). Committing it would
mean every token change produces two diffs that drift apart. A `prepare` script builds it on
`pnpm install` so consumers never meet a missing import.

**Tailwind v4 note:** v4 is CSS-first via `@theme`; `tailwind.config.ts` is the v3 mechanism. #24
asks for the latter while its own toolbox specifies v4. We emit the v4 `@theme` block as the real
artifact and a thin JS preset alongside it, which satisfies both without shipping a lie.

## 9. Testing

Test-first, using the vitest setup the repo already established.

- `contrast.test.ts` — every gated pair in both themes, plus sRGB gamut on every colour token.
  Table-driven, so adding a token adds a case.
- `build.test.ts` — generator emits all four artifacts; every shadcn contract variable is present
  in both themes; no semantic value is a raw hex; no primitive is referenced from a semantic
  definition outside the intended mapping.
- `contrast.ts` pure functions unit-tested against known reference values, so a broken colour-space
  conversion cannot silently pass the gate.

## 10. Risks

| Risk | Mitigation |
|---|---|
| `apps/web` scaffold picks different variable names | contract posted on #24 ahead of the scaffold, with a drop-in shim using final names |
| Root `tsconfig.json` reference conflicts | one line; whoever merges second adds theirs |
| ADR number collision | `0001` and `0002` are taken, so this is `0003` |
| Fraunces/Inter unavailable offline (#31 is offline-first) | fonts self-hosted in `apps/web`, never CDN-linked; system fallbacks on every stack |
| shadcn changes its variable contract | the contract is pinned and dated here; a future bump is a deliberate migration |

## 11. #24 deliverables mapped

| Issue checkbox | Where |
|---|---|
| `tokens.json` + generated Tailwind config + CSS custom properties | §3, §8 |
| Dark and light theme, both audited for contrast | §5, §7 |
| Type scale, 4pt spacing grid, one radius scale | §6 |
| Exactly one accent colour, one motion language | §5, §6 |
| `/docs/DESIGN.md` with the rules | ships in this PR |
| Storybook or `/kitchen-sink` route | follow-up PR — needs `apps/web` |
| Figma link committed to the README | follow-up PR — needs the file to exist |

ADR: `docs/adr/0003-design-tokens.md` records the three-layer architecture, the shadcn contract
pin, and the border/input divergence.
