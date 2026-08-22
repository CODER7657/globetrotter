/**
 * Motion tokens, read from CSS custom properties at runtime.
 *
 * There is exactly one duration scale and one easing set in this app, and it
 * lives in `packages/design-system/tokens.json`. This module is the only
 * bridge from the generated CSS into JS, so GSAP and CSS transitions can
 * never drift apart.
 *
 * Do not write a raw duration or a raw cubic-bezier anywhere else.
 */

export type DurationName = 'instant' | 'fast' | 'base' | 'slow' | 'deliberate';
export type EaseName = 'out' | 'inOut' | 'spring';

/** Fallbacks matched to tokens.css, used during SSR and before first paint. */
const DURATION_FALLBACK: Record<DurationName, number> = {
  instant: 0,
  fast: 150,
  base: 250,
  slow: 400,
  deliberate: 700,
};

const EASE_FALLBACK: Record<EaseName, string> = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

const CSS_VAR: Record<DurationName, string> = {
  instant: '--gt-duration-instant',
  fast: '--gt-duration-fast',
  base: '--gt-duration-base',
  slow: '--gt-duration-slow',
  deliberate: '--gt-duration-deliberate',
};

const EASE_VAR: Record<EaseName, string> = {
  out: '--gt-easing-out',
  inOut: '--gt-easing-in-out',
  spring: '--gt-easing-spring',
};

function readCssVar(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : null;
}

/** `"250ms"` and `"0.25s"` both become `250`. */
function parseMs(raw: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(raw);
  if (match === null) return null;
  const [, numRaw, unit] = match;
  if (numRaw === undefined) return null;
  const num = Number.parseFloat(numRaw);
  if (Number.isNaN(num)) return null;
  return unit === 's' ? num * 1000 : num;
}

/** Duration in milliseconds. */
export function durationMs(name: DurationName): number {
  const raw = readCssVar(CSS_VAR[name]);
  const parsed = raw === null ? null : parseMs(raw);
  return parsed ?? DURATION_FALLBACK[name];
}

/** Duration in seconds — the unit GSAP expects. */
export function duration(name: DurationName): number {
  return durationMs(name) / 1000;
}

/**
 * GSAP-native easing string. GSAP does not read `cubic-bezier(...)`, so the
 * token curves are mapped to their GSAP equivalents rather than reparsed.
 * The CSS var is still the source of truth for the CSS side.
 */
const GSAP_EASE: Record<EaseName, string> = {
  out: 'expo.out',
  inOut: 'power3.inOut',
  spring: 'back.out(1.6)',
};

export function ease(name: EaseName): string {
  return GSAP_EASE[name];
}

/** The raw cubic-bezier, for anything driving a CSS transition from JS. */
export function cssEase(name: EaseName): string {
  return readCssVar(EASE_VAR[name]) ?? EASE_FALLBACK[name];
}

/** Stagger steps, in seconds. Keyed to the same scale. */
export const STAGGER = {
  tight: 0.04,
  base: 0.08,
  loose: 0.14,
} as const;

export type StaggerName = keyof typeof STAGGER;
