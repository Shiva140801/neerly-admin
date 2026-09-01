/**
 * One date format, one time format, one money format — for the whole portal.
 *
 * The screens had grown three of each (`23 Aug, 13:46`, `23 Aug 2026, 13:41`,
 * `2026-08-27`; `₹770`, `₹385.00`, a bare `75`), which makes two numbers on two
 * screens impossible to compare at a glance and makes a missing currency symbol
 * read as a quantity. Everything now goes through the helpers here, so changing
 * how Neerly writes a date or a rupee is a one-file change.
 *
 * Money rule: always the ₹ symbol, always Indian digit grouping, and decimals
 * only when the value actually has paise. ₹770 and ₹1,24,500 and ₹385.50 are the
 * same rule applied to three different numbers — never three different rules.
 */

export const IN_LOCALE = 'en-IN';

/** The only three ways this portal writes an instant. */
export type WhenStyle = 'datetime' | 'date' | 'time';

const DATE_PARTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_PARTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

/**
 * `23 Aug 2026, 13:41` / `23 Aug 2026` / `13:41`.
 *
 * Returns an em dash rather than "Invalid Date" for anything unparseable, so a
 * null timestamp on the wire reads as "we do not have this" instead of as a bug.
 */
export function formatWhen(value: string | number | Date | null | undefined, style: WhenStyle = 'datetime'): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const opts: Intl.DateTimeFormatOptions =
    style === 'date' ? DATE_PARTS
    : style === 'time' ? TIME_PARTS
    : { ...DATE_PARTS, ...TIME_PARTS };

  const text = new Intl.DateTimeFormat(IN_LOCALE, opts).format(d);
  // Intl joins date and time with a locale separator that varies by runtime;
  // pin it to a comma so every screen renders the identical string.
  return style === 'datetime' ? text.replace(/,?\s+(?=\d{2}:\d{2}$)/, ', ') : text;
}

/**
 * `₹770`, `₹385.50`, `₹1,24,500`. Decimals appear only when there are paise.
 *
 * `null` renders as `—`, never as `₹0`: on a money screen a missing figure and a
 * zero figure are different facts.
 */
export function formatRupees(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const hasPaise = Math.abs(n * 100 - Math.round(n * 100)) < 0.5 && Math.round(n * 100) % 100 !== 0;
  return `₹${n.toLocaleString(IN_LOCALE, {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0
  })}`;
}

/** Plain count with Indian grouping — `1,24,500`. */
export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n.toLocaleString(IN_LOCALE) : '—';
}

/**
 * What a figure shows while its fetch is still in flight.
 *
 * A metric tile that renders `0` during loading tells the admin the queue is
 * clear when nobody knows yet; a middle dot cannot be mistaken for a real
 * reading. Same character the attention rows already use for pending counts.
 */
export const PENDING_FIGURE = '·';
