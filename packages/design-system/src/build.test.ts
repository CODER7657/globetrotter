import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  renderFigmaTokens,
  renderTailwindPreset,
  renderThemeCss,
  renderTypeDeclarations,
} from './build.js'
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

    const darkBlock = css.slice(css.indexOf('.dark'))
    const background = /--background:\s*(oklch\([^)]+\));/.exec(darkBlock)

    // Asserted by shape rather than by one palette value. What matters is that
    // the dark theme resolves --background to a real colour that differs from
    // the light one; pinning the literal makes every palette swap a test edit.
    expect(background).not.toBeNull()
    expect(background?.[1]).not.toBe('oklch(1 0 0)')
  })

  it('exposes primitives under the --gt- prefix', () => {
    expect(css).toContain('--gt-space-4: 1rem;')
    expect(css).toContain('--gt-text-base: 1rem;')
  })

  it('resolves every alias, leaving no curly reference behind', () => {
    expect(css).not.toMatch(/\{primitive\./)
    expect(css).not.toMatch(/\{semantic\./)
  })

  it('collapses motion durations under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('--gt-duration-fast: 1ms;')
    expect(css).toContain('--gt-duration-slow: 1ms;')
  })

  it('derives the radius scale from a single base', () => {
    expect(css).toContain('--radius: var(--gt-radius-base);')
    expect(css).toContain('--radius-lg: var(--radius);')
  })

  it('contains no raw hex colours', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('never aliases ring to primary', () => {
    expect(css).not.toContain('--ring: var(--primary)')
  })
})

describe('renderTailwindPreset', () => {
  it('exports a default object referencing the CSS variables', () => {
    const preset = renderTailwindPreset(tokens)
    expect(preset).toContain('export default')
    expect(preset).toContain('var(--primary)')
    expect(preset).toContain('var(--sidebar-ring)')
  })

  it('carries the spacing and type scales', () => {
    const preset = renderTailwindPreset(tokens)
    expect(preset).toContain("'4': '1rem'")
    expect(preset).toContain("'base': '1rem'")
  })
})

describe('renderFigmaTokens', () => {
  it('annotates groups with DTCG $type', () => {
    const figma: Record<string, unknown> = JSON.parse(renderFigmaTokens(tokens)) as Record<
      string,
      unknown
    >
    expect(figma).toHaveProperty(['primitive', 'color', 'slate', '0', '$type'], 'color')
    expect(figma).toHaveProperty(['primitive', 'space', '4', '$type'], 'dimension')
    expect(figma).toHaveProperty(['primitive', 'duration', 'fast', '$type'], 'duration')
  })

  it('preserves alias references so Tokens Studio keeps them live', () => {
    const raw = renderFigmaTokens(tokens)
    // Asserted by shape rather than by one specific colour. This test is about
    // aliases surviving the render un-flattened, not about which primitives
    // exist — and a palette swap legitimately retires individual ramp steps.
    expect(raw).toMatch(/\{primitive\.color\.[\w-]+\.[\w-]+\}/)
  })
})

describe('renderTypeDeclarations', () => {
  it('emits a union of every semantic token name', () => {
    const dts = renderTypeDeclarations(tokens)
    expect(dts).toContain('export type SemanticToken =')
    expect(dts).toContain("'background'")
    expect(dts).toContain("'ring'")
    expect(dts).toContain("'sidebar-ring'")
  })

  it('emits a union of primitive token names', () => {
    const dts = renderTypeDeclarations(tokens)
    expect(dts).toContain('export type PrimitiveToken =')
    expect(dts).toContain("'space-4'")
  })
})
