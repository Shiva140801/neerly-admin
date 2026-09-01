import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';
import { describeActionError, describeError } from '../../shared/api-error';
import { DirectoryService, unknownParty } from '../../shared/directory.service';
import { label as enumLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { formatRupees } from '../../shared/ui/format';
import { RupeesPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, formatDuration, msSince } from '../../shared/ui/urgency';

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
 * V1.0 settles off-platform: the weekly job works out the amounts, the bank
 * transfer happens by hand, and the admin marks each one paid with a UTR. That
 * makes the interesting number *how long a vendor has been owed money* — a
 * pending payout is a supply-side relationship risk, not a ledger entry. So the
 * board leads with money owed and age, and separates held rows, which are stuck
 * on a human decision, from pending ones, which are stuck on a bank transfer.
 */
@Component({
  selector: 'app-payouts',
  standalone: true,
  imports: [
    CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent,
    WhenPipe, RupeesPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }

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
      subtitle="Settled by hand for now: the weekly job works out who is owed what, you make the bank transfer, then record the UTR here. Longest-owed first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
      <button type="button" class="btn btn--primary btn--sm" (click)="askRunWeekly()" [disabled]="running()">
        {{ running() ? 'Running…' : 'Run weekly job' }}
      </button>
    </app-page-header>

    @if (lastRun(); as run) {
      <!-- The job returned 200 and changed nothing visible, so success and
           silence were indistinguishable on a money screen. It now says what it
           found, including when the answer is "nothing". -->
      <div class="lede" [class.ok]="run.staged > 0" [class.warn]="run.staged === 0" role="status">
        {{ run.text }}
      </div>
    }

    @if (!loading() && !error() && items().length > 0) {
      <div class="totals">
        <div class="total">
          <div class="k">Owed to vendors</div>
          <div class="v" [class.warn]="owed() > 0">{{ owed() | rupees }}</div>
          <div class="n">{{ pendingCount() }} payout{{ pendingCount() === 1 ? '' : 's' }} pending transfer</div>
        </div>
        <div class="total">
          <div class="k">On hold</div>
          <div class="v">{{ held() | rupees }}</div>
          <div class="n">blocked on a decision, not a bank</div>
        </div>
        <div class="total">
          <div class="k">Commission earned</div>
          <div class="v">{{ commission() | rupees }}</div>
          <div class="n">across every row shown</div>
        </div>
      </div>
    }

    <div class="toolbar toolbar--split">
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
          emptyDetail="The weekly job works out who is owed what every Monday morning. Run it manually above if a scheduled run was missed."
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
                  <div class="sub-cell">staged {{ r.payout.createdAt | when:'date' }}</div>
                </td>
                <td>{{ r.payout.periodStart | when:'date' }} – {{ r.payout.periodEnd | when:'date' }}</td>
                <td>{{ vendorName(r.payout) }}</td>
                <td class="right">
                  <span class="amt">{{ r.payout.netTotal | rupees }}</span>
                  <div class="split">
                    {{ r.payout.grossTotal | rupees }} gross
                    − {{ r.payout.commissionTotal | rupees }} commission
                    − {{ r.payout.taxTotal | rupees }} tax
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
      <div class="lede crit mt-16" role="alert">
        {{ e }}
        <button type="button" class="btn btn--ghost btn--sm" style="margin-left:10px;"
                (click)="actionError.set(null)">Dismiss</button>
      </div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null || running()"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class PayoutsComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private toasts = inject(ToastService);
  private directory = inject(DirectoryService);

  /** What the last manual job run actually did — see the strip in the template. */
  lastRun = signal<{ staged: number; text: string } | null>(null);

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

  constructor() {
    this.reload();
    this.directory.ensureLoaded();
  }

  label(v: string) { return enumLabel(v); }
  dur(ms: number) { return formatDuration(ms); }

  /** A payout names its vendor by id alone; the name comes from the vendor list. */
  vendorName(p: Payout): string {
    return this.directory.vendorName(p.vendorId) ?? unknownParty('vendor', p.vendorId);
  }

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
      message: `${formatRupees(p.netTotal)} to ${this.vendorName(p)} stays put until released.`,
      confirmLabel: 'Place on hold',
      tone: 'danger',
      reason: { label: 'Hold reason', placeholder: 'Stale bank details, open dispute, pending claim…', required: true }
    });
    this.pending = r => this.hold(p, r.reason);
  }

  askRelease(p: Payout) {
    this.confirm.set({
      title: 'Release payout',
      message: `${formatRupees(p.netTotal)} to ${this.vendorName(p)} goes back into the pending queue for transfer.`,
      confirmLabel: 'Release',
      tone: 'primary'
    });
    this.pending = () => this.release(p);
  }

  askComplete(p: Payout) {
    this.confirm.set({
      title: 'Mark as paid',
      message: `Records ${formatRupees(p.netTotal)} as settled to ${this.vendorName(p)}.`,
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
    this.lastRun.set(null);
    const before = new Set(this.items().map(p => p.id));

    this.api.post('/admin/payouts/run').subscribe({
      // The endpoint answers 200 with nothing useful, so "did anything happen"
      // is settled by comparing the board before and after — a real observation,
      // not a claim the UI makes on the job's behalf.
      next: () => {
        this.api.get<Payout[]>('/admin/payouts', { page: 0, size: 200 }).subscribe({
          next: rows => {
            const all = Array.isArray(rows) ? rows : [];
            const fresh = all.filter(p => !before.has(p.id));
            const owed = fresh.reduce((sum, p) => sum + Number(p.netTotal ?? 0), 0);
            const summary = fresh.length
              ? {
                  staged: fresh.length,
                  text: `The job staged ${fresh.length} new payout${fresh.length === 1 ? '' : 's'} worth ${formatRupees(owed)}. They are in the list below, waiting on a bank transfer.`
                }
              : {
                  staged: 0,
                  text: 'The job ran and found nothing new to stage — every vendor with settled orders in the last completed week has already been paid or is already queued. Nothing changed.'
                };
            this.lastRun.set(summary);
            if (fresh.length) {
              this.toasts.success(
                `${fresh.length} payout${fresh.length === 1 ? '' : 's'} staged`,
                `${formatRupees(owed)} now waiting on a bank transfer.`
              );
            } else {
              this.toasts.warn('Payout job ran — nothing to stage', 'No vendor is newly owed for the last completed week.');
            }
            this.running.set(false);
            this.reload();
          },
          error: () => {
            // The job itself succeeded; only the read-back failed.
            this.lastRun.set({ staged: 0, text: 'The job ran, but the board could not be re-read to show what it staged. Refresh to see the current state.' });
            this.running.set(false);
          }
        });
      },
      error: e => { this.actionError.set(describeActionError(e, 'running the payout job')); this.running.set(false); }
    });
  }

  private hold(p: Payout, reason: string) {
    this.busyId.set(p.id);
    this.actionError.set(null);
    this.api.post(`/admin/payouts/${p.id}/hold`, { reason }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(`${formatRupees(p.netTotal)} held`, `${this.vendorName(p)} will not be paid until you release it.`);
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'holding this payout')); this.busyId.set(null); }
    });
  }

  private release(p: Payout) {
    this.busyId.set(p.id);
    this.actionError.set(null);
    this.api.post(`/admin/payouts/${p.id}/release`).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(`${formatRupees(p.netTotal)} released`, `Back in the pending queue for ${this.vendorName(p)}.`);
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'releasing this payout')); this.busyId.set(null); }
    });
  }

  private complete(p: Payout, utr: string) {
    this.busyId.set(p.id);
    this.actionError.set(null);
    // mark-completed takes the UTR as a query parameter, not a body.
    this.api.post(`/admin/payouts/${p.id}/mark-completed?utr=${encodeURIComponent(utr)}`).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          `${formatRupees(p.netTotal)} recorded as paid`,
          `${this.vendorName(p)} settled against UTR ${utr}. This cannot be walked back.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'recording this settlement')); this.busyId.set(null); }
    });
  }
}
