import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { formatDuration, humanize, msSince } from '../../shared/ui/urgency';

type Channel = 'PUSH' | 'SMS' | 'EMAIL' | 'IN_APP';
type Status = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'BOUNCED';

interface AdminNotification {
  id: string;
  userId: string;
  channel: Channel;
  category: string;
  subject: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  status: Status;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
}

/**
 * The admin's own alert feed.
 *
 * `GET /api/v1/notifications` is identity-scoped, so an admin sees the rows
 * addressed to them — escalations, SLA warnings, compliance expiry notices.
 * Unread and failed rows lead, because a bounced escalation is worse than no
 * escalation: it means the alert that should have pulled the admin into a
 * dispute never arrived.
 */
@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .feed { display: flex; flex-direction: column; gap: 8px; max-width: 860px; }
    .row {
      background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
      padding: 14px 18px; box-shadow: var(--shadow-1); border-left: 3px solid transparent;
    }
    .row.unread { border-left-color: var(--admn); }
    .row.failed { border-left-color: var(--err); background: color-mix(in srgb, var(--err-soft) 42%, var(--paper)); }
    .head { display: flex; align-items: baseline; gap: 8px; }
    .subject { font-size: 14px; font-weight: 650; color: var(--ink-900); flex: 1; }
    .when { font-size: 11.5px; color: var(--ink-500); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .body { font-size: 13px; color: var(--ink-700); margin-top: 5px; line-height: 1.55; }
    .meta { display: flex; align-items: center; gap: 6px; margin-top: 9px; flex-wrap: wrap; }
    .fail { font-size: 12px; color: var(--err-ink); font-weight: 600; margin-top: 6px; }

    .summary { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  `],
  template: `
    <app-page-header
      title="My" accent="alerts"
      subtitle="Escalations, SLA warnings and compliance notices addressed to your admin account. Unread and failed first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    @if (!loading() && !error() && items().length > 0) {
      <div class="summary">
        <span class="pill pill--brand">{{ unreadCount() }} unread</span>
        @if (failedCount() > 0) { <span class="pill pill--crit">{{ failedCount() }} never delivered</span> }
        <span class="pill pill--mute">{{ items().length }} in the last 50</span>
      </div>
    }

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="your alert feed"
          [loading]="loading()" [error]="error()"
          emptyTitle="You're all caught up"
          emptyDetail="Nothing has been sent to your admin account. SLA breaches, compliance expiries and escalations arrive here as well as by push."
          [clear]="true"
          (retry)="reload()" />
      </div>
    } @else {
      <div class="feed">
        @for (n of rows(); track n.id) {
          <div class="row" [class.unread]="n.status !== 'READ'"
               [class.failed]="n.status === 'FAILED' || n.status === 'BOUNCED'">
            <div class="head">
              <span class="subject">{{ n.subject ?? label(n.category) }}</span>
              <span class="when">{{ ago(n.queuedAt) }}</span>
            </div>
            <div class="body">{{ n.body }}</div>
            <div class="meta">
              <span class="pill"
                    [class.pill--info]="n.channel === 'PUSH'"
                    [class.pill--brand]="n.channel === 'EMAIL'"
                    [class.pill--vend]="n.channel === 'SMS'"
                    [class.pill--mute]="n.channel === 'IN_APP'">{{ n.channel }}</span>
              <span class="pill"
                    [class.pill--ok]="n.status === 'DELIVERED' || n.status === 'READ'"
                    [class.pill--warn]="n.status === 'QUEUED' || n.status === 'SENT'"
                    [class.pill--crit]="n.status === 'FAILED' || n.status === 'BOUNCED'">{{ label(n.status) }}</span>
              <span class="pill pill--outline">{{ label(n.category) }}</span>
            </div>
            @if (n.failureReason) { <div class="fail">Delivery failed — {{ n.failureReason }}</div> }
          </div>
        }
      </div>
    }
  `
})
export class NotificationsComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);

  loading = signal(true);
  error = signal<string | null>(null);
  items = signal<AdminNotification[]>([]);

  constructor() { this.reload(); }

  label(v: string) { return humanize(v); }
  ago(iso: string) {
    const ms = msSince(iso, this.clock.now());
    return ms === null ? '' : `${formatDuration(ms)} ago`;
  }

  readonly unreadCount = computed(() => this.items().filter(n => n.status !== 'READ').length);
  readonly failedCount = computed(() =>
    this.items().filter(n => n.status === 'FAILED' || n.status === 'BOUNCED').length);

  /** Failed first, then unread, then newest. */
  readonly rows = computed(() => {
    const weight = (n: AdminNotification) =>
      n.status === 'FAILED' || n.status === 'BOUNCED' ? 0 : n.status !== 'READ' ? 1 : 2;
    return [...this.items()].sort((a, b) =>
      weight(a) - weight(b) || Date.parse(b.queuedAt) - Date.parse(a.queuedAt));
  });

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<AdminNotification[]>('/notifications', { page: 0, size: 50 }).subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); this.clock.sync(); },
      error: e => {
        this.error.set(describeError(e, 'your alert feed'));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }
}
