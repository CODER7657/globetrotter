import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { gsap, useReducedMotion } from '../../lib/motion/index.js';
import { cn } from '../../lib/utils.js';
import { extractPalette, paintMesh, toRgbString } from './mesh-gradient.js';
import type { MeshSpec } from './mesh-gradient.js';

export interface CarouselCard {
  id: string;
  title: string;
  body: string;
  mesh: MeshSpec;
}

interface CardCarouselProps {
  cards: CarouselCard[];
  className?: string | undefined;
}

/**
 * Where a card sits, given its distance from the active one.
 *
 * The -50/-50 is the centring offset. It has to be part of these values
 * rather than a `-translate-x-1/2` class, because GSAP writes the whole
 * `transform` property and would overwrite any Tailwind translate — leaving
 * every card half its own width to the right of where it belongs.
 */
function transformFor(distance: number, narrow: boolean): gsap.TweenVars {
  const side = Math.sign(distance);
  const depth = Math.abs(distance);

  const centred = { yPercent: -50, transformOrigin: '50% 50%' };

  if (depth === 0) {
    return { ...centred, xPercent: -50, z: 0, rotateY: 0, scale: 1, opacity: 1, zIndex: 30 };
  }
  // On a phone the deck has to stay inside 375px, so the neighbours tuck in
  // much closer and sit further back. Spreading them at desktop offsets pushes
  // them off-screen, which is what makes a 3D carousel feel broken on mobile.
  if (depth === 1) {
    return {
      ...centred,
      xPercent: -50 + side * (narrow ? 40 : 62),
      z: narrow ? -220 : -170,
      rotateY: side * (narrow ? -28 : -34),
      scale: narrow ? 0.8 : 0.86,
      opacity: 0.85,
      zIndex: 20,
    };
  }
  return {
    ...centred,
    xPercent: -50 + side * (narrow ? 68 : 104),
    z: narrow ? -400 : -340,
    rotateY: side * (narrow ? -36 : -44),
    scale: narrow ? 0.64 : 0.72,
    opacity: 0.4,
    zIndex: 10,
  };
}

const AUTOPLAY_MS = 4200;

/**
 * A 3D card carousel whose ambient light is sampled from the active card.
 *
 * The faces are canvases painted with mesh gradients; the glow behind them is
 * read back out of those same pixels, so the page picks up the colour of
 * whatever is centred. Velorah's UI is monochrome by rule — this is the one
 * place colour enters, and it enters as light off the artwork rather than as
 * a styled surface.
 */
