import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient, Page } from '../../core/api/api-client';
import type { AdminRefund } from '../../shared/attention.service';
import { describeActionError, describeError } from '../../shared/api-error';
import { DirectoryService, unknownParty } from '../../shared/directory.service';
import { label as enumLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { formatRupees, formatWhen } from '../../shared/ui/format';
import { RupeesPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { MS_DAY, MS_HOUR, Severity, formatDuration, msSince } from '../../shared/ui/urgency';

type RefundStatus = AdminRefund['status'];

const STATUSES: RefundStatus[] = [
  'REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED'
];

interface RefundRow {
  refund: AdminRefund;
  ageMs: number | null;
  severity: Severity;
  /** Time left against the 24h manual-review SLA, only meaningful while REQUESTED. */
  slaLabel: string;
}

/**
 * Refund desk.
 *
 * PRD §13.2 puts a 24-hour SLA on every manual-review refund, so a request is
 * not just a row — it is a clock. The queue leads with how long each request
 * has been sitting and sorts oldest-first, and the header carries the total
 * rupees held up so the cash impact of leaving the queue is visible.
 *
 * Two wire-level bugs are fixed here: the old screen read `mode`/`createdAt`
 * (the DTO sends `refundMode`/`requestedAt`, so both columns rendered blank),
 * and it posted `{note}` to the reject endpoint, which expects `{reason}` and
 * rejected the call as a validation failure.
 */
@Component({
  selector: 'app-refunds',
  standalone: true,
  imports: [
    CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent,
    WhenPipe, RupeesPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }


    .age { font-weight: 750; font-variant-numeric: tabular-nums; font-size: 13.5px; color: var(--ink-800); }
    .age.crit { color: var(--err); }
    .age.warn { color: var(--warn); }
    .sla { font-size: 11.5px; color: var(--ink-500); margin-top: 2px; }
    .amt { font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }
    .reason { max-width: 34ch; color: var(--ink-600); font-size: 12.5px; line-height: 1.45; }
  `],
  template: `
    <app-page-header
      title="Refund" accent="desk"
      subtitle="Manual-review refunds carry a 24-hour SLA. Oldest request first — the clock started when the customer asked, not when you opened this.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar toolbar--split">
      <div class="chips">
        @for (s of statuses; track s) {
          <button type="button" class="chip" [class.active]="status() === s" (click)="status.set(s); reload()">
            {{ label(s) }}
            @if (status() === s && !loading()) { <span class="count">{{ rows().length }}</span> }
          </button>
        }
      </div>
    </div>

    @if (!loading() && !error() && rows().length > 0 && status() === 'REQUESTED') {
      <div class="lede" [class.crit]="lede().severity === 'crit'"
           [class.warn]="lede().severity === 'warn'"
           [class.ok]="lede().severity === 'ok'">{{ lede().text }}</div>
    }

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the refund queue"
          [loading]="loading()" [error]="error()"
          [emptyTitle]="status() === 'REQUESTED' ? 'No refunds waiting on you' : 'Nothing in ' + label(status())"
          [emptyDetail]="status() === 'REQUESTED'
            ? 'Auto-approved scenarios — vendor rejection, accept timeout, the 5-minute grace cancel — never reach this queue. Only judgement calls land here.'
            : 'No refund currently carries this status.'"
          [clear]="status() === 'REQUESTED'"
          (retry)="reload()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ status() === 'REQUESTED' ? 'Waiting' : 'Requested' }}</th>
              <th class="right">Amount</th>
              <th>Who asked</th>
              <th>Destination</th>
              <th>Reason given</th>
              <th>Order</th>
              <th>Status</th>
              <th class="right">Decide</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.refund.id) {
              <tr [class.sev-crit]="r.severity === 'crit'" [class.sev-warn]="r.severity === 'warn'">
                <td>
                  <div class="age" [class.crit]="r.severity === 'crit'" [class.warn]="r.severity === 'warn'">
                    {{ r.ageMs !== null ? dur(r.ageMs) : '—' }}
                  </div>
                  <div class="sla">{{ r.slaLabel }}</div>
                </td>
                <td class="right"><span class="amt">{{ r.refund.amount | rupees }}</span></td>
                <td>
                  <div class="primary-cell">{{ customerName(r.refund) ?? unknownCustomer(r.refund) }}</div>
                  @if (vendorName(r.refund); as v) { <div class="sub-cell">order fulfilled by {{ v }}</div> }
                </td>
                <td>
                  <span class="pill"
                        [class.pill--ok]="r.refund.refundMode === 'WALLET'"
                        [class.pill--info]="r.refund.refundMode === 'ORIGINAL'"
                        [class.pill--mute]="r.refund.refundMode === 'CASH'">
                    {{ label(r.refund.refundMode) }}
                  </span>
                  <div class="sub-cell">{{ modeNote(r.refund.refundMode) }}</div>
                </td>
                <td class="reason">{{ r.refund.reason }}</td>
                <!-- The raw orderId cannot be reconciled with the NEE-… number on
                     the board, so the human reference is shown wherever it can be
                     resolved and the id is labelled as unresolved when it cannot. -->
                <td class="mono" style="font-size:12px;">{{ orderRef(r.refund) }}</td>
                <td>
                  <span class="pill"
                        [class.pill--warn]="r.refund.status === 'REQUESTED'"
                        [class.pill--info]="r.refund.status === 'APPROVED' || r.refund.status === 'PROCESSING'"
                        [class.pill--ok]="r.refund.status === 'COMPLETED'"
                        [class.pill--crit]="r.refund.status === 'REJECTED' || r.refund.status === 'FAILED'">
                    {{ label(r.refund.status) }}
                  </span>
                  @if (r.refund.failureReason) { <div class="sub-cell">{{ r.refund.failureReason }}</div> }
                  @else if (r.refund.rejectionReason) { <div class="sub-cell">{{ r.refund.rejectionReason }}</div> }
                  @else if (r.refund.completedAt) { <div class="sub-cell">{{ r.refund.completedAt | when }}</div> }
                </td>
                <td class="right">
                  @if (r.refund.status === 'REQUESTED') {
                    <span class="row-flex gap-6" style="justify-content:flex-end;">
                      <button type="button" class="btn btn--ok btn--sm" (click)="askApprove(r.refund)"
                              [disabled]="busyId() === r.refund.id">Approve</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askReject(r.refund)"
                              [disabled]="busyId() === r.refund.id">Reject</button>
                    </span>
                  } @else {
                    <span class="muted">decided</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (actionError(); as e) {
      <div class="lede crit mt-16" role="alert">
        {{ e }}
        <button type="button" class="btn btn--ghost btn--sm" style="margin-left:10px;"
                (click)="actionError.set(null)">Dismiss</button>
      </div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class RefundsComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private toasts = inject(ToastService);
  private directory = inject(DirectoryService);

  statuses = STATUSES;
  status = signal<RefundStatus>('REQUESTED');
  loading = signal(true);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  busyId = signal<string | null>(null);
  items = signal<AdminRefund[]>([]);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() {
    this.reload();
    this.directory.ensureLoaded();
  }

  label(v: string) { return enumLabel(v); }
  dur(ms: number) { return formatDuration(ms); }

  customerName(r: AdminRefund): string | null {
    return r.customerName ?? this.directory.customerName(r.customerId);
  }

  vendorName(r: AdminRefund): string | null {
    return r.vendorName ?? this.directory.order(r.orderId)?.vendorName ?? null;
  }

  unknownCustomer(r: AdminRefund) { return unknownParty('customer', r.customerId); }

  /** The order number printed on the board, when it can be resolved. */
  orderRef(r: AdminRefund): string {
    if (!r.orderId) return 'no order';
    return r.orderNumber ?? this.directory.orderNumber(r.orderId) ?? unknownParty('order', r.orderId);
  }

  modeNote(mode: AdminRefund['refundMode']): string {
    switch (mode) {
      case 'WALLET': return 'instant to platform wallet';
      case 'ORIGINAL': return 'UPI 2–3 days · card 3–7 days';
      default: return 'settled off-platform';
    }
  }

  readonly rows = computed<RefundRow[]>(() => {
    const now = this.clock.now();
    const awaiting = this.status() === 'REQUESTED';
    return this.items()
      .map(refund => {
        const ageMs = msSince(refund.requestedAt, now);
        let severity: Severity = 'ok';
        let slaLabel = `requested ${formatWhen(refund.requestedAt, 'date')}`;
        if (awaiting && ageMs !== null) {
          const left = MS_DAY - ageMs;
          severity = left <= 0 ? 'crit' : left <= 6 * MS_HOUR ? 'warn' : 'ok';
          slaLabel = left <= 0 ? `SLA blown by ${formatDuration(left)}` : `${formatDuration(left)} of SLA left`;
        }
        return { refund, ageMs, severity, slaLabel };
      })
      // Oldest request first while deciding; newest first once decided.
      .sort((a, b) => awaiting ? (b.ageMs ?? 0) - (a.ageMs ?? 0) : (a.ageMs ?? 0) - (b.ageMs ?? 0));
  });

  readonly exposure = computed(() =>
    this.items().reduce((sum, r) => sum + Number(r.amount ?? 0), 0));

  readonly lede = computed<{ severity: Severity; text: string }>(() => {
    const rows = this.rows();
    const blown = rows.filter(r => r.severity === 'crit').length;
    const money = formatRupees(Math.round(this.exposure()));
    if (blown) {
      return { severity: 'crit', text: `${blown} request${blown === 1 ? ' is' : 's are'} past the 24-hour SLA. ${money} held up across ${rows.length} request${rows.length === 1 ? '' : 's'}.` };
    }
    const soon = rows.filter(r => r.severity === 'warn').length;
    if (soon) {
      return { severity: 'warn', text: `${soon} request${soon === 1 ? '' : 's'} breach${soon === 1 ? 'es' : ''} SLA within six hours. ${money} held up in total.` };
    }
    return { severity: 'ok', text: `${money} awaiting a decision, all comfortably inside the 24-hour SLA.` };
  });

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<Page<AdminRefund>>('/admin/refunds', { status: this.status(), page: 0, size: 100 }).subscribe({
      next: res => { this.items.set(res?.content ?? []); this.loading.set(false); this.clock.sync(); },
      error: e => {
        this.error.set(describeError(e, 'the refund queue'));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }

  askApprove(r: AdminRefund) {
    this.confirm.set({
      title: 'Approve refund',
      message: `${formatRupees(r.amount)} back to ${this.customerName(r) ?? 'the customer'} via ${enumLabel(r.refundMode).toLowerCase()}.`,
      confirmLabel: 'Approve refund',
      tone: 'ok',
      reason: { label: 'Note (optional)', placeholder: 'Why you allowed it — useful when the same customer files again.' },
      consequence: r.refundMode === 'WALLET'
        ? 'Wallet credit lands instantly and cannot be clawed back.'
        : 'Money leaves the platform through the original payment rail and cannot be clawed back.'
    });
    this.pending = res => this.approve(r, res.reason);
  }

  askReject(r: AdminRefund) {
    this.confirm.set({
      title: 'Reject refund',
      message: `${this.customerName(r) ?? this.unknownCustomer(r)} asked for ${formatRupees(r.amount)} — "${r.reason}".`,
      confirmLabel: 'Reject request',
      tone: 'danger',
      reason: { label: 'Reason', placeholder: 'The customer sees this. Be specific — vague rejections come back as disputes.', required: true }
    });
    this.pending = res => this.reject(r, res.reason);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(result);
  }

  private approve(r: AdminRefund, note: string) {
    this.busyId.set(r.id);
    this.actionError.set(null);
    this.api.post(`/admin/refunds/${r.id}/approve`, { note }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          `Refund approved — ${formatRupees(r.amount)}`,
          r.refundMode === 'WALLET'
            ? `Credited to ${this.customerName(r) ?? 'the customer'}'s wallet immediately.`
            : `On its way back to ${this.customerName(r) ?? 'the customer'} through the original payment rail.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'approving this refund')); this.busyId.set(null); }
    });
  }

  private reject(r: AdminRefund, reason: string) {
    this.busyId.set(r.id);
    this.actionError.set(null);
    // RejectRefundRequest requires `reason`; posting `note` failed validation.
    this.api.post(`/admin/refunds/${r.id}/reject`, { reason }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          'Refund rejected',
          `No money moved. ${this.customerName(r) ?? 'The customer'} sees your reason and can dispute it.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'rejecting this refund')); this.busyId.set(null); }
    });
  }
}
