import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';

interface AdminRefund {
  id: string;
  paymentId: string;
  orderId: string | null;
  customerId: string;
  amount: number;
  mode: 'ORIGINAL' | 'WALLET' | 'CASH';
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSED' | 'REJECTED' | 'FAILED';
  reason: string;
  createdAt: string;
  approvedAt: string | null;
  processedAt: string | null;
}

@Component({
  selector: 'app-refunds',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.requested { background: var(--warn-soft); color: var(--warn); }
    .pill.approved  { background: var(--cust-soft); color: var(--cust-dark); }
    .pill.processed { background: var(--ok-soft); color: var(--ok); }
    .pill.rejected  { background: var(--err-soft); color: var(--err); }
    button.approve { padding: 6px 12px; background: var(--admn); color: #fff; border: 0;
                     border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; }
    button.reject  { padding: 6px 12px; border: 1px solid var(--err); color: var(--err); background: var(--paper);
                     border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; margin-left: 6px; }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
    .amt { font-family: var(--font-mono); }
  `],
  template: `
    <h1>Refund <em>queue</em></h1>
    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">Queue clear — nothing awaiting review.</div> }
    @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>Refund</th><th>Mode</th><th>Amount</th><th>Reason</th>
            <th>Status</th><th>Filed</th><th></th>
          </tr></thead>
          <tbody>
            @for (r of items(); track r.id) {
              <tr>
                <td>
                  <div style="font-weight: 600; color: var(--ink-900);">{{ r.id.slice(0, 8) }}</div>
                  <div style="color: var(--ink-500); font-size: 12px;">order {{ (r.orderId ?? '—').toString().slice(0, 8) }}</div>
                </td>
                <td>{{ r.mode }}</td>
                <td class="amt">₹{{ r.amount | number:'1.2-2' }}</td>
                <td style="color: var(--ink-500); font-size: 13px;">{{ r.reason }}</td>
                <td><span class="pill"
                         [class.requested]="r.status === 'REQUESTED'"
                         [class.approved]="r.status === 'APPROVED'"
                         [class.processed]="r.status === 'PROCESSED'"
                         [class.rejected]="r.status === 'REJECTED' || r.status === 'FAILED'">{{ r.status }}</span></td>
                <td>{{ r.createdAt | date:'mediumDate' }}</td>
                <td>
                  @if (r.status === 'REQUESTED') {
                    <button class="approve" (click)="approve(r)">Approve</button>
                    <button class="reject"  (click)="reject(r)">Reject</button>
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
export class RefundsComponent {
  private api = inject(ApiClient);
  loading = signal(true);
  items = signal<AdminRefund[]>([]);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.api.get<AdminRefund[]>('/admin/refunds', { status: 'REQUESTED' }).subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  approve(r: AdminRefund) {
    const note = prompt('Approval note (optional)') ?? '';
    this.api.post(`/admin/refunds/${r.id}/approve`, { note }).subscribe(() => this.reload());
  }

  reject(r: AdminRefund) {
    const note = prompt('Rejection reason') ?? '';
    if (!note.trim()) return;
    this.api.post(`/admin/refunds/${r.id}/reject`, { note }).subscribe(() => this.reload());
  }
}
