import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';

interface OrderResponse {
  id: string;
  orderNumber: string;
  customerId: string;
  vendorId: string | null;
  status: string;
  totalAmount: number;
  placedAt: string;
  deliveredAt: string | null;
  paymentMethod: string;
  itemCount?: number;
}

const STATUSES: (string | null)[] = [
  null, 'PLACED', 'VENDOR_ASSIGNED', 'VENDOR_ACCEPTED', 'PREPARING',
  'DISPATCHED', 'ARRIVING', 'DELIVERED', 'CANCELLED', 'FAILED'
];

/**
 * Cross-vendor admin order grid. Filters by status + vendorId, paginated.
 * Backed by GET /api/v1/admin/orders (already exists). Read-only for V1;
 * refunds/disputes are linked from per-row drawers in V1.1.
 */
@Component({
  selector: 'app-orders-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px;
         margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
               margin-bottom: 24px; }
    .chip { padding: 8px 14px; border-radius: var(--r-pill); border: 1px solid var(--ink-200);
            background: var(--paper); font-size: 13px; font-weight: 500; color: var(--ink-700);
            cursor: pointer; }
    .chip.active { background: var(--admn-soft); color: var(--admn-dark); border-color: var(--admn); }
    input.vendor { padding: 8px 12px; border: 1px solid var(--ink-200); border-radius: var(--r-md);
                   font-size: 13px; width: 320px; font-family: var(--font-mono); }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 14px 16px; font-size: 13px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .num { font-family: var(--font-mono); }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.PLACED, .pill.VENDOR_ASSIGNED { background: var(--warn-soft); color: var(--warn); }
    .pill.VENDOR_ACCEPTED, .pill.PREPARING { background: var(--cust-soft); color: var(--cust-dark); }
    .pill.DISPATCHED, .pill.ARRIVING { background: var(--admn-soft); color: var(--admn-dark); }
    .pill.DELIVERED { background: var(--ok-soft); color: var(--ok); }
    .pill.CANCELLED, .pill.FAILED { background: var(--err-soft); color: var(--err); }
    .pager { display: flex; align-items: center; gap: 12px; margin-top: 16px;
             font-size: 13px; color: var(--ink-600); }
    .pager button { padding: 6px 12px; border-radius: var(--r-sm); border: 1px solid var(--ink-200);
                    background: var(--paper); cursor: pointer; }
    .pager button:disabled { opacity: .4; cursor: not-allowed; }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Cross-vendor <em>orders</em></h1>

    <div class="toolbar">
      @for (s of statuses; track s) {
        <button class="chip" [class.active]="status() === s"
                (click)="status.set(s); page.set(0); reload()">
          {{ s ?? 'All' }}
        </button>
      }
      <input class="vendor" type="text" placeholder="Filter by vendor UUID (optional)…"
             [(ngModel)]="vendorIdInput" (change)="reload()" />
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (rows().length === 0) {
      <div class="empty">No orders match this filter.</div>
    } @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>Order #</th><th>Customer</th><th>Vendor</th>
            <th>Placed</th><th>Status</th><th>Pay</th><th>Total</th>
          </tr></thead>
          <tbody>
            @for (o of rows(); track o.id) {
              <tr>
                <td class="num">{{ o.orderNumber }}</td>
                <td class="num">{{ o.customerId.slice(0, 8) }}</td>
                <td class="num">{{ o.vendorId ? o.vendorId.slice(0, 8) : '—' }}</td>
                <td>{{ o.placedAt | date:'short' }}</td>
                <td><span class="pill" [ngClass]="o.status">{{ o.status }}</span></td>
                <td>{{ o.paymentMethod }}</td>
                <td class="num">₹{{ o.totalAmount | number:'1.2-2' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="pager">
        <button (click)="prev()" [disabled]="page() === 0">‹ Prev</button>
        <span>Page {{ page() + 1 }} · {{ rows().length }} rows</span>
        <button (click)="next()" [disabled]="rows().length < pageSize">Next ›</button>
      </div>
    }
  `
})
export class OrdersComponent {
  private api = inject(ApiClient);

  statuses = STATUSES;
  status = signal<string | null>(null);
  vendorIdInput = '';
  page = signal(0);
  readonly pageSize = 25;
  loading = signal(true);
  rows = signal<OrderResponse[]>([]);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    const params: Record<string, string | number> = { page: this.page(), size: this.pageSize };
    const s = this.status(); if (s) params['status'] = s;
    const v = this.vendorIdInput.trim();
    if (v.length > 0) params['vendorId'] = v;
    this.api.get<OrderResponse[]>('/admin/orders', params).subscribe({
      next: (data) => { this.rows.set(Array.isArray(data) ? data : []); this.loading.set(false); },
      error: () => { this.rows.set([]); this.loading.set(false); }
    });
  }

  prev() { if (this.page() > 0) { this.page.update(p => p - 1); this.reload(); } }
  next() { this.page.update(p => p + 1); this.reload(); }
}
