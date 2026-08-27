/**
 * Shared urgency vocabulary.
 *
 * Every operational screen answers the same question — "how close is this to
 * hurting someone?" — so the buckets, the wording and the colour mapping live
 * in one place. `Severity` maps 1:1 onto the `.pill--*` / `.sev-*` classes in
 * styles.scss, and deliberately stays distinct from the purple brand accent:
 * purple means "you are here", never "this is fine" or "this is on fire".
 */
export type Severity = 'ok' | 'warn' | 'crit' | 'idle';

export const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, ok: 2, idle: 3 };

/** Sort comparator: most urgent first. */
export function bySeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

/** Milliseconds from `now` until an ISO instant. Negative once it has passed. */
export function msUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t - now;
}

/** Milliseconds elapsed since an ISO instant. Negative if it is in the future. */
export function msSince(iso: string | null | undefined, now: number): number | null {
  const d = msUntil(iso, now);
  return d === null ? null : -d;
}

/**
 * Whole days from today until a plain `YYYY-MM-DD` date, counted in calendar
 * days rather than elapsed hours — an FSSAI licence that lapses tomorrow reads
 * "1 day", not "0 days", regardless of the hour the admin logs in.
 */
export function daysUntilDate(date: string | null | undefined, now: number): number | null {
  if (!date) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!parts) return null;
  const target = Date.UTC(+parts[1], +parts[2] - 1, +parts[3]);
  const d = new Date(now);
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target - today) / MS_DAY);
}

/**
 * Compact duration for dense table cells: "4h 12m", "3d", "22m".
 * Always positive — direction is carried by the surrounding label.
 */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < MS_MIN) return '<1m';
  const days = Math.floor(abs / MS_DAY);
  const hours = Math.floor((abs % MS_DAY) / MS_HOUR);
  const mins = Math.floor((abs % MS_HOUR) / MS_MIN);
  if (days > 0) return hours > 0 && days < 3 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** "4h 12m ago" / "in 3d" / "just now". */
export function formatRelative(ms: number): string {
  if (Math.abs(ms) < MS_MIN) return 'just now';
  return ms < 0 ? `${formatDuration(ms)} ago` : `in ${formatDuration(ms)}`;
}

/**
 * SLA state for a deadline. `breached` is passed in where the backend already
 * computed it (complaints carry `slaBreached`) so the UI never disagrees with
 * the server's own verdict; otherwise it falls out of the remaining time.
 */
export interface SlaState {
  severity: Severity;
  /** Remaining ms; negative when overdue. */
  remainingMs: number | null;
  breached: boolean;
  /** Ready-to-render phrase, e.g. "2h 40m left" or "overdue by 5h". */
  label: string;
}

export function slaState(
  deadlineIso: string | null | undefined,
  now: number,
  serverBreached = false,
  warnWithinMs = 4 * MS_HOUR
): SlaState {
  const remainingMs = msUntil(deadlineIso, now);
  if (remainingMs === null) {
    return { severity: 'idle', remainingMs: null, breached: serverBreached, label: 'no deadline' };
  }
  const breached = serverBreached || remainingMs <= 0;
  if (breached) {
    return {
      severity: 'crit',
      remainingMs,
      breached: true,
      label: remainingMs <= 0 ? `overdue by ${formatDuration(remainingMs)}` : 'marked breached'
    };
  }
  return {
    severity: remainingMs <= warnWithinMs ? 'warn' : 'ok',
    remainingMs,
    breached: false,
    label: `${formatDuration(remainingMs)} left`
  };
}

/**
 * Waiting-time severity for review queues. A vendor sitting unreviewed for two
 * days is a real problem for a marketplace trying to add supply; a few hours is
 * not. Thresholds are deliberately generous because the admin is part-time
 * (~15 hrs/week) — PRD §5.3.
 */
export function waitSeverity(waitedMs: number | null): Severity {
  if (waitedMs === null) return 'idle';
  if (waitedMs >= 3 * MS_DAY) return 'crit';
  if (waitedMs >= MS_DAY) return 'warn';
  return 'ok';
}

/**
 * Licence-expiry severity mirrors the reminder ladder in PRD §6.4
 * (60 / 30 / 7 days) — and expiry day auto-blocks the vendor from selling, so
 * anything already past is critical.
 */
export function expirySeverity(days: number | null): Severity {
  if (days === null) return 'idle';
  if (days <= 7) return 'crit';
  if (days <= 30) return 'warn';
  return 'ok';
}

export function expiryLabel(days: number | null): string {
  if (days === null) return 'no expiry on file';
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'expires today';
  return `${days}d left`;
}

/** Title-cases a SCREAMING_SNAKE enum for display. */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
