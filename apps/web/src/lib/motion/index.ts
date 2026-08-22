/**
 * The motion system (#40). One easing set, one duration scale, five presets.
 *
 * Import from here, never from the files underneath — the barrel is what lets
 * the presets change without touching every screen.
 *
 *   import { fadeUp, stagger, useMotionScope } from '../../lib/motion/index.js';
 *
 * Rules, in full, live in /docs/MOTION.md. The short version:
 *   1. No raw durations, no raw cubic-beziers. Use the tokens.
 *   2. No hand-rolled timelines in components. Add a preset instead.
 *   3. Every timeline is reduced-motion gated. The presets do this for you.
 */

export { registerGsap, gsap, ScrollTrigger, ScrollSmoother, SplitText } from './gsap.js';

export { prefersReducedMotion, useReducedMotion } from './reduced-motion.js';

export { STAGGER, duration, durationMs, ease, cssEase } from './tokens.js';
export type { DurationName, EaseName, StaggerName } from './tokens.js';

export {
  fadeUp,
  stagger,
  splitReveal,
  blurReveal,
  revealFrom,
  pinReveal,
  countUp,
  pageEnter,
  pageExit,
  parallax,
  refreshScroll,
} from './presets.js';
export type {
  Target,
  FadeUpOptions,
  StaggerOptions,
  SplitRevealOptions,
  BlurRevealOptions,
  RevealFromOptions,
  PinRevealOptions,
  CountUpOptions,
} from './presets.js';

export {
  useMotionScope,
  usePageEnter,
  useScrollSmoother,
  useScrollRefresh,
  useMagnetic,
} from './use-motion.js';
