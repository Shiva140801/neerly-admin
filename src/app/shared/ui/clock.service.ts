import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';

/**
 * One ticking clock for the whole app.
 *
 * SLA countdowns are the point of the disputes screen, so "2h 40m left" has to
 * actually count down — but a per-row timer would thrash change detection on
 * an OnPush tree. Instead every screen reads this single signal and Angular
 * re-renders the dependent views once a minute. The interval runs outside the
 * Angular zone so it never keeps zone stability from settling (which would
 * hang Karma and Playwright waits).
 */
@Injectable({ providedIn: 'root' })
export class ClockService implements OnDestroy {
  private zone = inject(NgZone);
  private handle: ReturnType<typeof setInterval> | null = null;

  private nowSig = signal(Date.now());
  /** Current wall-clock ms, refreshed every 30s. */
  readonly now = this.nowSig.asReadonly();

  constructor() {
    this.zone.runOutsideAngular(() => {
      this.handle = setInterval(() => {
        this.zone.run(() => this.nowSig.set(Date.now()));
      }, 30_000);
    });
  }

  /** Force an immediate re-read — used right after a mutation refreshes data. */
  sync() { this.nowSig.set(Date.now()); }

  ngOnDestroy() {
    if (this.handle !== null) clearInterval(this.handle);
  }
}
