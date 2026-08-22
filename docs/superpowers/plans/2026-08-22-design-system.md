# Design System + Token Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@globetrotter/design-system` — one `tokens.json` that generates `theme.css`, a Tailwind preset, Figma JSON and type declarations, with WCAG contrast enforced as a test.

**Architecture:** A dependency-free TypeScript generator reads a DTCG-shaped `tokens.json` with two groups: `primitive` (literal OKLCH/rem values) and `semantic` (aliases only, matching shadcn/ui's variable contract). Pure colour-maths functions convert OKLCH → sRGB → WCAG relative luminance so a vitest gate can fail the build on any pair below threshold. Compiled with `tsc -b` to `dist/`, then `node dist/build.js` writes the artifacts beside it.

**Tech Stack:** TypeScript 5.7 (ESM, `NodeNext`), vitest 2.1, Node ≥ 22.12, pnpm 9.15. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-design-system-design.md`

## Global Constraints

- Package name `@globetrotter/design-system`; version `0.1.0`; `"private": true`; `"type": "module"`.
- Extends `../../tsconfig.base.json`. It sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, `composite`, `declaration`, `module: NodeNext`.
- **`noPropertyAccessFromIndexSignature` is on:** read parsed-JSON members with `obj['key']`, never `obj.key`.
- **`noUncheckedIndexedAccess` is on:** every array/record index yields `T | undefined`. Narrow before use; never `!`.
- **`verbatimModuleSyntax` is on:** type-only imports must be `import type { X } from '...'`.
- **ESM + `NodeNext`:** every relative import needs an explicit `.js` extension, even from a `.ts` file.
- `tsconfig.base.json` has `lib: ["ES2023"]` with no DOM. This package sets `"lib": ["ES2023", "DOM", "DOM.Iterable"]`.
- Zero runtime dependencies. devDependencies only: `typescript ^5.7.2`, `vitest ^2.1.8`, `@types/node ^22.10.2` — matching versions already in the workspace.
- Semantic tokens are **aliases only**. A literal value in `semantic` is a test failure.
- Contrast thresholds: text pairs ≥ 4.5:1; `--input` and `--ring` vs their surfaces ≥ 3:1; `--border` reported, not gated; every colour token must be inside sRGB gamut.
- Never write `--ring: var(--primary)`. They differ per theme by design.
- Commit style: Conventional Commits, `Refs #24` in the body.

---

### Task 1: Package scaffold + colour mathematics

**Files:**
- Create: `packages/design-system/package.json`
- Create: `packages/design-system/tsconfig.json`
- Create: `packages/design-system/tsconfig.test.json`
- Create: `packages/design-system/vitest.config.ts`
- Create: `packages/design-system/src/color.ts`
- Test: `packages/design-system/src/color.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseOklch(input: string): Oklch`, `oklchToSrgb(c: Oklch): Rgb`, `isInGamut(c: Oklch): boolean`, `relativeLuminance(rgb: Rgb): number`, `contrastRatio(a: Oklch, b: Oklch): number`. Types `Oklch = { l: number; c: number; h: number }` and `Rgb = { r: number; g: number; b: number }` (channels 0–1, unclamped from the transform).

- [ ] **Step 1: Write the failing test**

`packages/design-system/src/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio, isInGamut, oklchToSrgb, parseOklch, relativeLuminance } from './color.js'

const WHITE = { l: 1, c: 0, h: 0 }
const BLACK = { l: 0, c: 0, h: 0 }

describe('parseOklch', () => {
  it('parses the oklch() function form', () => {
    expect(parseOklch('oklch(0.70 0.17 45)')).toEqual({ l: 0.7, c: 0.17, h: 45 })
  })

  it('tolerates extra whitespace', () => {
    expect(parseOklch('oklch(  0.19   0.02  260 )')).toEqual({ l: 0.19, c: 0.02, h: 260 })
  })

  it('rejects anything that is not oklch()', () => {
    expect(() => parseOklch('#ff0000')).toThrow(/not an oklch/i)
  })
})

describe('oklchToSrgb', () => {
  it('maps pure white', () => {
    const rgb = oklchToSrgb(WHITE)
    expect(rgb.r).toBeCloseTo(1, 2)
    expect(rgb.g).toBeCloseTo(1, 2)
    expect(rgb.b).toBeCloseTo(1, 2)
  })

  it('maps pure black', () => {
    const rgb = oklchToSrgb(BLACK)
    expect(rgb.r).toBeCloseTo(0, 2)
    expect(rgb.g).toBeCloseTo(0, 2)
    expect(rgb.b).toBeCloseTo(0, 2)
  })

  // sRGB #FF0000 is oklch(62.80% 0.2577 29.23) — a standard reference value.
  it('maps sRGB red from its known OKLCH coordinates', () => {
    const rgb = oklchToSrgb({ l: 0.628, c: 0.2577, h: 29.23 })
    expect(rgb.r).toBeCloseTo(1, 1)
    expect(rgb.g).toBeCloseTo(0, 1)
    expect(rgb.b).toBeCloseTo(0, 1)
  })

  // sRGB #0000FF is oklch(45.2% 0.3132 264.05).
  it('maps sRGB blue from its known OKLCH coordinates', () => {
    const rgb = oklchToSrgb({ l: 0.452, c: 0.3132, h: 264.05 })
    expect(rgb.r).toBeCloseTo(0, 1)
    expect(rgb.g).toBeCloseTo(0, 1)
    expect(rgb.b).toBeCloseTo(1, 1)
  })
})

describe('isInGamut', () => {
  it('accepts a colour inside sRGB', () => {
    expect(isInGamut({ l: 0.7, c: 0.17, h: 45 })).toBe(true)
  })

  it('rejects a chroma no sRGB display can reach', () => {
    expect(isInGamut({ l: 0.9, c: 0.4, h: 140 })).toBe(false)
  })
})

describe('relativeLuminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance(oklchToSrgb(WHITE))).toBeCloseTo(1, 3)
    expect(relativeLuminance(oklchToSrgb(BLACK))).toBeCloseTo(0, 3)
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 1)
  })

  it('is symmetric', () => {
    const a = { l: 0.7, c: 0.17, h: 45 }
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 6)
  })

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 2: Create the package files, then run the test to verify it fails**

`packages/design-system/package.json`:

```json
{
  "name": "@globetrotter/design-system",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./theme.css": "./dist/theme.css",
    "./tokens.json": "./tokens.json"
  },
  "files": ["dist", "tokens.json"],
  "scripts": {
    "build": "tsc -b && node dist/build.js",
    "typecheck": "tsc -b && tsc -p tsconfig.test.json",
    "test": "vitest run",
    "prepare": "pnpm run build"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`packages/design-system/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "rootDir": "./src",
    "outDir": "./dist",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/design-system/tsconfig.test.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

`packages/design-system/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

Run: `pnpm --filter @globetrotter/design-system test`
Expected: FAIL — `Failed to resolve import "./color.js"`.

- [ ] **Step 3: Write the implementation**

`packages/design-system/src/color.ts`:

```ts
export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i

export function parseOklch(input: string): Oklch {
  const match = OKLCH_PATTERN.exec(input.trim())
  if (match === null) {
    throw new Error(`Value is not an oklch() colour: ${input}`)
  }
  const [, l, c, h] = match
  if (l === undefined || c === undefined || h === undefined) {
    throw new Error(`Value is not an oklch() colour: ${input}`)
  }
  return { l: Number(l), c: Number(c), h: Number(h) }
}

/** sRGB gamma transfer function, linear -> encoded. */
function encodeGamma(channel: number): number {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055
}

/** OKLCH -> linear LMS -> linear sRGB -> gamma-encoded sRGB. Channels may fall outside 0..1. */
export function oklchToSrgb(color: Oklch): Rgb {
  const hRad = (color.h * Math.PI) / 180
  const a = color.c * Math.cos(hRad)
  const b = color.c * Math.sin(hRad)

  const lCone = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCone = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCone = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return {
    r: encodeGamma(4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone),
    g: encodeGamma(-1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone),
    b: encodeGamma(-0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone),
  }
}

const GAMUT_TOLERANCE = 0.002

export function isInGamut(color: Oklch): boolean {
  const { r, g, b } = oklchToSrgb(color)
  return [r, g, b].every(
    (channel) => channel >= -GAMUT_TOLERANCE && channel <= 1 + GAMUT_TOLERANCE,
  )
}

/** WCAG 2.1 relative luminance. Channels are clamped, since out-of-gamut values are not displayable. */
export function relativeLuminance(rgb: Rgb): number {
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel))
    return clamped <= 0.03928 ? clamped / 12.92 : Math.pow((clamped + 0.055) / 1.055, 2.4)
  })
  const [r, g, b] = linear
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error('Unreachable: luminance channels are always present')
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const lumA = relativeLuminance(oklchToSrgb(a))
  const lumB = relativeLuminance(oklchToSrgb(b))
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @globetrotter/design-system test`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/design-system
git commit -m "feat(design-system): OKLCH to sRGB colour maths with WCAG contrast

Pure functions, no dependencies, unit-tested against known sRGB
reference coordinates so a broken colour-space transform cannot
silently pass the contrast gate later.

Refs #24"
```

---

### Task 2: Token loader and the alias resolver

**Files:**
- Create: `packages/design-system/src/tokens.ts`
- Test: `packages/design-system/src/tokens.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `type TokenTree`, `loadTokens(path: string): TokenTree`, `resolveAlias(tree: TokenTree, ref: string): string`, `flatten(group: TokenTree): Map<string, string>`, `isAlias(value: string): boolean`. Aliases use DTCG curly form, e.g. `{primitive.color.slate.200}`. Leaf tokens are `{ "$value": string }`.

- [ ] **Step 1: Write the failing test**

`packages/design-system/src/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { flatten, isAlias, resolveAlias, type TokenTree } from './tokens.js'

const TREE: TokenTree = {
  primitive: {
    color: {
      slate: { '200': { $value: 'oklch(0.92 0.01 260)' } },
      sunset: { '500': { $value: 'oklch(0.70 0.17 45)' } },
    },
  },
  semantic: {
    light: {
      border: { $value: '{primitive.color.slate.200}' },
      primary: { $value: '{primitive.color.sunset.500}' },
    },
  },
}

describe('isAlias', () => {
  it('recognises the DTCG curly reference form', () => {
    expect(isAlias('{primitive.color.slate.200}')).toBe(true)
  })

  it('treats a literal colour as not an alias', () => {
    expect(isAlias('oklch(0.92 0.01 260)')).toBe(false)
  })
})

describe('resolveAlias', () => {
  it('follows a reference to its literal value', () => {
    expect(resolveAlias(TREE, '{primitive.color.slate.200}')).toBe('oklch(0.92 0.01 260)')
  })

  it('returns a literal unchanged', () => {
    expect(resolveAlias(TREE, 'oklch(1 0 0)')).toBe('oklch(1 0 0)')
  })

  it('throws on a reference that points nowhere', () => {
    expect(() => resolveAlias(TREE, '{primitive.color.slate.999}')).toThrow(/unresolved/i)
  })
})

describe('flatten', () => {
  it('produces dotted keys mapped to resolved values', () => {
    const flat = flatten(TREE['semantic'] as TokenTree)
    expect(flat.get('light.border')).toBe('{primitive.color.slate.200}')
    expect(flat.get('light.primary')).toBe('{primitive.color.sunset.500}')
    expect(flat.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @globetrotter/design-system test src/tokens.test.ts`
Expected: FAIL — cannot resolve `./tokens.js`.

- [ ] **Step 3: Write the implementation**

`packages/design-system/src/tokens.ts`:

```ts
import { readFileSync } from 'node:fs'

export interface TokenLeaf {
  readonly $value: string
}

export interface TokenTree {
  readonly [key: string]: TokenTree | TokenLeaf
}

const ALIAS_PATTERN = /^\{([A-Za-z0-9_.-]+)\}$/

export function isAlias(value: string): boolean {
  return ALIAS_PATTERN.test(value)
}

function isLeaf(node: TokenTree | TokenLeaf): node is TokenLeaf {
  return typeof (node as TokenLeaf)['$value'] === 'string'
}

export function loadTokens(path: string): TokenTree {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Token file is not an object: ${path}`)
  }
  return parsed as TokenTree
}