export function CardCarousel({ cards, className }: CardCarouselProps): React.JSX.Element {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const paused = useRef(false);
  const placed = useRef(false);

  // Reactive rather than measured once: rotating a phone changes which layout
  // the deck needs, and a stale value leaves cards parked off-screen.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const sync = (): void => {
      setNarrow(query.matches);
    };
    sync();
    query.addEventListener('change', sync);
    return () => {
      query.removeEventListener('change', sync);
    };
  }, []);

  const count = cards.length;

  const step = useCallback(
    (delta: number) => {
      setActive((current) => (current + delta + count) % count);
    },
    [count],
  );

  // Paint the faces once. Nothing here depends on the active index.
  useEffect(() => {
    cards.forEach((card, index) => {
      const canvas = canvasRefs.current[index];
      if (canvas != null) paintMesh(canvas, card.mesh);
    });
  }, [cards]);

  // Lay the deck out in 3D whenever the active card changes.
  useEffect(() => {
    cardRefs.current.forEach((el, index) => {
      if (el == null) return;

      // Shortest way round the ring, so stepping past the end does not send
      // cards flying the long way across the stage.
      let distance = index - active;
      if (distance > count / 2) distance -= count;
      if (distance < -count / 2) distance += count;

      const vars = transformFor(distance, narrow);

      // First pass places the deck outright. Tweening from an untransformed
      // start would slide every card in from the stage centre on mount.
      if (reduced || !placed.current) {
        gsap.set(el, vars);
        return;
      }
      gsap.to(el, { ...vars, duration: 0.75, ease: 'expo.out' });
    });
    placed.current = true;
  }, [active, count, reduced, narrow]);

  // Sample the active face and drive the ambient glow from it.
  useEffect(() => {
    const canvas = canvasRefs.current[active];
    const glow = glowRef.current;
    if (canvas == null || glow == null) return;

    const palette = extractPalette(canvas, 3);
    if (palette.length === 0) return;

    const [first, second, third] = palette;
    const layers = [
      first != null
        ? `radial-gradient(48% 60% at 50% 46%, ${toRgbString(first)}, transparent 68%)`
        : null,
      second != null
        ? `radial-gradient(42% 52% at 26% 62%, ${toRgbString(second)}, transparent 70%)`
        : null,
      third != null
        ? `radial-gradient(40% 50% at 74% 60%, ${toRgbString(third)}, transparent 70%)`
        : null,
    ].filter((layer): layer is string => layer !== null);

    // Cross-fade rather than swapping: a hard cut between two saturated
    // washes is far more noticeable than the card movement itself.
    if (reduced) {
      gsap.set(glow, { backgroundImage: layers.join(', '), opacity: 0.3 });
      return;
    }
    gsap
      .timeline()
      .to(glow, { opacity: 0, duration: 0.25, ease: 'power2.out' })
      .set(glow, { backgroundImage: layers.join(', ') })
      .to(glow, { opacity: 0.34, duration: 0.7, ease: 'power2.out' });
  }, [active, reduced]);

  // Autoplay, paused on hover or keyboard focus.
  useEffect(() => {
    if (reduced) return undefined;
    const id = window.setInterval(() => {
      if (!paused.current) step(1);
    }, AUTOPLAY_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [reduced, step]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    },
    [step],
  );

  const activeCard = cards[active];

  return (
    <div className={cn('relative', className)}>
      {/* Extracted ambient light. Decorative, sits behind the deck. */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 opacity-0 blur-3xl"
      />

      <div
        ref={stageRef}
        role="group"
        aria-roledescription="carousel"
        aria-label="What makes GlobeTrotter different"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseEnter={() => {
          paused.current = true;
        }}
        onMouseLeave={() => {
          paused.current = false;
        }}
        onFocus={() => {
          paused.current = true;
        }}
        onBlur={() => {
          paused.current = false;
        }}
        className="relative mx-auto h-[24rem] w-full max-w-[62rem] rounded-lg focus-visible:outline-2 focus-visible:outline-offset-8 sm:h-[30rem]"
        style={{ perspective: '1400px' }}
      >
        {cards.map((card, index) => {
          const isActive = index === active;
          return (
            <div
              key={card.id}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              // Non-active cards are decorative duplicates of content that is
              // announced once below, so they stay out of the a11y tree.
              aria-hidden={!isActive}
              // Centring is applied by GSAP (see transformFor), not by a
              // translate class — GSAP owns this element's transform.
              className="absolute left-1/2 top-1/2 h-[20rem] w-[13.5rem] sm:h-[25rem] sm:w-[19rem]"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <button
                type="button"
                tabIndex={isActive ? 0 : -1}
                onClick={() => {
                  if (!isActive) setActive(index);
                }}
                aria-label={isActive ? undefined : `Show ${card.title}`}
                className={cn(
                  'group size-full overflow-hidden rounded-xl text-left',
                  'shadow-[0_24px_60px_-20px_rgb(0_0_0/0.75)] ring-1 ring-[color-mix(in_oklab,var(--foreground)_14%,transparent)]',
                  isActive ? 'cursor-default' : 'cursor-pointer',
                )}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[index] = el;
                  }}
                  aria-hidden="true"
                  className="absolute inset-0 size-full"
                />
                {/* Specular sheen — the highlight that reads as a glossy tile. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-[linear-gradient(147deg,rgb(255_255_255/0.30),rgb(255_255_255/0.06)_18%,transparent_34%)]"
                />
                {/* Scrim so the copy stays legible over any part of the mesh. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-3/5 bg-[linear-gradient(to_top,rgb(0_0_0/0.82),rgb(0_0_0/0.35)_45%,transparent)]"
                />

                <div className="absolute inset-x-0 bottom-0 p-6">
                  <h3 className="font-sans text-lg font-semibold tracking-tight text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/80">{card.body}</p>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="mt-10 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => {
            step(-1);
          }}
          aria-label="Previous card"
          className="mi-press grid size-11 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2" role="tablist" aria-label="Choose a card">
          {cards.map((card, index) => (
            <button
              key={card.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={card.title}
              onClick={() => {
                setActive(index);
              }}
              className={cn(
                'h-1.5 rounded-full transition-all duration-[--gt-duration-base] ease-[--gt-easing-out]',
                index === active
                  ? 'w-8 bg-foreground'
                  : 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground',
              )}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            step(1);
          }}
          aria-label="Next card"
          className="mi-press grid size-11 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* The carousel is decorative motion; this is what actually gets
          announced when the active card changes. */}
      <p aria-live="polite" className="sr-only">
        {activeCard != null ? `${activeCard.title}. ${activeCard.body}` : ''}
      </p>
    </div>
  );
}
