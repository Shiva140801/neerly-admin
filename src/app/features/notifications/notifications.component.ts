import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';

interface AdminNotification {
  id: string;
  userId: string;
  channel: 'PUSH' | 'SMS' | 'EMAIL' | 'IN_APP';
  category: string;
  subject: string | null;
  body: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'BOUNCED';
  queuedAt: string;
  failureReason: string | null;
}

/**
 * Admin's own notification feed (the bell icon in the header). Shares the same
 * endpoint as customer/vendor/driver since GET /api/v1/notifications is
 * identity-scoped — an admin user gets THEIR own admin-targeted rows here
 * (escalation alerts, SLA breaches, compliance expiry warnings).
 */
@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .row { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
           padding: 16px 20px; margin-bottom: 8px; box-shadow: var(--shadow-1); }
    .row.unread { border-left: 4px solid var(--admn); }
    .sub { font-weight: 600; color: var(--ink-900); font-size: 15px; }
    .body { color: var(--ink-700); font-size: 14px; margin-top: 4px; }
    .meta { color: var(--ink-500); font-size: 11px; margin-top: 6px; letter-spacing: .3px; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: var(--r-pill);
            font-size: 10px; font-weight: 600; margin-left: 6px; }
    .pill.push  { background: var(--cust-soft); color: var(--cust-dark); }
    .pill.email { background: var(--admn-soft); color: var(--admn-dark); }
    .pill.sms   { background: var(--vndr-soft); color: var(--vndr-dark); }
    .pill.inapp { background: var(--ink-100); color: var(--ink-700); }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>My <em>notifications</em></h1>
    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">You're all caught up.</div> }
    @else {
      @for (n of items(); track n.id) {
        <div class="row" [class.unread]="n.status !== 'READ'">
          <div class="sub">
            {{ n.subject ?? n.category }}
            <span class="pill"
                  [class.push]="n.channel === 'PUSH'"
                  [class.email]="n.channel === 'EMAIL'"
                  [class.sms]="n.channel === 'SMS'"
                  [class.inapp]="n.channel === 'IN_APP'">{{ n.channel }}</span>
          </div>
          <div class="body">{{ n.body }}</div>
          <div class="meta">
            {{ n.category }} · {{ n.status }} · {{ n.queuedAt | date:'medium' }}
            @if (n.failureReason) { · FAILED: {{ n.failureReason }} }
          </div>
        </div>
      }
    }
  `
})
export class NotificationsComponent {
  private api = inject(ApiClient);
  loading = signal(true);
  items = signal<AdminNotification[]>([]);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.api.get<AdminNotification[]>('/notifications', { page: 0, size: 50 }).subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
