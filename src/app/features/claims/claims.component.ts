import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';

interface DamageClaim {
  id: string;
  vendorId: string;
  customerId: string;
  depositId: string;
  claimAmount: number;
  awardedAmount: number | null;
  reason: string;
  evidencePhotos: string[];
  status: 'FILED' | 'REVIEWING' | 'APPROVED' | 'REJECTED';
  filedAt: string;
}

@Component({
  selector: 'app-claims',
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
    .pill.filed { background: var(--warn-soft); color: var(--warn); }
    .pill.reviewing { background: var(--cust-soft); color: var(--cust-dark); }
    .pill.approved { background: var(--ok-soft); color: var(--ok); }
    .pill.rejected { background: var(--err-soft); color: var(--err); }
    button.approve { padding: 6px 12px; background: var(--admn); color: #fff; border: 0;
                     border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; }
    button.reject  { padding: 6px 12px; border: 1px solid var(--err); color: var(--err); background: var(--paper);
                     border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; margin-left: 6px; }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
    .amt { font-family: var(--font-mono); }
    .photo { display: inline-block; width: 40px; height: 40px; border-radius: 6px; background: var(--ink-100);
             margin-right: 6px; vertical-align: middle; }
  `],
  template: `
    <h1>Damage <em>claims</em></h1>
    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">No claims awaiting arbitration.</div> }
    @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>Claim</th><th>Amount</th><th>Reason</th><th>Evidence</th>
            <th>Status</th><th>Filed</th><th></th>
          </tr></thead>
          <tbody>
            @for (c of items(); track c.id) {
              <tr>
                <td>
                  <div style="font-weight: 600; color: var(--ink-900);">{{ c.id.slice(0, 8) }}</div>
                  <div style="color: var(--ink-500); font-size: 12px;">vendor {{ c.vendorId.slice(0, 8) }}</div>
                </td>
                <td class="amt">₹{{ c.claimAmount | number:'1.2-2' }}</td>
                <td style="color: var(--ink-500); font-size: 13px;">{{ c.reason }}</td>
                <td>
                  @for (p of c.evidencePhotos.slice(0, 3); track p) { <span class="photo" [title]="p"></span> }
                  @if (c.evidencePhotos.length > 3) { +{{ c.evidencePhotos.length - 3 }} }
                </td>
                <td><span class="pill"
                         [class.filed]="c.status === 'FILED'"
                         [class.reviewing]="c.status === 'REVIEWING'"
                         [class.approved]="c.status === 'APPROVED'"
                         [class.rejected]="c.status === 'REJECTED'">{{ c.status }}</span></td>
                <td>{{ c.filedAt | date:'mediumDate' }}</td>
                <td>
                  @if (c.status === 'FILED' || c.status === 'REVIEWING') {
                    <button class="approve" (click)="approve(c)">Approve</button>
                    <button class="reject"  (click)="reject(c)">Reject</button>
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
export class ClaimsComponent {
  private api = inject(ApiClient);
  loading = signal(true);
  items = signal<DamageClaim[]>([]);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.api.get<DamageClaim[]>('/admin/claims').subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  approve(c: DamageClaim) {
    const raw = prompt(`Awarded amount (up to ₹${c.claimAmount})`, String(c.claimAmount));
    if (!raw) return;
    const awardedAmount = Number(raw);
    const note = prompt('Note (optional)') ?? '';
    this.api.post(`/admin/claims/${c.id}/approve`, { awardedAmount, note }).subscribe(() => this.reload());
  }

  reject(c: DamageClaim) {
    const note = prompt('Rejection reason') ?? '';
    if (!note.trim()) return;
    this.api.post(`/admin/claims/${c.id}/reject`, { note }).subscribe(() => this.reload());
  }
}
