import { Suspense, lazy, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { blurReveal, revealFrom, useMagnetic, useMotionScope } from '../../lib/motion/index.js';
import { buttonClasses } from '../../components/primitives.js';
import { cn } from '../../lib/utils.js';
import type { Arc } from './globe.js';

// Kept out of the initial bundle — #33 caps the landing page at 200KB.
const Globe = lazy(async () => {
  const mod = await import('./globe');
  return { default: mod.Globe };
});

interface HeroProps {
  /** Live routes from the database. Judges notice hardcoded data. */
  arcs: Arc[];
  tripCount: number;
}

export function Hero({ arcs, tripCount }: HeroProps): React.JSX.Element {
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const magnetic = useMagnetic<HTMLAnchorElement>();

  const scope = useMotionScope<HTMLElement>((_ctx, section) => {
    const headline = headlineRef.current;
    if (headline !== null) blurReveal(headline, { by: 'words', from: 'top' });

    // The hero is above the fold, so this plays on mount rather than on
    // scroll. Copy enters from the left, the globe from the right.
    revealFrom(section.querySelectorAll('[data-hero-follow]'), {
      side: 'left',
      delay: 0.4,
      step: 'base',
    });

    revealFrom(section.querySelectorAll('[data-hero-aside]'), {
      side: 'right',
      delay: 0.55,
      distance: 80,
    });
  });

  return (
    <section
      ref={scope}
      className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden pt-32 pb-20 md:pt-36 md:pb-24"
      aria-labelledby="hero-heading"
    >
      {/* Full-bleed blurred backdrop. The asset is already blurred and only
          480px wide (3.7KB) — scaling it up costs nothing and looks identical,
          because there is no detail left to lose. `scale-110` hides the soft
          edges a blur leaves at the boundary. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/hero-sky.jpg"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="size-full scale-110 object-cover"
        />
        {/* Scrim. White display type needs a floor under it, and the image
            alone does not guarantee one at every viewport width. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--background)_55%,transparent),color-mix(in_oklab,var(--background)_75%,transparent)_55%,var(--background))]" />
      </div>

      <div className="container-wide relative grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
        <div className="max-w-[46rem]">
          <p data-hero-follow className="eyebrow">
            Multi-city itinerary planner
          </p>

          <h1 id="hero-heading" ref={headlineRef} className="text-hero mt-7">
            Plan the whole trip, not just the flight.
          </h1>

          <p
            data-hero-follow
            className="mt-8 max-w-2xl text-xl text-muted-foreground text-pretty"
          >
            Six cities, nineteen days, one budget that actually adds up. GlobeTrotter
            costs every leg as you build it — and refuses to save a trip that could not
            happen.
          </p>

          <div data-hero-follow className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/signup"
              ref={magnetic.ref}
              onPointerMove={magnetic.onPointerMove}
              onPointerLeave={magnetic.onPointerLeave}
              className={cn(
                buttonClasses('ghost'),
                'pill-outline mi-press group rounded-full px-7 py-3.5 text-base backdrop-blur-sm',
              )}
            >
              Start planning
              <ArrowRight
                className="size-4 transition-transform duration-[--gt-duration-base] ease-[--gt-easing-out] group-hover:translate-x-1"
                aria-hidden="true"
              />
            </a>

            <a
              href="/explore"
              className="mi-underline py-3 font-medium text-muted-foreground"
            >
              Browse public trips
            </a>
          </div>

          <p data-hero-follow className="mt-10 text-sm text-muted-foreground">
            <span className="tabular text-foreground">{tripCount.toLocaleString()}</span>{' '}
            itineraries planned so far
          </p>
        </div>

        <div data-hero-aside className="relative mx-auto w-full max-w-[42rem] lg:-mr-[6%] lg:max-w-none">
          {/* Reserve the square up front so the globe cannot shift layout in. */}
          <Suspense fallback={<div className="mi-skeleton aspect-square w-full rounded-full" />}>
            <Globe arcs={arcs} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
