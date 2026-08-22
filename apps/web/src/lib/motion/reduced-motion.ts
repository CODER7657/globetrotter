/**
 * The single reduced-motion gate. #40: "Every timeline gated behind
 * prefers-reduced-motion — one shared hook, no exceptions."
 *
 * Nothing in this app calls `matchMedia('(prefers-reduced-motion)')` directly.
 * Everything goes through here, so the rule cannot be forgotten at hour 20.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function getQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mq = getQuery();
  if (mq === null) return () => undefined;
  mq.addEventListener('change', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
  };
}

/** Imperative read, for code outside React. */
export function prefersReducedMotion(): boolean {
  return getQuery()?.matches ?? false;
}

/** Server snapshot assumes reduced motion: never animate before we know. */
function getServerSnapshot(): boolean {
  return true;
}

/**
 * Reactive read. Re-renders when the user flips the OS setting mid-session,
 * so a running page responds without a reload.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, getServerSnapshot);
}
