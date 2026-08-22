import { WifiOff } from 'lucide-react';
import { blurReveal, countUp, fadeUp, revealFrom, useMotionScope } from '../../lib/motion/index.js';
import { buttonClasses } from '../../components/primitives.js';
import { cn } from '../../lib/utils.js';
import { CardCarousel } from './card-carousel.js';
import type { CarouselCard } from './card-carousel.js';

/* -------------------------------------------------------------------------- */
/* Trust bar                                                                   */
/* -------------------------------------------------------------------------- */

export function TrustBar(): React.JSX.Element {
  const scope = useMotionScope<HTMLDivElement>((_ctx, el) => {
    fadeUp(el, { trigger: el });
  });

  return (
    <div ref={scope} className="border-y border-border bg-card/40">
      <div className="container-gt flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-5 text-sm text-muted-foreground">
        <span>Postgres-native</span>
        <Dot />
        <span>Works offline</span>
        <Dot />
        <span>Real-time collaborative</span>
        <Dot />
        <span>No API keys required</span>
      </div>
    </div>
  );
}

function Dot(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="size-1 rounded-full bg-muted-foreground/40" />
  );
}

/* -------------------------------------------------------------------------- */
/* Value props                                                                 */
/* -------------------------------------------------------------------------- */

const VALUES: CarouselCard[] = [
  {
    id: 'budget',
    title: 'A budget that keeps up',
    body: 'Every stop, activity and transfer rolls into one total as you build. Change a date and the number moves before you finish clicking.',
    mesh: {
      base: '--gt-color-gradient-ember-base',
      blobs: [
        { x: 0.24, y: 0.2, r: 0.72, color: '--gt-color-gradient-ember-1' },
        { x: 0.72, y: 0.34, r: 0.62, color: '--gt-color-gradient-ember-2' },
        { x: 0.46, y: 0.82, r: 0.7, color: '--gt-color-gradient-ember-3' },
        { x: 0.86, y: 0.88, r: 0.44, color: '--gt-color-gradient-ember-4' },
      ],
    },
  },
  {
    id: 'integrity',
    title: 'Impossible trips get rejected',
    body: 'Overlapping stops and backwards dates are refused by the database itself, not by a form validator you can navigate around.',
    mesh: {
      base: '--gt-color-gradient-prism-base',
      blobs: [
        { x: 0.2, y: 0.24, r: 0.6, color: '--gt-color-gradient-prism-1' },
        { x: 0.74, y: 0.2, r: 0.58, color: '--gt-color-gradient-prism-2' },
        { x: 0.28, y: 0.74, r: 0.62, color: '--gt-color-gradient-prism-3' },
        { x: 0.8, y: 0.76, r: 0.6, color: '--gt-color-gradient-prism-4' },
        { x: 0.5, y: 0.5, r: 0.46, color: '--gt-color-gradient-prism-5' },
      ],
    },
  },
  {
    id: 'collab',
    title: 'Plan it together, live',
    body: 'Share a trip and watch edits land as they happen. No refresh, no merge conflicts, no arguing over which version is current.',
    mesh: {
      base: '--gt-color-gradient-mist-base',
      blobs: [
        { x: 0.3, y: 0.22, r: 0.68, color: '--gt-color-gradient-mist-1' },
        { x: 0.76, y: 0.42, r: 0.56, color: '--gt-color-gradient-mist-2' },
        { x: 0.4, y: 0.84, r: 0.6, color: '--gt-color-gradient-mist-3' },
        { x: 0.86, y: 0.86, r: 0.4, color: '--gt-color-gradient-mist-4' },
      ],
    },
  },
];

