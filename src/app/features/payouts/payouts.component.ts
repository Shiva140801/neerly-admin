import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';

interface Payout {
  id: string;
  vendorId: string;
  periodStart: string;
  periodEnd: string;
  grossTotal: number;
  commissionTotal: number;
  taxTotal: number;
  netTotal: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'ON_HOLD';
  razorpayPayoutId: string | null;
  utr: string | null;
  holdReason: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

@Component({
  selector: 'app-payouts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 24px; align-items: center; }
    .chip { padding: 8px 14px; border-radius: var(--r-pill); border: 1px solid var(--ink-200);
            background: var(--paper); font-size: 13px; font-weight: 500; color: var(--ink-700); cursor: pointer; }
    .chip.active { background: var(--admn-soft); color: var(--admn-dark); border-color: var(--admn); }
    button.primary { padding: 10px 18px; background: var(--admn); color: #fff; border: 0;
                     border-radius: var(--r-sm); font-weight: 600; cursor: pointer; font-size: 14px; }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .amt { font-family: var(--font-mono); font-weight: 600; }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.PENDING    { background: var(--warn-soft); color: var(--warn); }
    .pill.PROCESSING { background: var(--cust-soft); color: var(--cust-dark); }
    .pill.COMPLETED  { background: var(--ok-soft);   color: var(--ok); }
    .pill.FAILED     { background: var(--err-soft);  color: var(--err); }
    .pill.ON_HOLD    { background: var(--ink-100);   color: var(--ink-700); }
    button.act { padding: 6px 12px; border-radius: var(--r-sm); cursor: pointer;
                 font-size: 12px; font-weight: 600; border: 0; }
    button.complete { background: var(--ok-soft);  color: var(--ok); margin-right: 6px; }
    button.hold     { background: var(--warn-soft); color: var(--warn); }
    button.release  { background: var(--cust-soft); color: var(--cust-dark); }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Vendor <em>payouts</em></h1>

    <div class="toolbar">
      @for (s of statuses; track s) {
        <button class="chip" [class.active]="filter() === s" (click)="filter.set(s); reload()">
          {{ s ?? 'All' }}
        </button>
      }
      <span style="flex:1"></span>
      <button class="primary" (click)="runWeekly()" [disabled]="running()">
        {{ running() ? 'Running…' : 'Trigger weekly payout' }}
      </button>
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">No payouts in this filter.</div> }
    @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>Vendor</th><th>Period</th><th>Gross</th><th>Net</th>
            <th>Status</th><th>UTR</th><th></th>
          </tr></thead>
          <tbody>
            @for (p of items(); track p.id) {
              <tr>
                <td>{{ p.vendorId.slice(0, 8) }}</td>
                <td>{{ p.periodStart }} → {{ p.periodEnd }}</td>
                <td class="amt">₹{{ p.grossTotal | number:'1.2-2' }}</td>
                <td class="amt">₹{{ p.netTotal | number:'1.2-2' }}</td>
                <td>
                  <span class="pill" [ngClass]="p.status">{{ p.status }}</span>
                  @if (p.holdReason) {
                    <div style="color: var(--ink-500); font-size: 11px;">{{ p.holdReason }}</div>
                  }
                  @if (p.failureReason) {
                    <div style="color: var(--err); font-size: 11px;">{{ p.failureReason }}</div>
                  }
                </td>
                <td style="font-family: var(--font-mono); font-size: 12px;">
                  {{ p.utr ?? '—' }}
                </td>
                <td>
                  @if (p.status === 'PENDING' || p.status === 'PROCESSING') {
                    <button class="act complete" (click)="complete(p)">Mark paid</button>
                  }
                  @if (p.status === 'PENDING') {
                    <button class="act hold" (click)="hold(p)">Hold</button>
                  }
                  @if (p.status === 'ON_HOLD') {
                    <button class="act release" (click)="release(p)">Release</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `
})
export class PayoutsComponent {
  private api = inject(ApiClient);

  statuses: (string | null)[] = [null, 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ON_HOLD'];
  filter = signal<string | null>(null);
  loading = signal(true);
  running = signal(false);
  items = signal<Payout[]>([]);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    const f = this.filter();
    const params = f ? { status: f } : undefined;
    this.api.get<Payout[]>('/admin/payouts', params).subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  runWeekly() {
    this.running.set(true);
    this.api.post('/admin/payouts/run').subscribe({
      next: () => { this.running.set(false); this.reload(); },
      error: () => this.running.set(false)
    });
  }

  hold(p: Payout) {
    const reason = prompt('Hold reason:') ?? '';
    if (!reason.trim()) return;
    this.api.post(`/admin/payouts/${p.id}/hold`, { reason }).subscribe(() => this.reload());
  }

  release(p: Payout) {
    this.api.post(`/admin/payouts/${p.id}/release`).subscribe(() => this.reload());
  }

  complete(p: Payout) {
    const utr = prompt('UTR / bank reference:') ?? '';
    if (!utr.trim()) return;
    this.api.post(`/admin/payouts/${p.id}/mark-completed?utr=${encodeURIComponent(utr)}`).subscribe(() => this.reload());
  }
}
