import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Loading / error / empty for every data call on every screen.
 *
 * Wrapping the three states in one component is what makes it cheap to honour
 * the rule that *every* fetch shows all three — the previous screens shipped a
 * bare "Loading…" and silently swallowed errors, so a 403 on an L2-gated
 * endpoint looked identical to an empty queue.
 *
 * Empty copy is a required input on purpose: "No rows" tells the admin nothing,
 * "No vendor has been waiting since you last cleared this queue" tells them
 * they are done.
 */
@Component({
  selector: 'app-data-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .box {
      padding: 44px 32px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
    }
    .box.compact { padding: 26px 20px; }
    .headline { font-size: 14.5px; font-weight: 650; color: var(--ink-700); }
    .detail { font-size: 13px; color: var(--ink-500); max-width: 46ch; line-height: 1.55; }
    .headline.err { color: var(--err-ink); }

    .bars { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 520px; }
    .bar {
      height: 11px; border-radius: var(--r-pill);
      background: linear-gradient(90deg, var(--ink-100) 25%, var(--ink-50) 50%, var(--ink-100) 75%);
      background-size: 240% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    .bar:nth-child(2) { width: 82%; } .bar:nth-child(3) { width: 64%; }
    @keyframes shimmer { 0% { background-position: 120% 0; } 100% { background-position: -20% 0; } }

    .mark {
      width: 34px; height: 34px; border-radius: var(--r-pill);
      display: grid; place-items: center; font-size: 16px; font-weight: 700;
      background: var(--ink-100); color: var(--ink-500); margin-bottom: 2px;
    }
    .mark.err { background: var(--err-soft); color: var(--err-ink); }
    .mark.ok  { background: var(--ok-soft);  color: var(--ok-ink); }
  `],
  template: `
    @if (loading) {
      <div class="box" [class.compact]="compact" role="status" aria-live="polite">
        <span class="text-label">Loading {{ what }}…</span>
        <div class="bars" aria-hidden="true"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>
      </div>
    } @else if (error) {
      <div class="box" [class.compact]="compact" role="alert">
        <div class="mark err">!</div>
        <div class="headline err">Couldn't load {{ what }}</div>
        <div class="detail">{{ error }}</div>
        <button type="button" class="btn btn--ghost btn--sm mt-8" (click)="retry.emit()">Try again</button>
      </div>
    } @else {
      <div class="box" [class.compact]="compact">
        <div class="mark" [class.ok]="clear">{{ clear ? '✓' : '—' }}</div>
        <div class="headline">{{ emptyTitle }}</div>
        @if (emptyDetail) { <div class="detail">{{ emptyDetail }}</div> }
        <ng-content />
      </div>
    }
  `
})
export class DataStateComponent {
  /** Noun used in the loading and error copy, e.g. "the verification queue". */
  @Input() what = 'data';
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input({ required: true }) emptyTitle = '';
  @Input() emptyDetail = '';
  /** True when empty is a *good* outcome (queue cleared) rather than no data. */
  @Input() clear = false;
  @Input() compact = false;
  @Output() retry = new EventEmitter<void>();
}
