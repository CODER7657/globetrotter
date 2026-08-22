# GlobeTrotter Design System

One token source. Two themes. Every colour pair machine-verified.

Everything visual in this product comes from `packages/design-system/tokens.json`.
If you are about to write a colour, a spacing value or a duration by hand, stop —
it belongs in the token file.

---

## The rule

```
primitive   --gt-slate-900, --gt-space-4, --gt-text-lg   generated; never used by components
semantic    --background, --primary, --border            what you write in components
component   --btn-primary-bg, --card-radius              only when a component needs its own knob
```

**Components reference semantic tokens only.** Never a primitive, never a raw hex.

Primitives carry the `--gt-` prefix so a stray reference is greppable in review:

```bash
grep -rn -- '--gt-' apps/web/src/components
```

Any hit in a component is a bug.

## Using it

```ts
// once, at the app entry — before any other stylesheet
import '@globetrotter/design-system/theme.css'
```

Then write Tailwind classes as normal. `bg-background`, `text-muted-foreground`,
`border-input`, `ring-ring` all resolve through the tokens.

Dark mode is a `.dark` class on `<html>` — the shadcn/Tailwind v4 convention.
The toggle lives in the app shell (#25).

## Semantic tokens

Names are **shadcn/ui's contract**, verified against `shadcn-ui/ui@main` on
2026-08-22. Renaming any of them breaks every shadcn component we install.

| Token | Light | Dark | Measured |
|---|---|---|---|
| `background` | `oklch(1 0 0)` | `oklch(0.19 0.02 260)` | — |
| `foreground` | `oklch(0.21 0.02 260)` | `oklch(0.97 0.01 260)` | 17.72 / 16.94 |
| `card`, `popover` | `oklch(1 0 0)` | `oklch(0.23 0.02 260)` | 17.72 / 15.49 |
| `primary` | `oklch(0.70 0.17 45)` | `oklch(0.75 0.16 55)` | 6.23 / 7.93 |
| `secondary`, `muted` | `oklch(0.97 0.01 260)` | `oklch(0.28 0.02 260)` | 13.39 / 13.38 |
| `muted-foreground` | `oklch(0.54 0.02 260)` | `oklch(0.71 0.02 260)` | 4.64 / 5.67 |
| `accent` | `oklch(0.96 0.01 260)` | `oklch(0.30 0.02 260)` | 13.00 / 12.50 |
| `destructive` | `oklch(0.55 0.20 27)` | `oklch(0.65 0.20 25)` | 5.05 / 5.19 |
| `border` | `oklch(0.92 0.01 260)` | `oklch(0.32 0.02 260)` | advisory |
| `input` | `oklch(0.65 0.02 260)` | `oklch(0.50 0.02 260)` | 3.23 / 3.08 |
| `ring` | `oklch(0.66 0.17 45)` | `oklch(0.75 0.16 55)` | 3.32 / 7.93 |

Plus `chart-1`…`chart-5` and the eight `sidebar-*` tokens. All 32 in both themes.

### Three things that look like mistakes and are not

**`--accent` is not the brand accent.** In shadcn's vocabulary `--accent` is the
muted hover/active surface — a near-grey. Our sunset brand colour is
**`--primary`**. Hero CTAs, the active nav item and focus rings all come from
`--primary`. Reach for `--accent` expecting sunset and you will get grey.

**`--ring` is not `--primary` in light mode.** Sunset at `L 0.70` scores 2.84:1
on white; focus indicators need 3:1 (WCAG 2.4.11). The light ring is a darker
`L 0.66`. In dark mode the two coincide legitimately. Never write
`--ring: var(--primary)` — a test fails if you do.

**`--border` and `--input` diverge.** shadcn ships both at the same subtle value.
That is right for a decorative card edge, which WCAG 1.4.11 exempts, and wrong
for a form field, whose boundary is what identifies the control. `--input` is
gated at 3:1; `--border` is reported but not gated.

## Scales

**Type** — 1.250 major third on a 16px base:

| | `sm` | `base` | `lg` | `xl` | `2xl` | `3xl` | `4xl` | `5xl` |
|---|---|---|---|---|---|---|---|---|
| px | 12.8 | 16 | 20 | 25 | 31.25 | 39.06 | 48.83 | 61.04 |

Line heights: `1.1` display · `1.3` headings · `1.5` body · `1.65` long-form.
The ramp stops at `sm` — below it the ratio is too tight to be useful, and an
`xs` step invites 10px UI text that fails legibility.

**Fonts** — Fraunces (display), Inter (UI, tabular figures for cost tables),
JetBrains Mono (currency, codes). Self-hosted, never CDN-linked: #31 is
offline-first. Every stack has a real system fallback.

**Spacing** — 4pt grid: `4 8 12 16 20 24 32 40 48 64 80 96`. There is no 2px
half-step on purpose. Once a half-step exists it gets used, and the grid stops
meaning anything.

**Radius** — one scale from `--radius: 0.75rem`, with `sm/md/lg/xl` derived by
multiplier so shadcn components inherit correctly.

**Shadow** — five steps, tinted with the midnight neutral rather than pure black
so elevation stays in the same colour family as the surfaces.

**Motion** — durations `150 / 250 / 400ms`. Easings: `out`
`cubic-bezier(0.16, 1, 0.3, 1)` for entrances, `in-out`
`cubic-bezier(0.65, 0, 0.35, 1)` for transitions, `spring`
`cubic-bezier(0.34, 1.56, 0.64, 1)` for overshoot.

`prefers-reduced-motion: reduce` collapses all three durations to `1ms` **at the
token layer**, so honouring it is the default rather than something each
animation has to remember.

## Adding or changing a token

1. Edit `packages/design-system/tokens.json`. Primitives hold literals; semantics
   hold `{primitive.…}` aliases and nothing else.
2. `pnpm --filter @globetrotter/design-system test` — the gate runs.
3. `pnpm --filter @globetrotter/design-system build` — regenerates `dist/`.

**Never hand-edit anything in `dist/`.** It is generated and gitignored.

If the gate fails, solve for a compliant value rather than eyeballing one:

```bash
node -e "
const m = await import('./packages/design-system/dist/color.js');
for (let L = 0.95; L >= 0.05; L -= 0.005) {
  const r = m.contrastRatio({l:L, c:0.02, h:260}, {l:1, c:0, h:0});
  if (r >= 4.5) { console.log('max L =', L.toFixed(3), 'ratio', r.toFixed(2)); break }
}"
```

## What the gate checks

| Pair class | Threshold |
|---|---|
| Text on its surface | 4.5:1 (WCAG 1.4.3 AA) |
| `input`, `ring` against their surfaces | 3:1 (1.4.11, 2.4.11) |
| Chart series against the background | 3:1 |
| `border` against its surface | reported, not gated |
| Every colour token | inside sRGB gamut |

216 assertions, both themes, run under `pnpm -r test` — so CI has it without
extra wiring, and #32's accessibility pass inherits the result rather than
redoing the work.

## Every UI PR

- Screenshot or a 5-second recording in the PR body
- Loading, empty, error and success states all implemented
- Keyboard-only walkthrough confirmed
- Zero inline hex — tokens only
- No `any`
