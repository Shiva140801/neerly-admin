import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';
import { describeActionError, describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import { EvidenceService } from '../../shared/evidence.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';

/** Mirror of backend `AdminBankAccountRow`. */
export interface BankAccountRow {
  id: string;
  vendorId: string;
  shopName: string | null;
  accountHolderName: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string | null;
  branchName: string | null;
  accountType: string;
  chequeProofS3: string | null;
  addedAt: string;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';
  rejectionReason: string | null;
}

/**
 * Bank accounts to verify — a shop's weekly payout goes nowhere until its account is
 * checked here. Compare the holder name and the last four digits with the cancelled
 * cheque or passbook photo; the full number is never shown. Penny-drop replaces this
 * desk in V1.1.
 */
@Component({
  selector: 'app-bank-accounts',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Bank accounts to verify" accent="money"
      subtitle="Shops are not paid until their account is verified. Oldest first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="panel">
      @if (loading() || error() || rows().length === 0) {
        <app-data-state what="bank accounts" [loading]="loading()" [error]="error()"
          emptyTitle="No bank account is waiting" [clear]="true" (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Added</th><th>Shop</th><th>Holder</th><th>Account</th><th>IFSC</th><th>Proof</th><th class="right"></th></tr></thead>
            <tbody>
              @for (a of rows(); track a.id) {
                <tr>
                  <td>{{ a.addedAt | when }}</td>
                  <td><strong>{{ a.shopName ?? a.vendorId.slice(0, 8) }}</strong></td>
                  <td>{{ a.accountHolderName }}</td>
                  <td class="mono">{{ a.accountNumberMasked }}<div class="sub-cell">{{ a.accountType }}</div></td>
                  <td class="mono">{{ a.ifsc }}
                    @if (a.bankName) { <div class="sub-cell">{{ a.bankName }}{{ a.branchName ? ' · ' + a.branchName : '' }}</div> }
                  </td>
                  <td>
                    @if (a.chequeProofS3; as key) {
                      @if (evidence.link(key)(); as l) {
                        @if (l.url) { <a [href]="l.url" target="_blank" rel="noopener">Open cheque</a> }
                        @else if (l.state === 'loading') { <span class="sub-cell">Loading…</span> }
                        @else { <span class="sub-cell">{{ l.reason }}</span> }
                      }
                    } @else { <span class="sub-cell crit">No proof uploaded</span> }
                  </td>
                  <td class="right">
                    <span class="row-flex gap-6" style="justify-content:flex-end;">
                      <button type="button" class="btn btn--ok btn--sm" (click)="askVerify(a)" [disabled]="busy()">Verify…</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askReject(a)" [disabled]="busy()">Reject…</button>
                    </span>
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
export class BankAccountsComponent {
  private api = inject(ApiClient);
  private toasts = inject(ToastService);
  readonly evidence = inject(EvidenceService);

  readonly rows = signal<BankAccountRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<BankAccountRow[]>('/admin/vendor-bank-accounts/pending', { page: 0, size: 100 }).subscribe({
      next: rows => { this.rows.set(rows ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'bank accounts')); this.loading.set(false); }
    });
  }

  askVerify(a: BankAccountRow) {
    this.confirm.set({
      title: 'Verify bank account',
      message: `${a.accountHolderName} · ${a.accountNumberMasked} · ${a.ifsc} for ${a.shopName ?? 'this shop'}.`,
      consequence: 'Weekly payouts will go to this account. Check the name and last four digits against the cheque first.',
      confirmLabel: 'Verify', tone: 'ok'
    });
    this.pending = () => this.act(`/admin/vendor-bank-accounts/${a.id}/verify`, {}, `${a.shopName ?? 'Shop'}'s account verified`);
  }

  askReject(a: BankAccountRow) {
    this.confirm.set({
      title: 'Reject bank account',
      message: `${a.accountHolderName} · ${a.accountNumberMasked} for ${a.shopName ?? 'this shop'}.`,
      consequence: 'The shop sees your reason and must add the account again. No payout until then.',
      confirmLabel: 'Reject', tone: 'danger',
      reason: { label: 'What the shop should fix', placeholder: "e.g. Name on the cheque doesn't match", required: true }
    });
    this.pending = r => this.act(`/admin/vendor-bank-accounts/${a.id}/reject`, { reason: r.reason }, 'Account rejected — the shop has been told why');
  }

  run(r: ConfirmResult) { const p = this.pending; this.pending = null; p?.(r); }

  private act(path: string, body: unknown, done: string) {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.post<BankAccountRow>(path, body).subscribe({
      next: () => { this.busy.set(false); this.confirm.set(null); this.toasts.success(done); this.reload(); },
      error: e => { this.busy.set(false); this.confirm.set(null); this.actionError.set(describeActionError(e, 'reviewing this bank account')); }
    });
  }
}