export function resolveAlias(tree: TokenTree, value: string): string {
  const match = ALIAS_PATTERN.exec(value)
  if (match === null) return value

  const path = match[1]
  if (path === undefined) throw new Error(`Unresolved token reference: ${value}`)

  let node: TokenTree | TokenLeaf | undefined = tree
  for (const segment of path.split('.')) {
    if (node === undefined || isLeaf(node)) {
      throw new Error(`Unresolved token reference: ${value}`)
    }
    node = node[segment]
  }
  if (node === undefined || !isLeaf(node)) {
    throw new Error(`Unresolved token reference: ${value}`)
  }
  return resolveAlias(tree, node['$value'])
}

export function flatten(group: TokenTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith('$')) continue
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isLeaf(node)) {
      out.set(path, node['$value'])
    } else {
      for (const [childKey, childValue] of flatten(node, path)) {
        out.set(childKey, childValue)
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @globetrotter/design-system test`
Expected: PASS — 20 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/design-system/src/tokens.ts packages/design-system/src/tokens.test.ts
git commit -m "feat(design-system): DTCG token loader with alias resolution

Semantic tokens reference primitives through {curly.path} aliases and
resolve transitively, which is what lets the layering rule be tested
rather than merely documented.

Refs #24"
```

---

### Task 3: Author `tokens.json` and make the contrast gate pass

Write the gate first, then author tokens until it goes green. If a pair fails, solve for a compliant lightness rather than eyeballing a new value.

**Files:**
- Create: `packages/design-system/tokens.json`
- Test: `packages/design-system/src/contrast.test.ts`

**Interfaces:**
- Consumes: `contrastRatio`, `isInGamut`, `parseOklch` (Task 1); `loadTokens`, `resolveAlias` (Task 2).
- Produces: `tokens.json` with groups `primitive` and `semantic.light` / `semantic.dark`. Every shadcn contract name present in both themes.

- [ ] **Step 1: Write the failing test**

`packages/design-system/src/contrast.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio, isInGamut, parseOklch } from './color.js'
import { loadTokens, resolveAlias } from './tokens.js'

const TOKENS_PATH = fileURLToPath(new URL('../tokens.json', import.meta.url))
const tokens = loadTokens(TOKENS_PATH)

const THEMES = ['light', 'dark'] as const

/** Every semantic colour name the shadcn/ui contract requires, verified against shadcn-ui/ui@main. */
const CONTRACT = [
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
  'sidebar', 'sidebar-foreground',
  'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground',
  'sidebar-border', 'sidebar-ring',
] as const

/** Pairs carrying text: WCAG 1.4.3 AA. */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'background'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
]

/** Pairs identifying a control or its state: WCAG 1.4.11 / 2.4.11. */
const UI_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['input', 'background'],
  ['ring', 'background'],
  ['ring', 'card'],
  ['sidebar-ring', 'sidebar'],
]

function swatch(theme: string, name: string) {
  return parseOklch(resolveAlias(tokens, `{semantic.${theme}.${name}}`))
}

describe.each(THEMES)('%s theme', (theme) => {
  it.each(CONTRACT)('defines %s', (name) => {
    expect(() => swatch(theme, name)).not.toThrow()
  })

  it.each(CONTRACT)('%s is inside sRGB gamut', (name) => {
    expect(isInGamut(swatch(theme, name))).toBe(true)
  })

  it.each(TEXT_PAIRS)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(contrastRatio(swatch(theme, fg), swatch(theme, bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(UI_PAIRS)('%s against %s meets 3:1', (fg, bg) => {
    expect(contrastRatio(swatch(theme, fg), swatch(theme, bg))).toBeGreaterThanOrEqual(3)
  })

  it('never aliases ring directly to primary', () => {
    const semantic = loadTokens(TOKENS_PATH)['semantic']
    const raw = JSON.stringify(semantic)
    expect(raw).not.toContain(`"{semantic.${theme}.primary}"`)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @globetrotter/design-system test src/contrast.test.ts`
Expected: FAIL — `ENOENT: tokens.json`.

- [ ] **Step 3: Author `tokens.json`**

Primitive ramps are **purpose-tuned, not geometric** — each step exists because a semantic role needs it, the way Radix scales are built. Neutral hue is 260 throughout; sunset is the sole brand hue.

Start from these verified values (all confirmed compliant during design):

| Semantic | Light | Dark |
|---|---|---|
| `background` | `oklch(1 0 0)` | `oklch(0.19 0.02 260)` |
| `foreground` | `oklch(0.21 0.02 260)` | `oklch(0.97 0.01 260)` |
| `card` / `popover` | `oklch(1 0 0)` | `oklch(0.23 0.02 260)` |
| `primary` | `oklch(0.70 0.17 45)` | `oklch(0.75 0.16 55)` |
| `primary-foreground` | `oklch(0.21 0.02 260)` | `oklch(0.19 0.02 260)` |
| `secondary` / `muted` | `oklch(0.97 0.01 260)` | `oklch(0.28 0.02 260)` |
| `muted-foreground` | `oklch(0.54 0.02 260)` | `oklch(0.71 0.02 260)` |
| `accent` | `oklch(0.96 0.01 260)` | `oklch(0.30 0.02 260)` |
| `destructive` | `oklch(0.55 0.20 27)` | `oklch(0.65 0.20 25)` |
| `destructive-foreground` | `oklch(0.98 0.01 17)` | `oklch(0.19 0.02 260)` |
| `border` | `oklch(0.92 0.01 260)` | `oklch(0.32 0.02 260)` |
| `input` | `oklch(0.65 0.02 260)` | `oklch(0.50 0.02 260)` |
| `ring` | `oklch(0.66 0.17 45)` | `oklch(0.75 0.16 55)` |

Sidebar tokens alias their non-sidebar counterparts except `sidebar` itself, which takes the `secondary`/`muted` surface so the nav reads as a distinct plane.

Chart tokens 1–5 are a sequential ramp stepping lightness while holding hue near the brand, and are **not yet verified** — the gate will report any failure and the fix is to solve for a compliant lightness, never to hand-tune.

Structure:

```json
{
  "primitive": {
    "color": {
      "slate": {
        "0":   { "$value": "oklch(1 0 0)" },
        "50":  { "$value": "oklch(0.97 0.01 260)" },
        "100": { "$value": "oklch(0.96 0.01 260)" },
        "200": { "$value": "oklch(0.92 0.01 260)" },
        "400": { "$value": "oklch(0.71 0.02 260)" },
        "500": { "$value": "oklch(0.65 0.02 260)" },
        "600": { "$value": "oklch(0.54 0.02 260)" },
        "700": { "$value": "oklch(0.50 0.02 260)" },
        "800": { "$value": "oklch(0.32 0.02 260)" },
        "850": { "$value": "oklch(0.30 0.02 260)" },
        "875": { "$value": "oklch(0.28 0.02 260)" },
        "900": { "$value": "oklch(0.23 0.02 260)" },
        "925": { "$value": "oklch(0.21 0.02 260)" },
        "950": { "$value": "oklch(0.19 0.02 260)" }
      },
      "sunset": {
        "400": { "$value": "oklch(0.75 0.16 55)" },
        "500": { "$value": "oklch(0.70 0.17 45)" },
        "600": { "$value": "oklch(0.66 0.17 45)" }
      },
      "red": {
        "400": { "$value": "oklch(0.65 0.20 25)" },
        "500": { "$value": "oklch(0.55 0.20 27)" },
        "50":  { "$value": "oklch(0.98 0.01 17)" }
      }
    },
    "space":    { "1": { "$value": "0.25rem" }, "2": { "$value": "0.5rem" }, "3": { "$value": "0.75rem" }, "4": { "$value": "1rem" }, "5": { "$value": "1.25rem" }, "6": { "$value": "1.5rem" }, "8": { "$value": "2rem" }, "10": { "$value": "2.5rem" }, "12": { "$value": "3rem" }, "16": { "$value": "4rem" }, "20": { "$value": "5rem" }, "24": { "$value": "6rem" } },
    "text":     { "sm": { "$value": "0.8rem" }, "base": { "$value": "1rem" }, "lg": { "$value": "1.25rem" }, "xl": { "$value": "1.5625rem" }, "2xl": { "$value": "1.9531rem" }, "3xl": { "$value": "2.4414rem" }, "4xl": { "$value": "3.0518rem" }, "5xl": { "$value": "3.8147rem" } },
    "leading":  { "tight": { "$value": "1.1" }, "snug": { "$value": "1.3" }, "normal": { "$value": "1.5" }, "relaxed": { "$value": "1.65" } },
    "radius":   { "base": { "$value": "0.75rem" } },
    "duration": { "fast": { "$value": "150ms" }, "base": { "$value": "250ms" }, "slow": { "$value": "400ms" } },
    "easing":   { "out": { "$value": "cubic-bezier(0.16, 1, 0.3, 1)" }, "in-out": { "$value": "cubic-bezier(0.65, 0, 0.35, 1)" }, "spring": { "$value": "cubic-bezier(0.34, 1.56, 0.64, 1)" } },
    "font": {
      "display": { "$value": "Fraunces, Georgia, 'Times New Roman', serif" },
      "sans":    { "$value": "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" },
      "mono":    { "$value": "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace" }
    },
    "shadow": {
      "xs": { "$value": "0 1px 2px 0 oklch(0.19 0.02 260 / 0.05)" },
      "sm": { "$value": "0 1px 3px 0 oklch(0.19 0.02 260 / 0.10), 0 1px 2px -1px oklch(0.19 0.02 260 / 0.10)" },
      "md": { "$value": "0 4px 6px -1px oklch(0.19 0.02 260 / 0.10), 0 2px 4px -2px oklch(0.19 0.02 260 / 0.10)" },
      "lg": { "$value": "0 10px 15px -3px oklch(0.19 0.02 260 / 0.10), 0 4px 6px -4px oklch(0.19 0.02 260 / 0.10)" },
      "xl": { "$value": "0 20px 25px -5px oklch(0.19 0.02 260 / 0.12), 0 8px 10px -6px oklch(0.19 0.02 260 / 0.12)" }
    }
  },
  "semantic": {
    "light": {
      "background":             { "$value": "{primitive.color.slate.0}" },
      "foreground":             { "$value": "{primitive.color.slate.925}" },
      "card":                   { "$value": "{primitive.color.slate.0}" },
      "card-foreground":        { "$value": "{primitive.color.slate.925}" },
      "popover":                { "$value": "{primitive.color.slate.0}" },
      "popover-foreground":     { "$value": "{primitive.color.slate.925}" },
      "primary":                { "$value": "{primitive.color.sunset.500}" },
      "primary-foreground":     { "$value": "{primitive.color.slate.925}" },
      "secondary":              { "$value": "{primitive.color.slate.50}" },
      "secondary-foreground":   { "$value": "{primitive.color.slate.875}" },
      "muted":                  { "$value": "{primitive.color.slate.50}" },
      "muted-foreground":       { "$value": "{primitive.color.slate.600}" },
      "accent":                 { "$value": "{primitive.color.slate.100}" },
      "accent-foreground":      { "$value": "{primitive.color.slate.875}" },
      "destructive":            { "$value": "{primitive.color.red.500}" },
      "destructive-foreground": { "$value": "{primitive.color.red.50}" },
      "border":                 { "$value": "{primitive.color.slate.200}" },
      "input":                  { "$value": "{primitive.color.slate.500}" },
      "ring":                   { "$value": "{primitive.color.sunset.600}" }
    },
    "dark": {}
  }
}
```

Complete `semantic.dark` the same way from the table, then add `chart-1`…`chart-5` and the eight `sidebar-*` tokens to both themes. `secondary-foreground` uses `slate.875` (`0.28`) to match the verified `0.28 0.03 260`; the small chroma difference is dropped so the neutral ramp stays single-chroma.

- [ ] **Step 4: Run the gate and iterate until green**

Run: `pnpm --filter @globetrotter/design-system test src/contrast.test.ts`
Expected: PASS. On any failure, solve for the boundary lightness rather than guessing:

```bash
node -e "
const {contrastRatio}=await import('./packages/design-system/dist/color.js');
for(let L=0.95;L>=0.05;L-=0.005){
  const r=contrastRatio({l:L,c:0.02,h:260},{l:1,c:0,h:0});
  if(r>=4.5){console.log('max L =',L.toFixed(3),'ratio',r.toFixed(2));break}
}"
```

- [ ] **Step 5: Commit**

```bash
git add packages/design-system/tokens.json packages/design-system/src/contrast.test.ts
git commit -m "feat(design-system): tokens.json with enforced WCAG contrast gate

Every shadcn contract variable defined in both themes as an alias to a
purpose-tuned primitive ramp. Text pairs gated at 4.5:1, input and ring
at 3:1, all colours checked for sRGB gamut. Runs under pnpm -r test, so
CI inherits the gate without extra wiring.

Refs #24"
```

---

### Task 4: Generate `theme.css`

**Files:**
- Create: `packages/design-system/src/build.ts`
- Create: `packages/design-system/src/index.ts`
- Test: `packages/design-system/src/build.test.ts`

**Interfaces:**
- Consumes: `loadTokens`, `flatten`, `resolveAlias`, `isAlias` (Task 2).
- Produces: `renderThemeCss(tree: TokenTree): string`, `renderTailwindPreset(tree: TokenTree): string`, `renderFigmaTokens(tree: TokenTree): string`, `renderTypeDeclarations(tree: TokenTree): string`, and a `main()` that writes all four into `dist/`.

- [ ] **Step 1: Write the failing test**

`packages/design-system/src/build.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderThemeCss } from './build.js'
import { loadTokens } from './tokens.js'

const tokens = loadTokens(fileURLToPath(new URL('../tokens.json', import.meta.url)))
const css = renderThemeCss(tokens)

describe('renderThemeCss', () => {
  it('emits a Tailwind v4 @theme inline block', () => {
    expect(css).toContain('@theme inline {')
    expect(css).toContain('--color-background: var(--background);')
  })

  it('defines the light theme on :root', () => {
    expect(css).toMatch(/:root\s*\{/)
    expect(css).toContain('--background: oklch(1 0 0);')
  })

  it('defines the dark theme on .dark', () => {
    expect(css).toMatch(/\.dark\s*\{/)
    expect(css).toContain('--background: oklch(0.19 0.02 260);')
  })

  it('exposes primitives under the --gt- prefix', () => {
    expect(css).toContain('--gt-space-4: 1rem;')
    expect(css).toContain('--gt-text-base: 1rem;')
  })

  it('resolves aliases to literal values, leaving no curly references', () => {
    expect(css).not.toMatch(/\{[a-z]+\./)
  })

  it('collapses motion durations under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('--gt-duration-fast: 1ms;')
  })

  it('derives the radius scale from a single base', () => {
    expect(css).toContain('--radius: 0.75rem;')
    expect(css).toContain('--radius-lg: var(--radius);')
  })

  it('contains no raw hex colours', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @globetrotter/design-system test src/build.test.ts`
Expected: FAIL — cannot resolve `./build.js`.

- [ ] **Step 3: Write the implementation**

`packages/design-system/src/build.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { flatten, loadTokens, resolveAlias, type TokenTree } from './tokens.js'

const NON_COLOR_GROUPS = new Set(['space', 'text', 'leading', 'radius', 'duration', 'easing', 'font', 'shadow'])

/** `primitive.space.4` -> `--gt-space-4`. */
function primitiveVar(path: string): string {
  return `--gt-${path.replace(/\./g, '-')}`
}

function semanticNames(tree: TokenTree): string[] {
  const light = tree['semantic'] as TokenTree
  return [...flatten(light['light'] as TokenTree).keys()]
}

function block(selector: string, lines: readonly string[]): string {
  return `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n`
}

export function renderThemeCss(tree: TokenTree): string {
  const primitives = flatten(tree['primitive'] as TokenTree)
  const names = semanticNames(tree)

  const themeMap = [
    ...names.map((n) => `--color-${n}: var(--${n});`),
    '--radius-sm: calc(var(--radius) - 4px);',
    '--radius-md: calc(var(--radius) - 2px);',
    '--radius-lg: var(--radius);',
    '--radius-xl: calc(var(--radius) + 4px);',
    '--font-display: var(--gt-font-display);',
    '--font-sans: var(--gt-font-sans);',
    '--font-mono: var(--gt-font-mono);',
  ]

  const rootLines = [
    ...[...primitives].map(([path, value]) => `${primitiveVar(path)}: ${resolveAlias(tree, value)};`),
    '--radius: var(--gt-radius-base);',
    ...names.map((n) => `--${n}: ${resolveAlias(tree, `{semantic.light.${n}}`)};`),
  ]

  const darkLines = names.map((n) => `--${n}: ${resolveAlias(tree, `{semantic.dark.${n}}`)};`)

  const reducedMotion = block(
    '  :root',
    ['--gt-duration-fast: 1ms;', '--gt-duration-base: 1ms;', '--gt-duration-slow: 1ms;'],
  )

  return [
    '/* GENERATED by @globetrotter/design-system. Edit tokens.json, never this file. */',
    '',
    block('@theme inline', themeMap),
    block(':root', rootLines),
    block('.dark', darkLines),
    `@media (prefers-reduced-motion: reduce) {\n${reducedMotion}}\n`,
  ].join('\n')
}

function main(): void {
  const tokensPath = fileURLToPath(new URL('../tokens.json', import.meta.url))
  const tree = loadTokens(tokensPath)
  const outDir = fileURLToPath(new URL('.', import.meta.url))
  const artifacts: ReadonlyArray<readonly [string, string]> = [
    ['theme.css', renderThemeCss(tree)],
    ['tailwind.preset.ts', renderTailwindPreset(tree)],
    ['tokens.figma.json', renderFigmaTokens(tree)],
    ['tokens.d.ts', renderTypeDeclarations(tree)],
  ]
  for (const [name, contents] of artifacts) {
    writeFileSync(`${outDir}${name}`, contents, 'utf8')
    console.log(`wrote dist/${name}`)
  }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith('build.js')) {
  main()
}
```

Note `NON_COLOR_GROUPS` is used by `renderFigmaTokens` in Task 5 for `$type` inference; it is declared here so both renderers share one source of truth.

`src/index.ts` re-exports the public surface:

```ts
export * from './color.js'
export * from './tokens.js'
export * from './build.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @globetrotter/design-system test`
Expected: PASS — all suites.

- [ ] **Step 5: Verify the generated file end to end**

```bash
pnpm --filter @globetrotter/design-system build
head -40 packages/design-system/dist/theme.css
```

Expected: a valid `@theme inline` block, then `:root`, then `.dark`.

- [ ] **Step 6: Commit**

```bash
git add packages/design-system/src
git commit -m "feat(design-system): generate Tailwind v4 theme.css from tokens

Emits @theme inline plus :root and .dark layers with every alias
resolved, primitives under --gt-, and a reduced-motion block that
collapses durations at the token layer.

Refs #24"
```

---

### Task 5: Generate the Tailwind preset, Figma tokens and type declarations

**Files:**
- Modify: `packages/design-system/src/build.ts`
- Modify: `packages/design-system/src/build.test.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: three more artifacts in `dist/`.

- [ ] **Step 1: Write the failing tests**

Append to `build.test.ts`:

```ts
import { renderFigmaTokens, renderTailwindPreset, renderTypeDeclarations } from './build.js'

describe('renderTailwindPreset', () => {
  it('exports a default object referencing the CSS variables', () => {
    const preset = renderTailwindPreset(tokens)
    expect(preset).toContain('export default')
    expect(preset).toContain('var(--primary)')
  })
})

describe('renderFigmaTokens', () => {
  it('emits Tokens Studio groups with $type annotations', () => {
    const figma: unknown = JSON.parse(renderFigmaTokens(tokens))
    expect(figma).toHaveProperty('primitive.color.slate.0.$type', 'color')
  })
})

describe('renderTypeDeclarations', () => {
  it('emits a union of every semantic token name', () => {
    const dts = renderTypeDeclarations(tokens)
    expect(dts).toContain("export type SemanticToken =")
    expect(dts).toContain("'background'")
    expect(dts).toContain("'ring'")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @globetrotter/design-system test src/build.test.ts`
Expected: FAIL — the three renderers are not exported.

- [ ] **Step 3: Implement the three renderers**

`renderTailwindPreset` emits a `.ts` module whose default export maps `theme.extend.colors` entries to `var(--<name>)`, plus `spacing`, `fontSize`, `borderRadius`, `boxShadow` and `fontFamily` from the primitives. `renderFigmaTokens` walks the tree adding `$type` (`color`, `dimension`, `fontFamily`, `duration`, `cubicBezier`, `shadow`) inferred from the group name, preserving `{alias}` references so Tokens Studio keeps them live. `renderTypeDeclarations` emits `export type SemanticToken = 'background' | ...` and `export type PrimitiveToken = ...`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @globetrotter/design-system test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/design-system/src
git commit -m "feat(design-system): emit Tailwind preset, Figma tokens and type declarations

tokens.d.ts gives every token name as a union type, so 'no any' holds at
the token layer with autocomplete rather than discipline.

Refs #24"
```

---

### Task 6: Enforce the layering rule as a test

**Files:**
- Create: `packages/design-system/src/layering.test.ts`

**Interfaces:**
- Consumes: `loadTokens`, `flatten`, `isAlias` (Task 2).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the test**

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { flatten, isAlias, loadTokens, type TokenTree } from './tokens.js'

const tokens = loadTokens(fileURLToPath(new URL('../tokens.json', import.meta.url)))
const semantic = flatten(tokens['semantic'] as TokenTree)
const primitive = flatten(tokens['primitive'] as TokenTree)

describe('token layering', () => {
  it('has no literal values in the semantic layer', () => {
    const literals = [...semantic].filter(([, value]) => !isAlias(value))
    expect(literals).toEqual([])
  })

  it('has no aliases in the primitive layer', () => {
    const aliases = [...primitive].filter(([, value]) => isAlias(value))
    expect(aliases).toEqual([])
  })

  it('uses no raw hex anywhere', () => {
    for (const [, value] of [...semantic, ...primitive]) {
      expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it('defines the same token names in both themes', () => {
    const names = (theme: string) =>
      [...semantic.keys()].filter((k) => k.startsWith(`${theme}.`)).map((k) => k.slice(theme.length + 1)).sort()
    expect(names('light')).toEqual(names('dark'))
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @globetrotter/design-system test src/layering.test.ts`
Expected: PASS if Task 3 was authored correctly; any failure names the offending token.

- [ ] **Step 3: Commit**

```bash
git add packages/design-system/src/layering.test.ts
git commit -m "test(design-system): enforce three-layer token discipline

Semantics must be aliases, primitives must be literals, no raw hex, and
both themes must define the same names. Turns the layering convention
into something CI checks.

Refs #24"
```

---

### Task 7: Documentation and workspace wiring

**Files:**
- Create: `docs/DESIGN.md`
- Create: `docs/adr/0003-design-tokens.md`
- Modify: `tsconfig.json` (root) — add the project reference

**Interfaces:**
- Consumes: the finished package.
- Produces: nothing consumed by code.

- [ ] **Step 1: Add the project reference**

In root `tsconfig.json`, add to `references`:

```json
{ "path": "./packages/design-system" }
```

- [ ] **Step 2: Write `docs/DESIGN.md`**

Cover, with no more than a page per section: the three layers and the rule that components use semantic tokens only; the full semantic table for both themes with measured ratios; the type, spacing, radius, shadow and motion scales; why `--ring` is not `--primary` and why `--border` and `--input` diverge; how to add a token (edit `tokens.json`, run the gate, never hand-edit `dist/`); and the PR checklist from #24.

- [ ] **Step 3: Write `docs/adr/0003-design-tokens.md`**

Standard ADR form — Context, Decision, Consequences. Record: the three-layer architecture with `--gt-` prefixed primitives; pinning shadcn/ui's variable contract, dated, and what a future bump entails; contrast as a vitest gate rather than a script; the `--border`/`--input` divergence under WCAG 1.4.11; and emitting Tailwind v4 `@theme` as the real artifact with a JS preset alongside, since #24 asks for a v3-era config file.

- [ ] **Step 4: Verify the whole workspace still builds**

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

Expected: all green, including `@globetrotter/contracts`.

- [ ] **Step 5: Commit**

```bash
git add docs tsconfig.json
git commit -m "docs(design-system): DESIGN.md, ADR 0003, workspace project reference

Refs #24"
```

---

### Task 8: Push and open the pull request

**Files:** none.

- [ ] **Step 1: Confirm the branch is clean and rebased**

```bash
git fetch origin
git rebase origin/main
pnpm -r test
```

- [ ] **Step 2: Push**

```bash
git push -u origin feat/design-system
```

- [ ] **Step 3: Open the PR**

Body states what changed, how to verify (`pnpm --filter @globetrotter/design-system test`), that `dist/` is generated rather than committed, that `/kitchen-sink` and the README Figma link follow once `apps/web` exists, and the Tailwind v4 deviation from #24's literal wording. Include the contrast-gate output as the screenshot substitute, since this PR ships no UI.

```bash
gh pr create --title "feat(design-system): token pipeline with enforced contrast gate (#24)" --body-file .git/PR_BODY.md
```

- [ ] **Step 4: Link the PR on #24**

Comment noting that the token contract published earlier is now implemented and that `dist/theme.css` is ready to import, so the shim can be deleted.

---

## Follow-up, tracked but out of this plan

`/kitchen-sink` route, the Figma push via MCP, and the README Figma link all require `apps/web`. They ship as a second PR, and **#24 does not close until they land.**
