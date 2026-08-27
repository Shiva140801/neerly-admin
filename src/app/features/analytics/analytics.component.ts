import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import type { AdminAnalyticsSummary } from '../../shared/attention.service';
import { describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

/**
 * Platform health.
 *
 * The overview answers "what needs me now"; this answers "is the business
 * working". Same endpoint, different question — so the figures are grouped by
 * the loop they belong to (demand, supply, trust, float) and each carries the
 * sentence that says what a bad reading would mean, because a number without a
 * threshold is not a metric.
 */
@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent, DataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .hero {
      background: var(--admn); color: #fff; border-radius: var(--r-lg);
      padding: 26px 28px; margin-bottom: 22px;
      display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; flex-wrap: wrap;
    }
    .hero .k { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
               color: color-mix(in srgb, #fff 78%, transparent); }
    .hero .v {
      font-family: var(--font-serif); font-weight: 400; font-size: 58px; line-height: 1;
      margin-top: 8px; font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
    }
    .hero .n { font-size: 13px; color: color-mix(in srgb, #fff 76%, transparent); margin-top: 8px; max-width: 42ch; line-height: 1.5; }
    .hero .side { text-align: right; }
    .hero .side .sv { font-size: 26px; font-weight: 750; font-variant-numeric: tabular-nums; }
    .hero .side .sk { font-size: 11px; color: color-mix(in srgb, #fff 74%, transparent); letter-spacing: .06em; text-transform: uppercase; font-weight: 700; }

    .section { margin-bottom: 22px; }
    .section > .text-label { margin-bottom: 9px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(224px, 1fr)); gap: 12px; }

    .tile {
      background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
      box-shadow: var(--shadow-1); padding: 16px 18px;
    }
    .tile .k { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-500); }
    .tile .v {
      font-size: 27px; font-weight: 750; color: var(--ink-900); margin-top: 6px;
      font-variant-numeric: tabular-nums; line-height: 1.05;
    }
    .tile .v.warn { color: var(--warn); }
    .tile .v.crit { color: var(--err); }
    .tile .v.ok   { color: var(--ok); }
    .tile .n { font-size: 12px; color: var(--ink-500); margin-top: 6px; line-height: 1.45; }
  `],
  template: `
    <app-page-header
      title="Platform" accent="health"
      subtitle="The overview tells you what needs doing today. This tells you whether the business underneath it is working.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    @if (loading() || error() || !data()) {
      <div class="panel">
        <app-data-state
          what="platform metrics"
          [loading]="loading()" [error]="error()"
          emptyTitle="No metrics returned"
          emptyDetail="The summary endpoint answered, but with nothing in it."
          (retry)="reload()" />
      </div>
    } @else {
      @if (data(); as d) {
      <div class="hero">
        <div>
          <div class="k">North star · WAPC</div>
          <div class="v">{{ d.wapc | number }}</div>
          <div class="n">Weekly active paying customers — unique people with at least one delivered order in the last seven days. Everything else is a means to this.</div>
        </div>
        <div class="side">
          <div class="sk">Active subscriptions</div>
          <div class="sv">{{ d.activeSubscriptions | number }}</div>
          <div class="sk mt-12">Live vendors</div>
          <div class="sv">{{ d.activeVendors | number }}</div>
        </div>
      </div>

      <div class="section">
        <div class="text-label">Demand · last 24 hours</div>
        <div class="grid">
          <div class="tile">
            <div class="k">Orders placed</div>
            <div class="v">{{ d.ordersToday | number }}</div>
            <div class="n">Every order created in the last 24 hours, whatever happened to it after.</div>
          </div>
          <div class="tile">
            <div class="k">Delivered</div>
            <div class="v ok">{{ d.deliveredToday | number }}</div>
            <div class="n">{{ completion() }}</div>
          </div>
          <div class="tile">
            <div class="k">Gross revenue</div>
            <div class="v">₹{{ d.grossRevenueToday | number:'1.0-0' }}</div>
            <div class="n">Order value from placed through delivered. Cancelled and failed orders are excluded.</div>
          </div>
          <div class="tile">
            <div class="k">Average order value</div>
            <div class="v">{{ aov() }}</div>
            <div class="n">Gross revenue divided by orders in the window.</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="text-label">Trust · open exposure</div>
        <div class="grid">
          <div class="tile">
            <div class="k">Open disputes</div>
            <div class="v" [class.warn]="d.openComplaints > 0">{{ d.openComplaints | number }}</div>
            <div class="n">Filed and not yet closed. <a class="link" routerLink="/disputes">Work the queue →</a></div>
          </div>
          <div class="tile">
            <div class="k">SLA breached</div>
            <div class="v" [class.crit]="d.slaBreachedComplaints > 0" [class.ok]="d.slaBreachedComplaints === 0">
              {{ d.slaBreachedComplaints | number }}
            </div>
            <div class="n">{{ breachNote(d) }}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="text-label">Float · container deposits</div>
        <div class="grid">
          <div class="tile">
            <div class="k">Deposits held</div>
            <div class="v">₹{{ d.depositsHeld | number:'1.0-0' }}</div>
            <div class="n">Customer money the platform is holding against containers in the wild. This is a liability, not revenue.</div>
          </div>
          <div class="tile">
            <div class="k">Forfeited this week</div>
            <div class="v" [class.warn]="d.depositsForfeitedThisWeek > 0">₹{{ d.depositsForfeitedThisWeek | number:'1.0-0' }}</div>
            <div class="n">{{ forfeitNote(d) }}</div>
          </div>
        </div>
      </div>
      }
    }
  `
})
export class AnalyticsComponent {
  private api = inject(ApiClient);

  loading = signal(true);
  error = signal<string | null>(null);
  data = signal<AdminAnalyticsSummary | null>(null);

  constructor() { this.reload(); }

  readonly completion = computed(() => {
    const d = this.data();
    if (!d || d.ordersToday === 0) return 'No orders placed in the window, so there is nothing to complete.';
    const pct = Math.round((d.deliveredToday / d.ordersToday) * 100);
    return `${pct}% of orders placed in the window have landed. The rest are still in flight, cancelled or failed.`;
  });

  readonly aov = computed(() => {
    const d = this.data();
    if (!d || d.ordersToday === 0) return '—';
    return `₹${Math.round(Number(d.grossRevenueToday) / d.ordersToday).toLocaleString('en-IN')}`;
  });

  breachNote(d: AdminAnalyticsSummary): string {
    if (d.slaBreachedComplaints === 0) return 'Nothing has run past its resolution deadline. Keep it here.';
    const share = d.openComplaints > 0 ? Math.round((d.slaBreachedComplaints / d.openComplaints) * 100) : 100;
    return `${share}% of open disputes are past deadline. Each one is a refund the platform ends up paying anyway.`;
  }

  forfeitNote(d: AdminAnalyticsSummary): string {
    if (Number(d.depositsForfeitedThisWeek) === 0) {
      return 'No deposit was forfeited this week — every container came back inside its window.';
    }
    const share = Number(d.depositsHeld) > 0
      ? Math.round((Number(d.depositsForfeitedThisWeek) / Number(d.depositsHeld)) * 100) : 0;
    return `${share}% of the held float converted to forfeit this week. A rising number means containers are not coming back.`;
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<AdminAnalyticsSummary>('/admin/analytics/summary').subscribe({
      next: d => { this.data.set(d); this.loading.set(false); },
      error: e => {
        this.error.set(describeError(e, 'platform metrics'));
        this.data.set(null);
        this.loading.set(false);
      }
    });
  }
}
