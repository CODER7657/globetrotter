/**
 * The motion vocabulary. Five presets, one language.
 *
 * #40: "Inconsistent animation reads as amateur faster than no animation."
 * If a screen needs a movement that is not in this file, add it here and use
 * it everywhere — do not hand-roll a timeline inside a component.
 *
 * Every preset returns a GSAP timeline and is safe to call under reduced
 * motion: the gate short-circuits to the final state instead of animating.
 */

import { gsap, ScrollTrigger, SplitText, registerGsap } from './gsap.js';
import { prefersReducedMotion } from './reduced-motion.js';
import { STAGGER, duration, ease } from './tokens.js';
import type { DurationName, EaseName, StaggerName } from './tokens.js';

export type Target = gsap.TweenTarget;
type Timeline = gsap.core.Timeline;

interface BaseOptions {
  duration?: DurationName;
  ease?: EaseName;
  delay?: number;
  /** Tie the animation to scroll position instead of playing immediately. */
  scrub?: boolean;
  trigger?: Element | string;
  start?: string;
}

/**
 * Snap targets to their resting state without animating. Used by every preset
 * when reduced motion is on, so content is never left invisible or offset.
 */
function settle(targets: Target, to: gsap.TweenVars): Timeline {
  const tl = gsap.timeline();
  tl.set(targets, to);
  return tl;
}

function scrollTriggerFor(
  options: BaseOptions,
  fallbackTrigger: Target,
): ScrollTrigger.Vars | undefined {
  if (options.trigger === undefined && options.scrub !== true) return undefined;

  // The cast is needed because exactOptionalPropertyTypes makes the optional
  // `trigger` property reject `undefined` on write, even though we have just
  // proven one of the two operands is defined.
  const trigger = (options.trigger ??
    fallbackTrigger) as NonNullable<ScrollTrigger.Vars['trigger']>;

  const vars: ScrollTrigger.Vars = {
    trigger,
    start: options.start ?? 'top 80%',
  };

  if (options.scrub === true) {
    vars.scrub = 1;
    vars.end = 'bottom 60%';
  } else {
    // Play once and stay. The tempting alternative, 'play none none reverse',
    // un-plays the reveal whenever the trigger point leaves the viewport
    // upwards — so scrolling back up empties sections that were already read,
    // and anything that starts on screen can be left at opacity 0 outright.
    // A reveal is an entrance, not a state bound to scroll position.
    vars.toggleActions = 'play none none none';
    vars.once = true;
  }
  return vars;
}

function timelineWith(scrollTrigger: ScrollTrigger.Vars | undefined): Timeline {
  return scrollTrigger === undefined ? gsap.timeline() : gsap.timeline({ scrollTrigger });
}

/* -------------------------------------------------------------------------- */
/* fadeUp — the workhorse. Content arrives from 16px below, never further.     */
/* -------------------------------------------------------------------------- */

export interface FadeUpOptions extends BaseOptions {
  distance?: number;
}

export function fadeUp(targets: Target, options: FadeUpOptions = {}): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(targets, { opacity: 1, y: 0 });

  const tl = timelineWith(scrollTriggerFor(options, targets));

  tl.fromTo(
    targets,
    { opacity: 0, y: options.distance ?? 16 },
    {
      opacity: 1,
      y: 0,
      duration: duration(options.duration ?? 'slow'),
      ease: ease(options.ease ?? 'out'),
      delay: options.delay ?? 0,
      clearProps: 'transform',
    },
  );
  return tl;
}

/* -------------------------------------------------------------------------- */
/* stagger — a list, a card grid, a row of stat tiles.                         */
/* -------------------------------------------------------------------------- */

export interface StaggerOptions extends FadeUpOptions {
  step?: StaggerName | number;
  from?: 'start' | 'center' | 'edges' | 'end';
}

export function stagger(targets: Target, options: StaggerOptions = {}): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(targets, { opacity: 1, y: 0 });

  const stepOption = options.step ?? 'base';
  const step = typeof stepOption === 'number' ? stepOption : STAGGER[stepOption];
  const tl = timelineWith(scrollTriggerFor(options, targets));

  tl.fromTo(
    targets,
    { opacity: 0, y: options.distance ?? 16 },
    {
      opacity: 1,
      y: 0,
      duration: duration(options.duration ?? 'slow'),
      ease: ease(options.ease ?? 'out'),
      delay: options.delay ?? 0,
      stagger: { each: step, from: options.from ?? 'start' },
      clearProps: 'transform',
    },
  );
  return tl;
}

/* -------------------------------------------------------------------------- */
/* splitReveal — headline arrives word by word. Display type only.             */
/* -------------------------------------------------------------------------- */

