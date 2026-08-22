/**
 * GSAP singleton and plugin registration.
 *
 * Every plugin here is free as of April 2025 — ScrollTrigger, ScrollSmoother,
 * SplitText, DrawSVG and MorphSVG included. Registration happens exactly once;
 * calling `registerGsap()` again is a no-op.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { SplitText } from 'gsap/SplitText';
import { prefersReducedMotion } from './reduced-motion.js';
import { duration, ease } from './tokens.js';

let registered = false;

export function registerGsap(): typeof gsap {
  if (registered) return gsap;

  gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);

  // Defaults so a preset that forgets to specify still lands on the scale.
  gsap.defaults({
    duration: duration('base'),
    ease: ease('out'),
  });

  // One global kill switch. Under reduced motion GSAP still runs timelines,
  // but every tween completes instantly — so final states are always correct
  // and nothing is left half-animated or invisible.
  if (prefersReducedMotion()) {
    gsap.globalTimeline.timeScale(1000);
    ScrollTrigger.config({ autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load' });
  }

  registered = true;
  return gsap;
}

export { gsap, ScrollTrigger, ScrollSmoother, SplitText };
