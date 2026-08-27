import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, formatDuration, humanize, msSince } from '../../shared/ui/urgency';

type PayoutStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'ON_HOLD';

interface Payout {
  id: string;
  vendorId: string;
  periodStart: string;
  periodEnd: string;
  grossTotal: number;
  commissionTotal: number;
  taxTotal: number;
  netTotal: number;
  status: PayoutStatus;
  razorpayPayoutId: string | null;
  utr: string | null;
  holdReason: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PayoutRow {
  payout: Payout;
  ageMs: number | null;
  severity: Severity;
}

/**
 * Vendor payout run.
 *
 * V1.0 settles off-platform: the weekly job stakes out the rows, the bank
 * transfer happens by hand, and the admin marks each one paid with a UTR. That
 * makes the interesting number *how long a vendor has been owed money* — a
 * pending payout is a supply-side relationship risk, not a ledger entry. So the
 * board leads with money owed and age, and separates held rows, which are stuck
 * on a human decision, from pending ones, which are stuck on a bank transfer.
 */
@Component({
  selector: 'app-payouts',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }

    .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--ink-100); margin-bottom: 18px; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--ink-200); }
    .total { background: var(--paper); padding: 14px 16px; }
    .total .k { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-500); }
    .total .v { font-size: 21px; font-weight: 750; color: var(--ink-900); margin-top: 4px; font-variant-numeric: tabular-nums; }
    .total .v.warn { color: var(--warn); }
    .total .n { font-size: 11.5px; color: var(--ink-500); margin-top: 2px; }

    .amt { font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }
    .age { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink-800); }
    .age.crit { color: var(--err); }
    .age.warn { color: var(--warn); }
    .split { font-size: 11.5px; color: var(--ink-500); margin-top: 3px; }
  `],
  template: `
    <app-page-header
      title="Payout" accent="run"
      subtitle="V1.0 settles by hand: the job stages the rows, you transfer, then record the UTR. Longest-owed first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
      <button type="button" class="btn btn--primary btn--sm" (click)="askRunWeekly()" [disabled]="running()">
        {{ running() ? 'Running…' : 'Run weekly job' }}
      </button>
    </app-page-header>

    @if (!loading() && !error() && items().length > 0) {
      <div class="totals">
        <div class="total">
          <div class="k">Owed to vendors</div>
          <div class="v" [class.warn]="owed() > 0">₹{{ owed() | number:'1.0-0' }}</div>
          <div class="n">{{ pendingCount() }} payout{{ pendingCount() === 1 ? '' : 's' }} pending transfer</div>
        </div>
        <div class="total">
          <div class="k">On hold</div>
          <div class="v">₹{{ held() | number:'1.0-0' }}</div>
          <div class="n">blocked on a decision, not a bank</div>
        </div>
        <div class="total">
          <div class="k">Commission earned</div>
          <div class="v">₹{{ commission() | number:'1.0-0' }}</div>
          <div class="n">across every row shown</div>
        </div>
      </div>
    }

    <div class="toolbar">
      <div class="chips">
        @for (s of statuses; track $index) {
          <button type="button" class="chip" [class.active]="filter() === s" (click)="filter.set(s); reload()">
            {{ s === null ? 'All' : label(s) }}
          </button>
        }
      </div>
    </div>

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the payout run"
          [loading]="loading()" [error]="error()"
          emptyTitle="No payouts in this view"
          emptyDetail="The weekly job stages payouts every Monday morning. Run it manually above if a scheduled run was missed."
          [clear]="filter() === 'PENDING'"
          (retry)="reload()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Waiting</th>
              <th>Period</th>
              <th>Vendor</th>
              <th class="right">Net owed</th>
              <th>Status</th>
              <th>UTR</th>
              <th class="right">Settle</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.payout.id) {
              <tr [class.sev-crit]="r.severity === 'crit'" [class.sev-warn]="r.severity === 'warn'">
                <td>
                  <div class="age" [class.crit]="r.severity === 'crit'" [class.warn]="r.severity === 'warn'">
                    {{ r.ageMs !== null ? dur(r.ageMs) : '—' }}
                  </div>
                  <div class="sub-cell">staged {{ r.payout.createdAt | date:'d MMM' }}</div>
                </td>
                <td>{{ r.payout.periodStart | date:'d MMM' }} – {{ r.payout.periodEnd | date:'d MMM' }}</td>
                <td class="mono" style="font-size:12px;">{{ r.payout.vendorId.slice(0, 8) }}</td>
                <td class="right">
                  <span class="amt">₹{{ r.payout.netTotal | number:'1.2-2' }}</span>
                  <div class="split">
                    ₹{{ r.payout.grossTotal | number:'1.0-0' }} gross
                    − ₹{{ r.payout.commissionTotal | number:'1.0-0' }} commission
                    − ₹{{ r.payout.taxTotal | number:'1.0-0' }} tax
                  </div>
                </td>
                <td>
                  <span class="pill"
                        [class.pill--warn]="r.payout.status === 'PENDING'"
                        [class.pill--info]="r.payout.status === 'PROCESSING'"
                        [class.pill--ok]="r.payout.status === 'COMPLETED'"
                        [class.pill--crit]="r.payout.status === 'FAILED'"
                        [class.pill--mute]="r.payout.status === 'ON_HOLD'">
                    {{ label(r.payout.status) }}
                  </span>
                  @if (r.payout.holdReason) { <div class="sub-cell">{{ r.payout.holdReason }}</div> }
                  @if (r.payout.failureReason) { <div class="sub-cell">{{ r.payout.failureReason }}</div> }
                </td>
                <td class="mono" style="font-size:12px;">{{ r.payout.utr ?? '—' }}</td>
                <td class="right">
                  <span class="row-flex gap-6" style="justify-content:flex-end;">
                    @if (r.payout.status === 'PENDING' || r.payout.status === 'PROCESSING') {
                      <button type="button" class="btn btn--ok btn--sm" (click)="askComplete(r.payout)"
                              [disabled]="busyId() === r.payout.id">Mark paid</button>
                    }
                    @if (r.payout.status === 'PENDING') {
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askHold(r.payout)"
                              [disabled]="busyId() === r.payout.id">Hold</button>
                    }
                    @if (r.payout.status === 'ON_HOLD') {
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askRelease(r.payout)"
                              [disabled]="busyId() === r.payout.id">Release</button>
                    }
                    @if (r.payout.status === 'COMPLETED' || r.payout.status === 'FAILED') {
                      <span class="muted">settled</span>
                    }
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (actionError(); as e) {
      <div class="panel mt-16"><div class="panel-body" style="color:var(--err-ink);font-weight:600;">{{ e }}</div></div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null || running()"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class PayoutsComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);

  statuses: (PayoutStatus | null)[] = [null, 'PENDING', 'ON_HOLD', 'PROCESSING', 'COMPLETED', 'FAILED'];
  filter = signal<PayoutStatus | null>(null);
  loading = signal(true);
  running = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  busyId = signal<string | null>(null);
  items = signal<Payout[]>([]);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.reload(); }

  label(v: string) { return humanize(v); }
  dur(ms: number) { return formatDuration(ms); }

  readonly rows = computed<PayoutRow[]>(() => {
    const now = this.clock.now();
    return this.items()
      .map(payout => {
        const ageMs = msSince(payout.createdAt, now);
        const unsettled = payout.status === 'PENDING' || payout.status === 'ON_HOLD';
        const days = (ageMs ?? 0) / 86_400_000;
        const severity: Severity = !unsettled ? 'idle' : days >= 14 ? 'crit' : days >= 7 ? 'warn' : 'ok';
        return { payout, ageMs, severity };
      })
      .sort((a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0));
  });

  readonly pendingCount = computed(() => this.items().filter(p => p.status === 'PENDING').length);
  readonly owed = computed(() =>
    this.items().filter(p => p.status === 'PENDING' || p.status === 'PROCESSING')
      .reduce((s, p) => s + Number(p.netTotal ?? 0), 0));
  readonly held = computed(() =>
    this.items().filter(p => p.status === 'ON_HOLD').reduce((s, p) => s + Number(p.netTotal ?? 0), 0));
  readonly commission = computed(() =>
    this.items().reduce((s, p) => s + Number(p.commissionTotal ?? 0), 0));

  reload() {
    this.loading.set(true);
    this.error.set(null);
    const f = this.filter();
    this.api.get<Payout[]>('/admin/payouts', f ? { status: f, page: 0, size: 200 } : { page: 0, size: 200 }).subscribe({
      next: rows => { this.items.set(Array.isArray(rows) ? rows : []); this.loading.set(false); this.clock.sync(); },
      error: e => {
        this.error.set(describeError(e, 'the payout run'));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }

  askRunWeekly() {
    this.confirm.set({
      title: 'Run the weekly payout job',
      message: 'Stages payouts for every vendor with settled orders in the last completed week.',
      confirmLabel: 'Run job now',
      tone: 'primary',
      consequence: 'Safe to re-run — vendors already staged for this period are not double-counted.'
    });
    this.pending = () => this.runWeekly();
  }

  askHold(p: Payout) {
    this.confirm.set({
      title: 'Hold payout',
      message: `₹${Number(p.netTotal).toFixed(2)} to vendor ${p.vendorId.slice(0, 8)} stays put until released.`,
      confirmLabel: 'Place on hold',
      tone: 'danger',
      reason: { label: 'Hold reason', placeholder: 'Stale bank details, open dispute, pending claim…', required: true }
    });
    this.pending = r => this.hold(p, r.reason);
  }

  askRelease(p: Payout) {
    this.confirm.set({
      title: 'Release payout',
      message: `₹${Number(p.netTotal).toFixed(2)} goes back into the pending queue for transfer.`,
      confirmLabel: 'Release',
      tone: 'primary'
    });
    this.pending = () => this.release(p);
  }

  askComplete(p: Payout) {
    this.confirm.set({
      title: 'Mark as paid',
      message: `Records ₹${Number(p.netTotal).toFixed(2)} as settled to vendor ${p.vendorId.slice(0, 8)}.`,
      confirmLabel: 'Record payment',
      tone: 'ok',
      reason: { label: 'UTR / bank reference', placeholder: 'e.g. N123456789012345', required: true },
      consequence: 'Only do this once the bank transfer has actually left. The status cannot be walked back.'
    });
    this.pending = r => this.complete(p, r.reason);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(result);
  }

  private runWeekly() {
    this.running.set(true);
    this.actionError.set(null);
    this.api.post('/admin/payouts/run').subscribe({
      next: () => { this.running.set(false); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the payout job')); this.running.set(false); }
    });
  }

  private hold(p: Payout, reason: string) {
    this.busyId.set(p.id);
    this.actionError.set(null);
    this.api.post(`/admin/payouts/${p.id}/hold`, { reason }).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the hold')); this.busyId.set(null); }
    });
  }

  private release(p: Payout) {
    this.busyId.set(p.id);
    this.actionError.set(null);
    this.api.post(`/admin/payouts/${p.id}/release`).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the release')); this.busyId.set(null); }
    });
  }

  private complete(p: Payout, utr: string) {
    this.busyId.set(p.id);
    this.actionError.set(null);
    // mark-completed takes the UTR as a query parameter, not a body.
    this.api.post(`/admin/payouts/${p.id}/mark-completed?utr=${encodeURIComponent(utr)}`).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the settlement')); this.busyId.set(null); }
    });
  }
}
