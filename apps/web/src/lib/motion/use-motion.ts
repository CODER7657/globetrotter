/**
 * React bindings for the motion presets.
 *
 * `useGSAP` from @gsap/react handles the cleanup that hand-written effects get
 * wrong: every tween, timeline and ScrollTrigger created inside the callback is
 * reverted on unmount, which is what keeps route changes from leaking triggers.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, ScrollSmoother, ScrollTrigger, registerGsap } from './gsap.js';
import { prefersReducedMotion, useReducedMotion } from './reduced-motion.js';
import { pageEnter, refreshScroll } from './presets.js';

/** Fonts loaded, or no Font Loading API to ask (assume ready and proceed). */
function fontsReady(): boolean {
  if (typeof document === 'undefined') return true;
  return document.fonts === undefined || document.fonts.status === 'loaded';
}

/**
 * Resolves when the webfonts have loaded, or after a hard cap — whichever
 * comes first.
 *
 * The cap is not optional. Reveal presets start their targets at opacity 0,
 * so if `fonts.ready` never settles — a blocked font host, a browser quirk —
 * waiting on it forever would leave the page permanently blank. Late, correct
 * metrics are worth waiting for; invisible content is not.
 */
const FONT_WAIT_CAP_MS = 1200;

let fontsSettled: Promise<void> | null = null;

function whenFontsSettled(): Promise<void> {
  fontsSettled ??= new Promise<void>((resolve) => {
    if (fontsReady()) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, FONT_WAIT_CAP_MS);
    void document.fonts.ready.then(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
  return fontsSettled;
}

/**
 * Run a GSAP callback scoped to a container ref. Selector strings inside the
 * callback resolve within that container only, so two instances of the same
 * component never animate each other.
 *
 * @example
 * const ref = useMotionScope<HTMLElement>((ctx, scope) => {
 *   stagger(scope.querySelectorAll('[data-card]'), { trigger: scope });
 * });
 */
export function useMotionScope<T extends HTMLElement>(
  callback: (context: gsap.Context, scope: T) => void,
  deps: readonly unknown[] = [],
): RefObject<T | null> {
  const scope = useRef<T | null>(null);

  useGSAP(
    (context) => {
      registerGsap();
      const el = scope.current;
      if (el === null) return;

      // SplitText measures line breaks at the moment it runs. Do that while a
      // fallback face is still active and it records the fallback's wrapping,
      // then the real face swaps in and the text re-wraps mid-animation.
      // Waiting for the webfonts means every measurement is taken against the
      // metrics the user will actually see.
      if (fontsReady()) {
        callback(context, el);
        return;
      }

      let cancelled = false;
      // `context.add` runs the work inside the GSAP context, so animations
      // created after this tick are still reverted on unmount.
      void whenFontsSettled().then(() => {
        if (cancelled) return;
        context.add(() => {
          callback(context, el);
        });
      });

      return () => {
        cancelled = true;
      };
    },
    { scope, dependencies: [...deps] },
  );

  return scope;
}

/**
 * Play the page-enter transition on mount. Called once by the root route
 * component — individual screens should not add their own entrance.
 */
export function usePageEnter<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (el === null) return;
      pageEnter(el);
    },
    { scope: ref },
  );

  return ref;
}

/**
 * Inertial smooth scrolling for the marketing pages.
 *
 * Never enabled inside the app shell: smooth scroll fights virtualised lists
 * and the drag-to-plan calendar (#36). Marketing routes only.
 */
export function useScrollSmoother(enabled = true): void {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!enabled || reduced) return undefined;
    registerGsap();

    // ScrollSmoother needs its wrapper/content pair present in the DOM.
    if (document.getElementById('smooth-wrapper') === null) return undefined;

    // StrictMode mounts twice in dev. Without this guard the second create()
    // runs against a DOM the first one already transformed, which is what
    // leaves duplicate pin-spacers and a stuck scroll offset.
    // Note `get()` returns null, not undefined, when nothing is registered.
    const existing = ScrollSmoother.get();
    if (existing != null) existing.kill();

    const smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      // Seconds the content takes to catch up with the real scroll position.
      // ~1.5 is the point where it reads as weighted glide; push much past
      // this and it stops feeling smooth and starts feeling laggy.
      smooth: 1.5,
      // Touch devices already have native momentum. Adding our own on top
      // fights it, so keep it light.
      smoothTouch: 0.1,
      effects: true,
      normalizeScroll: true,
      ignoreMobileResize: true,
    });

    // A landing page opens at the top. The browser restores the previous
    // scroll position on reload and the smoother applies it as a transform,
    // dropping the visitor into the middle of the hero. Taking manual control
    // is the only reliable fix — restoration otherwise re-applies *after* we
    // reset, so resetting alone loses the race.
    const priorRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    smoother.scrollTop(0);

    // Every trigger is measured against the pre-webfont layout. Instrument
    // Serif swapping in reflows the headline and invalidates all of them, so
    // remeasure once the fonts have actually landed — then pin to the top
    // again, because refreshing restores the scroll position it measured.
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      ScrollTrigger.refresh();
      smoother.scrollTop(0);
    });

    return () => {
      cancelled = true;
      history.scrollRestoration = priorRestoration;
      smoother.kill();
    };
  }, [enabled, reduced]);
}

/**
 * Refresh ScrollTrigger once async content has painted. Data-driven sections
 * change height after they resolve, which leaves every trigger below them
 * measuring against a stale layout.
 */
export function useScrollRefresh(deps: readonly unknown[]): void {
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const id = window.requestAnimationFrame(() => {
      refreshScroll();
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Pointer-following magnetic pull, for the primary CTA only.
 * Returns a ref plus the handlers to spread onto the element.
 */
export function useMagnetic<T extends HTMLElement>(strength = 0.35) {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();

  const onPointerMove = useCallback(
    (event: React.PointerEvent<T>) => {
      const el = ref.current;
      if (el === null || reduced) return;
      const rect = el.getBoundingClientRect();
      const x = event.clientX - (rect.left + rect.width / 2);
      const y = event.clientY - (rect.top + rect.height / 2);
      gsap.to(el, { x: x * strength, y: y * strength, duration: 0.4, ease: 'power3.out' });
    },
    [reduced, strength],
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (el === null || reduced) return;
    gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
  }, [reduced]);

  return { ref, onPointerMove, onPointerLeave };
}
