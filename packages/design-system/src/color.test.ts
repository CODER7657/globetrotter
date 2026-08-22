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
