import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient, Page } from '../../core/api/api-client';
import { describeActionError, describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';

/** Mirror of backend `WithdrawalView`. */
export interface Withdrawal {
  id: string;
  userId: string;
  amount: number;
  upiId: string;
  status: 'REQUESTED' | 'PAID' | 'FAILED';
  requestedAt: string;
  processedAt: string | null;
  utr: string | null;
  failureReason: string | null;
}

/**
 * Customer withdrawals — wallet money going back to a UPI ID.
 *
 * The amount already left the customer's wallet when they asked, so a row here is a
 * customer waiting for money. Pay it outside the platform and record the UTR, or mark it
 * failed and the money returns to their wallet. Only real money can be withdrawn —
 * referral and promo credit never reaches this desk.
 */
@Component({
  selector: 'app-withdrawals',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Withdrawals" accent="money"
      subtitle="Customers waiting for wallet money on their UPI. Oldest first — the money has already left their wallet.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    @if (rules(); as r) {
      <p class="lede">Customers can withdraw up to ₹{{ r.dailyMax }} a day, and money they added or got refunded in the last
        {{ r.holdDays }} {{ r.holdDays === '1' ? 'day' : 'days' }} can only be spent, not withdrawn (Config › Wallet).</p>
    }

    <div class="toolbar">
      <div class="chips">
        @for (s of statuses; track s) {
          <button type="button" class="chip" [class.active]="status() === s" (click)="status.set(s); reload()">{{ s }}</button>
        }
      </div>
    </div>

    <div class="panel">
      @if (loading() || error() || rows().length === 0) {
        <app-data-state what="withdrawals" [loading]="loading()" [error]="error()"
          [emptyTitle]="status() === 'REQUESTED' ? 'Nobody is waiting for a withdrawal' : 'None here'"
          [clear]="status() === 'REQUESTED'" (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Asked</th><th>Amount</th><th>To</th><th>Customer</th><th>Status</th><th class="right"></th></tr></thead>
            <tbody>
              @for (w of rows(); track w.id) {
                <tr>
                  <td>{{ w.requestedAt | when }}</td>
                  <td class="num"><strong>₹{{ w.amount }}</strong></td>
                  <td class="mono">{{ w.upiId }}</td>
                  <td class="mono">{{ w.userId.slice(0, 8) }}</td>
                  <td>
                    <span class="pill" [class.pill--warn]="w.status === 'REQUESTED'" [class.pill--ok]="w.status === 'PAID'"
                          [class.pill--crit]="w.status === 'FAILED'">{{ w.status }}</span>
                    @if (w.utr) { <div class="sub-cell mono">UTR {{ w.utr }}</div> }
                    @if (w.failureReason) { <div class="sub-cell">{{ w.failureReason }}</div> }
                  </td>
                  <td class="right">
                    @if (w.status === 'REQUESTED') {
                      <span class="row-flex gap-6" style="justify-content:flex-end;">
                        <button type="button" class="btn btn--ok btn--sm" (click)="askPaid(w)" [disabled]="busy()">Mark paid…</button>
                        <button type="button" class="btn btn--danger btn--sm" (click)="askFail(w)" [disabled]="busy()">Failed…</button>
                      </span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (actionError(); as e) { <div class="lede crit mt-16" role="alert">{{ e }}</div> }

    <app-confirm-dialog [request]="confirm()" [busy]="busy()"
                        (confirmed)="run($event)" (cancelled)="confirm.set(null)" />
  `
})
export class WithdrawalsComponent {
  private api = inject(ApiClient);
  private toasts = inject(ToastService);

  readonly statuses = ['REQUESTED', 'PAID', 'FAILED'] as const;
  readonly status = signal<'REQUESTED' | 'PAID' | 'FAILED'>('REQUESTED');
  readonly rows = signal<Withdrawal[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  /** The two limits the server enforces before a request lands here — context, not a gate. */
  readonly rules = signal<{ holdDays: string; dailyMax: string } | null>(null);

  constructor() {
    this.reload();
    this.api.get<{ key: string; value: string }[]>('/admin/config').subscribe({
      next: rows => {
        const v = (k: string) => rows?.find(r => r.key === k)?.value;
        const holdDays = v('wallet.withdraw_hold_days'), dailyMax = v('wallet.withdraw_daily_max');
        if (holdDays && dailyMax) this.rules.set({ holdDays, dailyMax });
      },
      error: () => this.rules.set(null)
    });
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<Page<Withdrawal>>('/admin/wallet/withdrawals', { status: this.status(), page: 0, size: 100 }).subscribe({
      next: p => { this.rows.set(p?.content ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'withdrawals')); this.loading.set(false); }
    });
  }

  askPaid(w: Withdrawal) {
    this.confirm.set({
      title: 'Mark withdrawal paid',
      message: `₹${w.amount} sent to ${w.upiId}.`,
      consequence: 'Record the bank reference so the customer and support can trace the transfer.',
      confirmLabel: 'Mark paid', tone: 'ok',
      reason: { label: 'UTR / bank reference', placeholder: 'e.g. 412345678901', required: true }
    });
    this.pending = r => this.act(w, `/admin/wallet/withdrawals/${w.id}/mark-paid`, { utr: r.reason }, `₹${w.amount} marked paid`);
  }

  askFail(w: Withdrawal) {
    this.confirm.set({
      title: 'Withdrawal failed',
      message: `₹${w.amount} to ${w.upiId} didn't go through.`,
      consequence: "The money goes back into the customer's wallet straight away.",
      confirmLabel: 'Return money to wallet', tone: 'danger',
      reason: { label: 'What went wrong', placeholder: 'e.g. UPI ID does not exist', required: true }
    });
    this.pending = r => this.act(w, `/admin/wallet/withdrawals/${w.id}/fail`, { reason: r.reason }, `₹${w.amount} returned to the wallet`);
  }

  run(r: ConfirmResult) { const p = this.pending; this.pending = null; p?.(r); }

  private act(w: Withdrawal, path: string, body: unknown, done: string) {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.post<Withdrawal>(path, body).subscribe({
      next: () => { this.busy.set(false); this.confirm.set(null); this.toasts.success(done); this.reload(); },
      error: e => { this.busy.set(false); this.confirm.set(null); this.actionError.set(describeActionError(e, 'updating this withdrawal')); }
    });
  }
}
