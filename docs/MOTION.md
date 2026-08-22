# Motion

Owner: @harshpansuriya71-sudo · Issue [#40](https://github.com/CODER7657/globetrotter/issues/40) · Code: `apps/web/src/lib/motion/`

Inconsistent animation reads as amateur faster than no animation. This document is the
whole rulebook. If a movement is not described here, it does not ship.

---

## The three rules

1. **No raw values.** Never write a duration in milliseconds or a `cubic-bezier(...)` in a
   component. Both live in `styles/tokens.css` and are read through `lib/motion/tokens.ts`.
2. **No hand-rolled timelines in components.** If you need a movement that does not exist,
   add a preset to `lib/motion/presets.ts` and use it everywhere. One language.
3. **Every timeline is reduced-motion gated.** The presets already do this. If you find
   yourself calling `matchMedia` directly, you are working around the system.

---

## Duration scale

| Token | Value | Use for |
|---|---|---|
| `instant` | 0ms | Button press-down — a delay here feels broken |
| `fast` | 150ms | Hover, focus ring, toast exit, tooltip |
| `base` | 250ms | The default. Page transitions, dropdowns, accordions |
| `slow` | 400ms | Content entering on scroll, modal open |
| `deliberate` | 700ms | Hero headline reveal, KPI count-up. Sparingly |

Anything above `deliberate` is a scroll-scrubbed animation, where the user controls the
clock — those take no duration token at all.

## Easing

| Token | GSAP | CSS | Feel |
|---|---|---|---|
| `out` | `expo.out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default. Fast start, soft landing |
| `inOut` | `power3.inOut` | `cubic-bezier(0.65, 0, 0.35, 1)` | Things that move and stop on screen |
| `spring` | `back.out(1.6)` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Toasts, chips. Overshoot — use rarely |

There is no `ease-in`. Content leaving the screen uses `out` too; `ease-in` on an exit
reads as lag.

## Stagger

`tight` 40ms · `base` 80ms · `loose` 140ms

Over about 12 items a stagger becomes a queue. Cap the count or switch to `tight`.

---

## The presets

```ts
import { fadeUp, stagger, blurReveal, revealFrom, countUp, pageEnter } from '@/lib/motion';
```

| Preset | What it does | Where it belongs |
|---|---|---|
| `fadeUp` | Opacity 0→1, 16px rise | The workhorse. Any single block entering |
| `stagger` | `fadeUp` across a set, sequenced | Card grids, lists, stat rows |
| `splitReveal` | Word-by-word headline reveal | Display type only. One per screen |
| `blurReveal` | Words arrive out of focus and settle | Headlines. **Never** on body copy — see below |
| `revealFrom` | Content slides in from left or right | Section content. Alternate sides down the page |
| `pinReveal` | Pins a section, scrubs children on scroll | Landing narrative sections |
| `countUp` | Animates a number to its value | KPI tiles, cost totals |
| `pageEnter` | Route transition, 250ms | Root route only, never per-screen |

Supporting: `parallax` (subtle depth, ≤0.2 strength), `pageExit`, `refreshScroll`.

### Two rules specific to the newer pair

**`blurReveal` is for headlines only.** `filter: blur()` repaints rather than compositing,
so the cost scales with the animated area. One `h1` or `h2` is free; a paragraph of it will
drop frames on a mid-range laptop. If you want body copy to enter, use `revealFrom`.

**`revealFrom` alternates, it does not decorate.** Pick one side per section and stay with
it — left, then right, then left, going down the page. Mixing sides inside a single section
makes the layout look like it is assembling itself out of spare parts. Centred blocks
(the closing CTA) use `fadeUp` instead: a lateral entrance on a centred element reads as a
mistake.

### Scroll-triggering any preset

Pass a `trigger` and it plays on scroll instead of on mount:

```ts
stagger(cards, { trigger: sectionEl, start: 'top 80%' });
```

Add `scrub: true` to tie progress to scroll position instead of playing once.

---

## React usage

`useMotionScope` scopes selectors to a container and reverts every tween, timeline and
ScrollTrigger on unmount. Use it rather than a bare `useEffect` — leaked ScrollTriggers
after a route change are the single most common cause of a janky build.

```tsx
const ref = useMotionScope<HTMLElement>((_ctx, scope) => {
  blurReveal(scope.querySelector('h1')!, { by: 'words' });
  revealFrom(scope.querySelectorAll('[data-card]'), { side: 'left', trigger: scope });
});

return <section ref={ref}>…</section>;
```

Other hooks: `usePageEnter`, `useScrollSmoother`, `useScrollRefresh`, `useMagnetic`.

---

## Micro-interactions

CSS, not GSAP — they run on the compositor and survive re-renders. Classes come from
`lib/motion/micro.css`:

`.mi-press` button press · `.mi-lift` card hover · `.mi-field` input focus ·
`.mi-toast` toast in/out · `.mi-underline` link underline draw · `.mi-skeleton` loading

GSAP is for choreography. Hover states are never GSAP.

---

## Reduced motion

Gated in **both** layers, deliberately:

- **JS** — every preset checks `prefersReducedMotion()` and snaps to the final state.
  Content is never left invisible or offset.
- **CSS** — a global `@media (prefers-reduced-motion: reduce)` block in `global.css`
  collapses every animation and transition.

`useReducedMotion()` is reactive: flip the OS setting mid-session and the page responds
without a reload.

**Test it every time.** Windows: Settings → Accessibility → Visual effects → Animation
effects. Chrome DevTools: Rendering → Emulate `prefers-reduced-motion`.

---

## Budgets

- Route transition **under 300ms**, start to interactive.
- **60fps on a mid-range laptop.** Profile before merging — a janky landing page is worse
  than a plain one.
- Animate `transform` and `opacity` only. Animating `width`, `height`, `top` or `left`
  triggers layout on every frame; if you need one of those, use `scale` instead.
- `will-change` goes on elements that are actually about to move, and comes off after.
- ScrollSmoother is **marketing routes only**. It fights virtualised lists and the
  drag-to-plan calendar ([#36](https://github.com/CODER7657/globetrotter/issues/36)).

## Accessibility

- Nothing important is conveyed by motion alone.
- `splitReveal` reverts the DOM on completion, so the headline stays one selectable node
  and screen readers do not announce it word by word.
- No parallax on text — only on decorative imagery.
- Nothing auto-plays for longer than 5 seconds without a control.
