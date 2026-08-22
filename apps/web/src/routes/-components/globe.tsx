import { useCallback, useEffect, useRef, useState } from 'react';
import createGlobe from 'cobe';
import type { COBEOptions } from 'cobe';
import { gsap, useReducedMotion } from '../../lib/motion/index.js';
import { cn } from '../../lib/utils.js';

export interface Arc {
  /** [latitude, longitude] */
  from: [number, number];
  to: [number, number];
}

interface GlobeProps {
  /** City pairs drawn as markers. Sourced from real trips, never hardcoded. */
  arcs: Arc[];
  className?: string | undefined;
}

/**
 * Velorah is monochrome — colour comes from imagery, never from UI. The globe
 * is UI, so it stays neutral and markers are simply brighter than the
 * landmass. Cobe takes raw [r, g, b] floats in 0–1, not CSS colours.
 */
const MARKER: [number, number, number] = [1, 1, 1];

const IDLE_SPEED = 0.0035;
const FOCUSED_SPEED = 0.011;

/**
 * The hero globe. Cobe is ~3KB of WebGL, code-split out of the initial bundle
 * by the `globe` manualChunk so the landing budget (#33) holds.
 *
 * Click to focus: the sphere scales up and spins faster, and can be dragged.
 * Click again or press Escape to return.
 *
 * Fallbacks: reduced motion renders without spinning; no WebGL falls back to
 * a static SVG that still reads as a globe.
 */
export function Globe({ arcs, className }: GlobeProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();

  // Interaction state lives in refs so a pointer move never re-renders.
  const pointerInteracting = useRef<number | null>(null);
  const pointerMovement = useRef(0);
  const rotation = useRef(0);
  const hovering = useRef(false);
  const speed = useRef(IDLE_SPEED);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    // Cobe projects the sphere against the buffer size it is handed, so the
    // buffer and the projection MUST agree. Feeding it a size that does not
    // match the canvas backing store draws the sphere at the wrong scale and
    // crops it — which is exactly what "half a globe" looks like.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let size = Math.round(canvas.offsetWidth * dpr);

    // offsetWidth is 0 until layout runs, and the hero grid settles a frame
    // late. Observing means a stale size is never baked in.
    const observer = new ResizeObserver(() => {
      const next = Math.round(canvas.offsetWidth * dpr);
      if (next > 0) size = next;
    });
    observer.observe(canvas);

    let globe: ReturnType<typeof createGlobe> | null = null;

    try {
      const options: COBEOptions = {
        devicePixelRatio: dpr,
        width: size,
        height: size,
        phi: 0,
        theta: 0.24,
        dark: 1,
        diffuse: 1.5,
        // Denser sampling gives readable coastlines rather than a vague dot
        // field. The continents have to be recognisable at hero size.
        mapSamples: 42_000,
        mapBrightness: 8,
        baseColor: [0.2, 0.2, 0.23],
        markerColor: MARKER,
        glowColor: [0.2, 0.2, 0.23],
        markers: arcs.flatMap((arc) => [
          { location: arc.from, size: 0.05 },
          { location: arc.to, size: 0.05 },
        ]),
        onRender: (state: Record<string, unknown>) => {
          if (pointerInteracting.current === null && !hovering.current && !reduced) {
            rotation.current += speed.current;
          }
          state['phi'] = rotation.current + pointerMovement.current;
          state['width'] = size;
          state['height'] = size;
        },
      };
      globe = createGlobe(canvas, options);

      requestAnimationFrame(() => {
        canvas.style.opacity = '1';
      });
    } catch {
      // No WebGL, or context creation failed. Show the static fallback.
      setFailed(true);
    }

    return () => {
      observer.disconnect();
      globe?.destroy();
    };
  }, [arcs, reduced]);

  // Focus and unfocus: scale the shell and change spin speed together.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;

    speed.current = focused && !reduced ? FOCUSED_SPEED : IDLE_SPEED;

    if (reduced) {
      gsap.set(shell, { scale: focused ? 1.1 : 1 });
      return;
    }
    gsap.to(shell, {
      scale: focused ? 1.35 : 1,
      duration: focused ? 0.8 : 0.55,
      ease: focused ? 'expo.out' : 'power3.inOut',
    });
  }, [focused, reduced]);

  // Escape always gets you back out.
  useEffect(() => {
    if (!focused) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFocused(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [focused]);

  const toggle = useCallback(() => {
    setFocused((value) => !value);
  }, []);

  if (failed) return <GlobeFallback className={className} />;

  return (
    <div
      className={cn(
        'relative aspect-square w-full',
        // Lift above the hero copy while focused, so the scaled sphere is not
        // clipped by the neighbouring grid column.
        focused ? 'z-20' : 'z-0',
        className,
      )}
    >
      <div ref={shellRef} className="relative size-full will-change-transform">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={focused}
          aria-label={
            focused ? 'Shrink the globe of planned routes' : 'Enlarge the globe of planned routes'
          }
          className="absolute inset-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-8"
          style={{ cursor: focused ? 'grab' : 'zoom-in' }}
          onPointerDown={(event) => {
            if (!focused) return;
            pointerInteracting.current = event.clientX - pointerMovement.current;
            event.currentTarget.style.cursor = 'grabbing';
          }}
          onPointerUp={(event) => {
            pointerInteracting.current = null;
            event.currentTarget.style.cursor = focused ? 'grab' : 'zoom-in';
          }}
          onPointerLeave={(event) => {
            pointerInteracting.current = null;
            hovering.current = false;
            event.currentTarget.style.cursor = focused ? 'grab' : 'zoom-in';
          }}
          onPointerMove={(event) => {
            if (pointerInteracting.current === null) return;
            pointerMovement.current = (event.clientX - pointerInteracting.current) / 200;
          }}
          onPointerEnter={() => {
            hovering.current = true;
          }}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cn(
              'size-full opacity-0 transition-opacity duration-700',
              // The atmospheric glow fills the canvas rectangle, which reads as
              // a lighter square against the page. Fading the corners to
              // transparent is what makes the sphere sit ON the page.
              '[mask-image:radial-gradient(circle_at_50%_50%,#000_56%,transparent_71%)]',
              '[-webkit-mask-image:radial-gradient(circle_at_50%_50%,#000_56%,transparent_71%)]',
            )}
          />
        </button>
      </div>

      <p className="sr-only">
        An interactive globe showing {arcs.length} routes between cities currently being
        planned in GlobeTrotter.
      </p>
    </div>
  );
}

/** Static, and deliberately still elegant. A broken hero is worse than a plain one. */
function GlobeFallback({ className }: { className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('relative grid aspect-square w-full place-items-center', className)}>
      <svg viewBox="0 0 200 200" role="img" aria-label="Stylised globe" className="w-3/4">
        <defs>
          <radialGradient id="gt-globe-glow" cx="50%" cy="42%" r="58%">
            <stop offset="0%" stopColor="var(--muted)" />
            <stop offset="100%" stopColor="var(--background)" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="76" fill="url(#gt-globe-glow)" />
        <circle cx="100" cy="100" r="76" fill="none" stroke="var(--border)" strokeWidth="1" />
        {[26, 50, 66].map((ry) => (
          <ellipse
            key={ry}
            cx="100"
            cy="100"
            rx="76"
            ry={ry}
            fill="none"
            stroke="var(--border)"
            strokeWidth="0.75"
          />
        ))}
        <line x1="100" y1="24" x2="100" y2="176" stroke="var(--border)" strokeWidth="0.75" />
        {[
          [72, 66],
          [128, 88],
          [96, 132],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" fill="var(--primary)" />
        ))}
      </svg>
    </div>
  );
}
