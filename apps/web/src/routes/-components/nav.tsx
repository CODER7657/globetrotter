import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ThemeToggle } from '../../components/theme-toggle.js';
import { buttonClasses } from '../../components/primitives.js';
import { gsap, useReducedMotion } from '../../lib/motion/index.js';
import { cn } from '../../lib/utils.js';

const LINKS = [
  { to: '/explore', label: 'Explore' },
  { to: '/#how', label: 'How it works' },
  { to: '/#pricing', label: 'Pricing' },
] as const;

export function Nav(): React.JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const reduced = useReducedMotion();

  const listRef = useRef<HTMLUListElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const pillVisible = useRef(false);

  useEffect(() => {
    const onScroll = (): void => {
      setScrolled(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Mobile menu                                                             */
  /* ---------------------------------------------------------------------- */

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  // Escape closes, and focus goes back to the button that opened it —
  // otherwise a keyboard user is dropped at the top of the document.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Lock the page behind the panel. ScrollSmoother drives scrolling via a
  // transform, so `overflow: hidden` on body does nothing here — the wrapper
  // has to be pinned instead.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const wrapper = document.getElementById('smooth-wrapper');
    const previous = wrapper?.style.pointerEvents ?? '';
    if (wrapper !== null) wrapper.style.pointerEvents = 'none';
    return () => {
      if (wrapper !== null) wrapper.style.pointerEvents = previous;
    };
  }, [menuOpen]);

  // Panel entrance. Height rather than opacity so the bar visibly grows into
  // the panel instead of a sheet appearing over the page.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    if (reduced) {
      gsap.set(panel, { height: menuOpen ? 'auto' : 0, opacity: menuOpen ? 1 : 0 });
      return;
    }
    if (menuOpen) {
      gsap.set(panel, { height: 'auto', opacity: 1 });
      gsap.from(panel, { height: 0, opacity: 0, duration: 0.42, ease: 'expo.out' });
      gsap.from(panel.querySelectorAll('[data-menu-item]'), {
        y: 12,
        opacity: 0,
        duration: 0.4,
        ease: 'expo.out',
        stagger: 0.05,
        delay: 0.06,
      });
    } else {
      gsap.to(panel, { height: 0, opacity: 0, duration: 0.28, ease: 'power3.inOut' });
    }
  }, [menuOpen, reduced]);

  /* ---------------------------------------------------------------------- */
  /* Desktop hover pill                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * A single pill slides between the nav items rather than each item lighting
   * up on its own. One element moving reads as one object; three elements
   * fading reads as three.
   */
  const movePill = useCallback(
    (target: HTMLElement) => {
      const pill = pillRef.current;
      const list = listRef.current;
      if (pill === null || list === null) return;

      const t = target.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      const vars = { x: t.left - l.left, width: t.width, opacity: 1 };

      if (reduced) {
        gsap.set(pill, vars);
      } else if (pillVisible.current) {
        gsap.to(pill, { ...vars, duration: 0.42, ease: 'expo.out' });
      } else {
        gsap.fromTo(
          pill,
          { ...vars, opacity: 0, scaleX: 0.7 },
          { ...vars, scaleX: 1, duration: 0.34, ease: 'back.out(1.7)' },
        );
      }
      pillVisible.current = true;
    },
    [reduced],
  );

  const hidePill = useCallback(() => {
    const pill = pillRef.current;
    if (pill === null) return;
    pillVisible.current = false;
    if (reduced) {
      gsap.set(pill, { opacity: 0 });
      return;
    }
    gsap.to(pill, { opacity: 0, scaleX: 0.85, duration: 0.25, ease: 'power3.out' });
  }, [reduced]);

  // The bar is glass once scrolled, and always while the panel is open —
  // otherwise the menu floats over the page on a transparent strip.
  const glassy = scrolled || menuOpen;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-[--gt-duration-slow] ease-[--gt-easing-out]',
        scrolled ? 'py-2 sm:py-3' : 'py-3 sm:py-5',
      )}
    >
      <div className="container-gt">
        <div
          className={cn(
            'relative transition-all duration-[--gt-duration-slow] ease-[--gt-easing-out]',
            menuOpen ? 'rounded-3xl' : 'rounded-full',
            glassy
              ? [
                  'bg-background/70 backdrop-blur-2xl backdrop-saturate-[1.8]',
                  'shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground)_18%,transparent),inset_0_-1px_0_0_color-mix(in_oklab,var(--background)_60%,transparent),0_8px_32px_-12px_rgb(0_0_0/0.6)]',
                  'ring-1 ring-[color-mix(in_oklab,var(--foreground)_10%,transparent)]',
                ]
              : 'bg-transparent',
          )}
        >
          <div
            className={cn(
              'flex items-center justify-between gap-3 px-4 transition-all sm:gap-6 sm:px-5',
              'duration-[--gt-duration-slow] ease-[--gt-easing-out]',
              scrolled ? 'h-14 sm:h-16' : 'h-16 sm:h-20',
            )}
          >
            <Link
              to="/welcome"
              onClick={closeMenu}
              className="shrink-0 font-display text-xl tracking-tight sm:text-2xl"
            >
              Globe<span className="text-muted-foreground">Trotter</span>
            </Link>

            <ul
              ref={listRef}
              className="relative hidden items-center gap-1 md:flex"
              onMouseLeave={hidePill}
            >
              <span
                ref={pillRef}
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-10 -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--foreground)_12%,transparent)] opacity-0 will-change-transform"
              />
              {LINKS.map((link) => (
                <li key={link.to}>
                  {/* Plain anchors: these targets are owned by other issues and
                      are not in the route tree yet. Swap to <Link to=…> as they
                      land. */}
                  <a
                    href={link.to}
                    onMouseEnter={(event) => {
                      movePill(event.currentTarget);
                    }}
                    onFocus={(event) => {
                      movePill(event.currentTarget);
                    }}
                    className="relative z-10 block rounded-full px-4 py-2 text-base text-muted-foreground transition-colors duration-[--gt-duration-fast] hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>

              <a
                href="/login"
                className="hidden rounded-full px-3 py-2 text-base font-medium text-muted-foreground transition-colors hover:text-foreground md:block"
              >
                Log in
              </a>

              <a
                href="/signup"
                className={cn(
                  buttonClasses('ghost'),
                  'pill-outline mi-press hidden rounded-full px-6 py-2.5 text-base md:inline-flex',
                )}
              >
                Start planning
              </a>

              {/* The three lines. Below md this is the only way into the nav,
                  so it is a real button with real state, not an icon. */}
              <button
                ref={toggleRef}
                type="button"
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                onClick={() => {
                  setMenuOpen((open) => !open);
                }}
                className="mi-press grid size-11 shrink-0 place-items-center rounded-full text-foreground md:hidden"
              >
                <span aria-hidden="true" className="relative block h-4 w-6">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'absolute left-0 block h-0.5 w-6 rounded-full bg-current',
                        'transition-all duration-[--gt-duration-base] ease-[--gt-easing-out]',
                        // Top and bottom bars rotate into an X; the middle one
                        // fades, so the three lines become a close affordance.
                        i === 0 && (menuOpen ? 'top-1/2 -translate-y-1/2 rotate-45' : 'top-0'),
                        i === 1 && (menuOpen ? 'top-1/2 -translate-y-1/2 opacity-0' : 'top-1/2 -translate-y-1/2'),
                        i === 2 && (menuOpen ? 'top-1/2 -translate-y-1/2 -rotate-45' : 'bottom-0'),
                      )}
                    />
                  ))}
                </span>
              </button>
            </div>
          </div>

          {/* Mobile panel. Rendered always so the height tween has something to
              animate; `invisible` keeps it out of the tab order when closed. */}
          <div
            id="mobile-menu"
            ref={panelRef}
            className={cn(
              'overflow-hidden md:hidden',
              menuOpen ? 'visible' : 'invisible h-0 opacity-0',
            )}
          >
            <nav aria-label="Mobile" className="border-t border-border px-4 pb-5 pt-4">
              <ul className="flex flex-col gap-1">
                {LINKS.map((link) => (
                  <li key={link.to} data-menu-item>
                    <a
                      href={link.to}
                      onClick={closeMenu}
                      tabIndex={menuOpen ? 0 : -1}
                      className="block rounded-[var(--radius-md)] px-3 py-3 text-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
                <li data-menu-item>
                  <a
                    href="/login"
                    onClick={closeMenu}
                    tabIndex={menuOpen ? 0 : -1}
                    className="block rounded-[var(--radius-md)] px-3 py-3 text-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Log in
                  </a>
                </li>
              </ul>

              <div data-menu-item className="mt-4 flex items-center gap-3">
                <a
                  href="/signup"
                  onClick={closeMenu}
                  tabIndex={menuOpen ? 0 : -1}
                  className={cn(
                    buttonClasses('ghost'),
                    'pill-outline mi-press flex-1 rounded-full px-6 py-3 text-base',
                  )}
                >
                  Start planning
                </a>
                <ThemeToggle />
              </div>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