export function ValueProps(): React.JSX.Element {
  const scope = useMotionScope<HTMLElement>((_ctx, section) => {
    const heading = section.querySelector('h2');
    if (heading !== null) blurReveal(heading, { by: 'words', trigger: section });

    revealFrom(section.querySelectorAll('[data-head]:not(h2)'), {
      side: 'left',
      trigger: section,
    });
    // The deck arrives as one object; its own 3D layout takes over from there,
    // so this is a single fade rather than a per-card stagger.
    fadeUp(section.querySelectorAll('[data-deck]'), {
      trigger: section,
      start: 'top 70%',
    });
  });

  return (
    <section
      ref={scope}
      className="relative overflow-hidden py-24 md:py-32"
      aria-labelledby="values-heading"
    >
      <div className="container-gt max-w-2xl">
        <p data-head className="eyebrow">
          Why it is different
        </p>
        <h2 data-head id="values-heading" className="text-section mt-5">
          Most planners are a shared document with better fonts.
        </h2>
        <p data-head className="mt-5 text-lg text-muted-foreground text-pretty">
          GlobeTrotter actually understands what a trip is — so it can do the arithmetic,
          catch the contradictions, and keep everyone on the same page.
        </p>
      </div>

      <div data-deck className="mt-20">
        <CardCarousel cards={VALUES} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Process narrative — three beats, revealed on scroll                        */
/* -------------------------------------------------------------------------- */

const BEATS = [
  {
    step: '01',
    title: 'Drop in the cities',
    body: 'Search by name, by region, or by the kind of place you are after. Add it, and the itinerary reshapes around it.',
  },
  {
    step: '02',
    title: 'Fill in the days',
    body: 'Drag activities onto a day. The cost updates, the schedule checks itself, and conflicts surface as you go.',
  },
  {
    step: '03',
    title: 'Share the link',
    body: 'One URL, readable by anyone, works on a phone in an airport with no signal. They can copy it and make it theirs.',
  },
] as const;

export function ProcessNarrative(): React.JSX.Element {
  const scope = useMotionScope<HTMLElement>((_ctx, section) => {
    // Deliberately NOT pinned. A pinned section goes `position: fixed` for the
    // length of its scrub, and the section after it scrolls up into that same
    // band — with a translucent background the two render on top of each
    // other. The Velorah reference does not pin either; its sections are
    // straight scroll reveals, which is what this is now.
    const heading = section.querySelector('h2');
    if (heading !== null) blurReveal(heading, { by: 'words', trigger: section });

    revealFrom(section.querySelectorAll('[data-beat]'), {
      side: 'right',
      trigger: section,
      start: 'top 70%',
      step: 'loose',
    });
  });

  return (
    <section ref={scope} className="bg-card" aria-labelledby="how-heading" id="how">
      <div className="container-gt py-24 md:py-32">
        <p className="eyebrow">How it works</p>
        <h2 id="how-heading" className="text-section mt-5 max-w-3xl">
          Three moves, and the trip plans itself.
        </h2>

        <ol className="mt-16 grid gap-10 md:grid-cols-3">
          {BEATS.map((beat) => (
            <li key={beat.step} data-beat>
              <span className="tabular text-sm text-primary">{beat.step}</span>
              <h3 className="mt-4 font-sans text-xl font-semibold tracking-tight">
                {beat.title}
              </h3>
              <p className="mt-3 text-muted-foreground">{beat.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Live counters — real numbers from the API, never hardcoded                  */
/* -------------------------------------------------------------------------- */

export interface Stats {
  cities: number;
  activities: number;
  trips: number;
}

export function Counters({ stats }: { stats: Stats }): React.JSX.Element {
  const scope = useMotionScope<HTMLElement>(
    (_ctx, section) => {
      section.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
        const raw = el.dataset['count'];
        if (raw === undefined) return;
        countUp(el, { to: Number(raw), trigger: section, start: 'top 75%' });
      });
    },
    [stats.cities, stats.activities, stats.trips],
  );

  const items: Array<[string, number]> = [
    ['Cities', stats.cities],
    ['Activities', stats.activities],
    ['Trips planned', stats.trips],
  ];

  return (
    <section ref={scope} className="container-gt py-24" aria-label="GlobeTrotter by the numbers">
      <dl className="grid gap-10 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="text-center">
            {/* Starts at the real value so the number is correct with JS off
                and for anyone on reduced motion. */}
            <dd data-count={value} className="tabular text-[clamp(2.5rem,4vw,4rem)]">
              {value.toLocaleString()}
            </dd>
            <dt className="mt-3 text-sm text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Offline beat — the aha moment (#31)                                         */
/* -------------------------------------------------------------------------- */

export function OfflineBeat(): React.JSX.Element {
  const scope = useMotionScope<HTMLElement>((_ctx, section) => {
    const heading = section.querySelector('h2');
    if (heading !== null) blurReveal(heading, { by: 'words', trigger: section });

    revealFrom(section.querySelectorAll('[data-reveal]:not(h2)'), {
      side: 'left',
      trigger: section,
    });
  });

  return (
    <section ref={scope} className="container-gt py-24 md:py-32">
      <div className="rounded-xl border border-border bg-card p-10 md:p-16">
        <span
          data-reveal
          className="grid size-12 place-items-center rounded-md bg-primary/10 text-primary"
        >
          <WifiOff className="size-6" aria-hidden="true" />
        </span>
        <h2 data-reveal className="text-section mt-8 max-w-3xl">
          It still works when the signal does not.
        </h2>
        <p data-reveal className="mt-5 max-w-xl text-lg text-muted-foreground text-pretty">
          Your itinerary is cached on the device. Open it on a plane, in a tunnel, or on
          airport wifi that has given up — and edit it. Changes sync when you land.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing CTA                                                                 */
/* -------------------------------------------------------------------------- */

export function ClosingCta(): React.JSX.Element {
  const scope = useMotionScope<HTMLElement>((_ctx, section) => {
    const heading = section.querySelector('h2');
    if (heading !== null) blurReveal(heading, { by: 'words', trigger: section });

    // Centred content, so this one rises rather than sliding — a lateral
    // entrance on a centred block reads as a mistake.
    fadeUp(section.querySelectorAll('[data-reveal]:not(h2)'), { trigger: section });
  });

  return (
    <section ref={scope} className="relative overflow-hidden py-28 md:py-40">
      <div
        aria-hidden="true"
        className="aurora-burst pointer-events-none absolute inset-0 opacity-70"
      />
      <div className="container-gt relative text-center">
        <h2 data-reveal className="text-section mx-auto max-w-3xl">
          Where are you going?
        </h2>
        <p data-reveal className="mx-auto mt-5 max-w-lg text-lg text-muted-foreground">
          Start with one city. Add the rest as you figure them out.
        </p>
        <div data-reveal className="mt-10">
          <a
            href="/signup"
            className={cn(
              buttonClasses('ghost'),
              'pill-outline mi-press rounded-full px-8 py-3.5 text-base backdrop-blur-sm',
            )}
          >
            Plan your first trip
          </a>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-border">
      <div className="container-gt flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display text-lg">
          Globe<span className="text-primary">Trotter</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Built for the Odoo Hackathon, 2026.
        </p>
      </div>
    </footer>
  );
}
