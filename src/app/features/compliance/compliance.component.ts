import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';

interface ComplianceDoc {
  id: string;
  vendorId: string;
  docType: string;
  docNumber: string | null;
  s3Key: string;
  issuedDate: string | null;
  expiresDate: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason: string | null;
  uploadedAt: string;
}

@Component({
  selector: 'app-compliance',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .tabs { display: flex; gap: 8px; margin-bottom: 24px; }
    .chip { padding: 8px 14px; border-radius: var(--r-pill); border: 1px solid var(--ink-200);
            background: var(--paper); font-size: 13px; font-weight: 500; color: var(--ink-700); cursor: pointer; }
    .chip.active { background: var(--admn-soft); color: var(--admn-dark); border-color: var(--admn); }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.submitted { background: var(--warn-soft); color: var(--warn); }
    .pill.approved  { background: var(--ok-soft); color: var(--ok); }
    .pill.rejected, .pill.expired { background: var(--err-soft); color: var(--err); }
    button.approve { padding: 6px 12px; background: var(--admn); color: #fff; border: 0;
                     border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; }
    button.reject  { padding: 6px 12px; border: 1px solid var(--err); color: var(--err); background: var(--paper);
                     border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; margin-left: 6px; }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Compliance <em>queue</em></h1>
    <div class="tabs">
      <button class="chip" [class.active]="mode() === 'expiring'" (click)="mode.set('expiring'); reload()">Expiring soon</button>
    </div>
    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">No compliance items to act on.</div> }
    @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>Document</th><th>Vendor</th><th>Expires</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            @for (d of items(); track d.id) {
              <tr>
                <td>
                  <div style="font-weight: 600;">{{ d.docType }}</div>
                  <div style="color: var(--ink-500); font-size: 12px;">{{ d.docNumber ?? '—' }}</div>
                </td>
                <td>{{ d.vendorId.slice(0, 8) }}</td>
                <td>{{ d.expiresDate ? (d.expiresDate | date:'mediumDate') : '—' }}</td>
                <td><span class="pill"
                         [class.submitted]="d.status === 'SUBMITTED'"
                         [class.approved]="d.status === 'APPROVED'"
                         [class.rejected]="d.status === 'REJECTED'"
                         [class.expired]="d.status === 'EXPIRED'">{{ d.status }}</span></td>
                <td>
                  @if (d.status === 'SUBMITTED') {
                    <button class="approve" (click)="approve(d)">Approve</button>
                    <button class="reject"  (click)="reject(d)">Reject</button>
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
export class ComplianceComponent {
  private api = inject(ApiClient);
  loading = signal(true);
  items = signal<ComplianceDoc[]>([]);
  mode = signal<'expiring'>('expiring');

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.api.get<ComplianceDoc[]>('/admin/compliance/expiring').subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  approve(d: ComplianceDoc) {
    const note = prompt('Approval note (optional)') ?? '';
    this.api.post(`/admin/compliance/${d.id}/approve`, { note }).subscribe(() => this.reload());
  }

  reject(d: ComplianceDoc) {
    const note = prompt('Rejection reason') ?? '';
    if (!note.trim()) return;
    this.api.post(`/admin/compliance/${d.id}/reject`, { note }).subscribe(() => this.reload());
  }
}
