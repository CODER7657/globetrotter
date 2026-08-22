/**
 * Colour mathematics for the token contrast gate.
 *
 * Pure functions, no dependencies. OKLCH is the authoring space because
 * Tailwind v4 and shadcn/ui both emit it, and because equal lightness steps
 * are perceptually even — which is what makes a purpose-tuned ramp legible.
 */

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
  const l = match[1]
  const c = match[2]
  const h = match[3]
  if (l === undefined || c === undefined || h === undefined) {
    throw new Error(`Value is not an oklch() colour: ${input}`)
  }
  return { l: Number(l), c: Number(c), h: Number(h) }
}

/** sRGB transfer function, linear -> gamma-encoded. */
function encodeGamma(channel: number): number {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055
}

/**
 * OKLCH -> OKLab -> linear LMS -> linear sRGB -> gamma-encoded sRGB.
 * Channels may fall outside 0..1; that is how out-of-gamut colours are detected.
 */
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

/** Small tolerance so values that land a hair outside sRGB from float error still pass. */
const GAMUT_TOLERANCE = 0.002

export function isInGamut(color: Oklch): boolean {
  const { r, g, b } = oklchToSrgb(color)
  return [r, g, b].every(
    (channel) => channel >= -GAMUT_TOLERANCE && channel <= 1 + GAMUT_TOLERANCE,
  )
}

/**
 * WCAG 2.1 relative luminance. Channels are clamped first: an out-of-gamut
 * value is not displayable, so its contrast is measured against what a screen
 * would actually show.
 */
export function relativeLuminance(rgb: Rgb): number {
  const toLinear = (channel: number): number => {
    const clamped = Math.min(1, Math.max(0, channel))
    return clamped <= 0.03928 ? clamped / 12.92 : Math.pow((clamped + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const lumA = relativeLuminance(oklchToSrgb(a))
  const lumB = relativeLuminance(oklchToSrgb(b))
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}
