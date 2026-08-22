import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Conditional classes with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Money, formatted for display. Always paired with the `.tabular` class so a
 * total does not reflow as it ticks — the cost engine (#3) updates these live.
 */
export function formatCurrency(
  amountMinor: number,
  currency = 'USD',
  locale?: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

/** "12–19 Oct 2026" — one month named when the range does not cross one. */
export function formatDateRange(start: Date, end: Date, locale?: string): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric' });
  const fullFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return sameMonth
    ? `${dayFmt.format(start)}–${fullFmt.format(end)}`
    : `${fullFmt.format(start)} – ${fullFmt.format(end)}`;
}
