/**
 * The accessibility gate.
 *
 * Runs under `pnpm -r test`, so CI inherits it with no extra wiring. This is
 * what makes #24's "audited for contrast" and #32's "verified, not assumed"
 * the same enforced fact rather than two manual passes.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio, isInGamut, parseOklch } from './color.js'
import { loadTokens, resolveAlias } from './tokens.js'

const TOKENS_PATH = fileURLToPath(new URL('../tokens.json', import.meta.url))
const tokens = loadTokens(TOKENS_PATH)

const THEMES = ['light', 'dark'] as const

/** Every semantic colour shadcn/ui requires. Verified against shadcn-ui/ui@main, 2026-08-22. */
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

/** Pairs that carry text: WCAG 1.4.3 AA, 4.5:1. */
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

/**
 * Pairs that identify a control or its state: WCAG 1.4.11 / 2.4.11, 3:1.
 * `border` is deliberately absent — a decorative card edge is exempt, which is
 * exactly why `border` and `input` are separate tokens with different values.
 */
const UI_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['input', 'background'],
  ['ring', 'background'],
  ['ring', 'card'],
  ['sidebar-ring', 'sidebar'],
]

/** Charts sit on the page background and must be distinguishable from it. */
const CHART_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const

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

  it.each(CHART_TOKENS)('%s is distinguishable from the background', (name) => {
    expect(contrastRatio(swatch(theme, name), swatch(theme, 'background'))).toBeGreaterThanOrEqual(3)
  })
})