export interface SplitRevealOptions extends BaseOptions {
  by?: 'words' | 'chars' | 'lines';
}

export function splitReveal(target: Element, options: SplitRevealOptions = {}): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(target, { opacity: 1, y: 0 });

  const by = options.by ?? 'words';
  const split = new SplitText(target, {
    type: by === 'lines' ? 'lines' : 'lines,' + by,
    linesClass: 'split-line',
    wordsClass: 'split-word',
  });

  const pieces = by === 'words' ? split.words : by === 'chars' ? split.chars : split.lines;
  const tl = timelineWith(scrollTriggerFor(options, target));

  tl.fromTo(
    pieces,
    { opacity: 0, yPercent: 110 },
    {
      opacity: 1,
      yPercent: 0,
      duration: duration(options.duration ?? 'deliberate'),
      ease: ease(options.ease ?? 'out'),
      delay: options.delay ?? 0,
      stagger: STAGGER.tight,
    },
  );

  // SplitText rewrites the DOM. Put it back once the reveal is done, so the
  // text stays selectable and screen readers get one node, not one per word.
  tl.eventCallback('onComplete', () => {
    split.revert();
  });
  return tl;
}

/* -------------------------------------------------------------------------- */
/* blurReveal — words arrive out of focus and settle. Display type only.       */
/* -------------------------------------------------------------------------- */

export interface BlurRevealOptions extends BaseOptions {
  by?: 'words' | 'chars';
  /** 'top' drops in from above, 'bottom' rises from below. */
  from?: 'top' | 'bottom';
  blur?: number;
  distance?: number;
}

/**
 * Each word fades up from a blur, slightly overshooting focus before settling —
 * the midpoint keyframe is what stops it reading as a plain fade.
 *
 * `filter: blur()` repaints rather than compositing, so this is reserved for
 * headlines. Do not run it across a paragraph or a list.
 */
export function blurReveal(target: Element, options: BlurRevealOptions = {}): Timeline {
  registerGsap();
  if (prefersReducedMotion()) {
    return settle(target, { opacity: 1, y: 0, filter: 'blur(0px)' });
  }

  const by = options.by ?? 'words';
  const sign = (options.from ?? 'top') === 'top' ? -1 : 1;
  const blur = options.blur ?? 10;
  const distance = options.distance ?? 40;

  // SplitText wraps every word in an inline-block, which does not wrap byte
  // for byte the way the original inline text did. Pinning the height to what
  // the un-split element measured means a break difference can never shift
  // the rest of the page mid-reveal. Released on completion.
  //
  // Set via gsap rather than el.style so the surrounding gsap.context records
  // it. A timeline that gets killed instead of completing — a remount, a route
  // change — never reaches onComplete, and a raw inline style would then be
  // stranded on the element forever.
  const el = target as HTMLElement;
  const naturalHeight = el.getBoundingClientRect().height;
  if (naturalHeight > 0) gsap.set(el, { minHeight: naturalHeight });

  const split = new SplitText(target, {
    type: by === 'chars' ? 'lines,words,chars' : 'lines,words',
    linesClass: 'split-line',
    wordsClass: 'split-word',
  });
  const pieces = by === 'chars' ? split.chars : split.words;

  const tl = timelineWith(scrollTriggerFor(options, target));

  tl.fromTo(
    pieces,
    { opacity: 0, y: sign * distance, filter: `blur(${blur}px)` },
    {
      // Halfway: mostly there, still soft. This beat is the whole effect.
      opacity: 0.5,
      y: sign * -5,
      filter: `blur(${blur / 2}px)`,
      duration: duration(options.duration ?? 'slow'),
      ease: ease(options.ease ?? 'out'),
      delay: options.delay ?? 0,
      stagger: STAGGER.base,
    },
  ).to(
    pieces,
    {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      duration: duration(options.duration ?? 'slow'),
      ease: ease(options.ease ?? 'out'),
      stagger: STAGGER.base,
      // Blur is expensive to leave sitting on a layer once it is done.
      clearProps: 'filter,transform',
    },
    `-=${duration('base')}`,
  );

  tl.eventCallback('onComplete', () => {
    // Revert first, then release the height — doing it the other way round
    // lets the un-split text reflow into an unconstrained box for a frame,
    // which is the jump this reservation exists to prevent.
    split.revert();
    gsap.set(el, { clearProps: 'minHeight' });
  });
  return tl;
}

/* -------------------------------------------------------------------------- */
/* revealFrom — content enters from the left or the right on scroll.           */
/* -------------------------------------------------------------------------- */

export interface RevealFromOptions extends BaseOptions {
  side?: 'left' | 'right';
  distance?: number;
  step?: StaggerName | number;
}

