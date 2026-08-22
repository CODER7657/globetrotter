# ADR 0003 — Design tokens as a generated, contrast-gated pipeline

**Status:** Accepted · **Date:** 2026-08-22 · **Issue:** #24

## Context

Three people build UI against one visual language: two frontend developers and
every shadcn/ui component we install. The repo had no frontend code when this was
decided, so the choice was open — and getting it wrong meant three palettes, three
spacing rhythms, and a rewrite during the accessibility pass (#32).

Odoo scores *"consistent color schemes and layout"* by name, so consistency is a
graded line item rather than housekeeping.

## Decision

**One `tokens.json`, three layers.** Primitives hold literal OKLCH and rem values
under a `--gt-` prefix. Semantics hold `{primitive.…}` aliases and nothing else.
Component tokens exist only where a component needs its own knob. The prefix makes
a stray primitive reference greppable, which is what turns the layering rule into
something reviewable.

**Semantic names are shadcn/ui's contract, pinned and dated.** Verified against
`shadcn-ui/ui@main` on 2026-08-22. We do not invent names. A future shadcn change
is a deliberate migration, not a silent drift — and the pin is what makes that
detectable.

**Contrast is a vitest test, not a script.** The root `package.json` already runs
`pnpm -r test`, so the gate joins the workspace test run automatically and CI (#10)
inherits it with no extra wiring. A script depends on someone remembering to call
it; a test does not.

**`--border` and `--input` carry different values.** shadcn ships both at the same
subtle value. WCAG 1.4.11 exempts decorative card edges but not the boundary of a
form field, which is what identifies the control. `--input` is gated at 3:1;
`--border` is reported only. #26 is explicitly a graded exhibit.

**`--ring` is independent of `--primary`.** The original reason was contrast: the
sunset accent then used for `--primary` fell below the 3:1 focus indicators
require (WCAG 2.4.11). The Velorah palette (#62) made `--primary` monochrome,
which retires that specific number but strengthens the rule — *a focus ring the
same colour as the button it sits on is invisible on that button.* With
`--primary` at the extremes of the neutral ramp, a matching ring would vanish on
every primary button. `--ring` therefore stays on `sunset` in both themes: in a
monochrome system a hue nothing else uses is an accessibility affordance rather
than decoration. `layering.test.ts` fails if the two are ever set equal.

**Tailwind v4 `@theme` is the real artifact; the JS preset is secondary.** #24 asks
for a generated `tailwind.config.ts` while its own toolbox specifies Tailwind v4,
where that file is the legacy v3 mechanism. Emitting both — the `@theme` block as
the artifact the app consumes, a thin preset for JS access — satisfies the
requirement without pretending we are on v3.

**`dist/` is generated and gitignored.** Committing it would mean every token change
produces two diffs that drift apart.

## Consequences

**Good.** One source of truth for both frontend developers and Figma. Contrast
failures surface at commit time rather than during the pre-submission audit — the
gate caught five failures in the first palette draft, including a focus ring below
the 3:1 minimum, and later caught a chart colour authored outside sRGB. #32
inherits a verified baseline instead of re-auditing from scratch.

**Costs.** We own ~400 lines of generator and colour maths instead of taking a
dependency on Style Dictionary. Accepted because the output stays legible — a
reviewer can read the whole pipeline — and because Style Dictionary's config DSL
would have cost more setup than the code it replaced.

Consumers must run a build before importing the package. Mitigated by the workspace
`test` script, which already runs `pnpm -r build` first.

**Rejected alternatives.** Style Dictionary — more setup, opaque output. Pure
Tailwind v4 `@theme` with no build step — no single JSON source, so the Figma sync
that motivates the whole exercise would have nothing to sync from.
