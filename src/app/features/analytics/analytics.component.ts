import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';

interface AdminAnalyticsSummary {
  wapc: number;
  ordersToday: number;
  deliveredToday: number;
  grossRevenueToday: number;
  activeSubscriptions: number;
  activeVendors: number;
  openComplaints: number;
  slaBreachedComplaints: number;
  depositsHeld: number;
  depositsForfeitedThisWeek: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .tile { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
            box-shadow: var(--shadow-1); padding: 24px; }
    .tile.hero { background: var(--admn); color: #fff; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: .8px;
             color: var(--ink-500); font-weight: 600; }
    .tile.hero .label { color: rgba(255,255,255,0.85); }
    .value { font-size: 32px; font-weight: 700; color: var(--ink-900); margin-top: 8px;
             font-family: var(--font-mono); }
    .tile.hero .value { color: #fff; }
    .sub   { font-size: 11px; color: var(--ink-500); margin-top: 4px; }
    .tile.hero .sub { color: rgba(255,255,255,0.75); }
    .tile.warn .value { color: var(--warn); }
    .tile.err  .value { color: var(--err); }
    .tile.ok   .value { color: var(--ok); }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Platform <em>health</em></h1>
    @if (loading()) {
      <div class="empty">Loading…</div>
    } @else {
      @if (data(); as d) {
        <div class="grid">
          <div class="tile hero">
            <div class="label">North star · WAPC (7d)</div>
            <div class="value">{{ d.wapc | number }}</div>
            <div class="sub">Weekly active paying customers</div>
          </div>
          <div class="tile">
            <div class="label">Orders today</div>
            <div class="value">{{ d.ordersToday | number }}</div>
            <div class="sub">{{ d.deliveredToday | number }} delivered</div>
          </div>
          <div class="tile ok">
            <div class="label">Revenue today (gross)</div>
            <div class="value">₹{{ d.grossRevenueToday | number:'1.0-0' }}</div>
          </div>
          <div class="tile">
            <div class="label">Active subscriptions</div>
            <div class="value">{{ d.activeSubscriptions | number }}</div>
          </div>
          <div class="tile">
            <div class="label">Active vendors</div>
            <div class="value">{{ d.activeVendors | number }}</div>
          </div>
          <div class="tile" [class.warn]="d.openComplaints > 0">
            <div class="label">Open complaints</div>
            <div class="value">{{ d.openComplaints | number }}</div>
          </div>
          <div class="tile" [class.err]="d.slaBreachedComplaints > 0">
            <div class="label">SLA breached</div>
            <div class="value">{{ d.slaBreachedComplaints | number }}</div>
            <div class="sub">L1 SLA = 24h</div>
          </div>
          <div class="tile">
            <div class="label">Deposits held</div>
            <div class="value">₹{{ d.depositsHeld | number:'1.0-0' }}</div>
          </div>
          <div class="tile" [class.warn]="d.depositsForfeitedThisWeek > 0">
            <div class="label">Forfeited this week</div>
            <div class="value">₹{{ d.depositsForfeitedThisWeek | number:'1.0-0' }}</div>
          </div>
        </div>
      } @else {
        <div class="empty">{{ error() ?? 'No data' }}</div>
      }
    }
  `
})
export class AnalyticsComponent {
  private api = inject(ApiClient);
  loading = signal(true);
  data = signal<AdminAnalyticsSummary | null>(null);
  error = signal<string | null>(null);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.api.get<AdminAnalyticsSummary>('/admin/analytics/summary').subscribe({
      next: d => { this.data.set(d); this.loading.set(false); },
      error: e => {
        this.error.set(e?.error?.error?.message ?? 'Failed to load');
        this.loading.set(false);
      }
    });
  }
}