/**
 * The lateral counterpart to `stagger`. Alternating sides down the page gives
 * scrolling a rhythm; using it on everything just makes the page twitch, so
 * pick a side per section and stay with it.
 */
export function revealFrom(targets: Target, options: RevealFromOptions = {}): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(targets, { opacity: 1, x: 0, y: 0 });

  const sign = (options.side ?? 'left') === 'left' ? -1 : 1;
  const stepOption = options.step ?? 'base';
  const step = typeof stepOption === 'number' ? stepOption : STAGGER[stepOption];
  const tl = timelineWith(scrollTriggerFor(options, targets));

  // A fixed 64px travel is a sixth of a phone viewport, which reads as the
  // layout being assembled rather than as content arriving. Scale it to the
  // screen so the gesture stays proportionally the same everywhere.
  const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const distance = options.distance ?? Math.round(Math.min(64, viewport * 0.05));

  tl.fromTo(
    targets,
    { opacity: 0, x: sign * distance },
    {
      opacity: 1,
      x: 0,
      duration: duration(options.duration ?? 'slow'),
      ease: ease(options.ease ?? 'out'),
      delay: options.delay ?? 0,
      stagger: { each: step, from: 'start' },
      clearProps: 'transform',
    },
  );
  return tl;
}

/* -------------------------------------------------------------------------- */
/* pinReveal — pin a section and scrub its children as the page scrolls.       */
/* -------------------------------------------------------------------------- */

export interface PinRevealOptions {
  panels: Target;
  end?: string;
}

export function pinReveal(container: Element, options: PinRevealOptions): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(options.panels, { opacity: 1, y: 0 });

  // A pinned trigger wraps its target in a .pin-spacer element. Create one
  // twice against the same container — which StrictMode's double mount does,
  // and so does any refresh that races the effect — and the second pin wraps
  // the first one's spacer, nesting them and inflating page height.
  // Killing with `revert` unwraps the old spacer before we add a new one.
  ScrollTrigger.getAll()
    .filter((t) => t.trigger === container && t.pin != null)
    .forEach((t) => {
      t.kill(true);
    });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: container,
      start: 'top top',
      end: options.end ?? '+=200%',
      pin: true,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });

  tl.fromTo(
    options.panels,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, stagger: STAGGER.loose, ease: ease('inOut') },
  );
  return tl;
}

/* -------------------------------------------------------------------------- */
/* countUp — KPI tiles and live counters. Tabular numerals mandatory.          */
/* -------------------------------------------------------------------------- */

export interface CountUpOptions extends BaseOptions {
  to: number;
  from?: number;
  decimals?: number;
  format?: (value: number) => string;
}

export function countUp(el: Element, options: CountUpOptions): Timeline {
  registerGsap();

  const decimals = options.decimals ?? 0;
  const format =
    options.format ??
    ((value: number): string =>
      value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }));

  // Reduced motion still needs the final number on screen.
  if (prefersReducedMotion()) {
    el.textContent = format(options.to);
    return gsap.timeline();
  }

  const state = { value: options.from ?? 0 };
  const tl = timelineWith(scrollTriggerFor(options, el));

  tl.to(state, {
    value: options.to,
    duration: duration(options.duration ?? 'deliberate'),
    ease: ease(options.ease ?? 'out'),
    delay: options.delay ?? 0,
    onUpdate: () => {
      el.textContent = format(state.value);
    },
  });
  return tl;
}

/* -------------------------------------------------------------------------- */
/* pageEnter / pageExit — route transitions. Hard budget: under 300ms (#40).   */
/* -------------------------------------------------------------------------- */

export function pageEnter(root: Element): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(root, { opacity: 1, y: 0 });

  // 'base' is 250ms. A route change must never feel like a wait.
  return gsap.timeline().fromTo(
    root,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: duration('base'), ease: ease('out'), clearProps: 'all' },
  );
}

export function pageExit(root: Element): Timeline {
  registerGsap();
  if (prefersReducedMotion()) return settle(root, { opacity: 0 });

  return gsap
    .timeline()
    .to(root, { opacity: 0, y: -8, duration: duration('fast'), ease: ease('out') });
}

/* -------------------------------------------------------------------------- */
/* parallax — layered depth. Subtle, or it reads as a broken layout.           */
/* -------------------------------------------------------------------------- */

export function parallax(target: Element, strength = 0.2): gsap.core.Tween | null {
  registerGsap();
  if (prefersReducedMotion()) return null;

  return gsap.to(target, {
    yPercent: strength * 100,
    ease: 'none',
    scrollTrigger: {
      trigger: target,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
      invalidateOnRefresh: true,
    },
  });
}

/** Recalculate every trigger. Call after content height changes. */
export function refreshScroll(): void {
  ScrollTrigger.refresh();
}
