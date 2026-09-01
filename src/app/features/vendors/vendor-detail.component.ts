import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VendorService } from './vendor.service';
import type { VendorResponse } from './vendor.model';
import { describeActionError, describeError } from '../../shared/api-error';
import { label as enumLabel, shortLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { CountPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import {
  Severity, daysUntilDate, expiryLabel, expirySeverity, formatDuration, msSince
} from '../../shared/ui/urgency';

/**
 * Single-vendor review.
 *
 * Opened from the queue when the row-level summary isn't enough to decide. The
 * page leads with the verdict-relevant facts — how long they have waited, what
 * is missing, what the licence says — and keeps approve/reject/suspend in a
 * sticky rail so the decision is never below the fold.
 *
 * Reject and suspend both require a reason on the wire, so both go through the
 * inline reason field rather than a bare button.
 */
@Component({
  selector: 'app-vendor-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent, ConfirmDialogComponent, WhenPipe, CountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .back { font-size: 12.5px; color: var(--ink-500); text-decoration: none; font-weight: 600; }
    .back:hover { color: var(--admn); }

    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
    @media (max-width: 1060px) { .grid { grid-template-columns: 1fr; } }

    .verdict-strip {
      display: flex; align-items: center; gap: 12px;
      padding: 13px 18px; border-radius: var(--r-md); margin-bottom: 18px;
      font-size: 13.5px; font-weight: 650; line-height: 1.45;
    }
    .verdict-strip.crit { background: var(--err-soft);  color: var(--err-ink); }
    .verdict-strip.warn { background: var(--warn-soft); color: var(--warn-ink); }
    .verdict-strip.ok   { background: var(--ok-soft);   color: var(--ok-ink); }

    .kv { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 11px 16px; }
    .kv dt { font-size: 12.5px; color: var(--ink-500); font-weight: 600; }
    .kv dd { margin: 0; font-size: 13.5px; color: var(--ink-900); font-weight: 550; word-break: break-word; }

    .chip-list { display: flex; flex-wrap: wrap; gap: 5px; }

    .stat-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--ink-100); }
    .stat { background: var(--paper); padding: 14px 16px; }
    .stat .k { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-500); }
    .stat .v { font-size: 21px; font-weight: 750; color: var(--ink-900); margin-top: 4px; font-variant-numeric: tabular-nums; }
    .stat .v.crit { color: var(--err); }
    .stat .v.warn { color: var(--warn); }
    .stat .n { font-size: 11.5px; color: var(--ink-500); margin-top: 2px; }

    .rail { position: sticky; top: 22px; }
    .action-block { padding: 16px 18px; border-bottom: 1px solid var(--ink-100); }
    .action-block:last-child { border-bottom: 0; }
    .action-block p { margin: 0 0 10px; font-size: 12.5px; color: var(--ink-600); line-height: 1.5; }
    .action-block .btn { width: 100%; }
    .err-line { color: var(--err-ink); font-size: 12.5px; font-weight: 600; margin-top: 8px; }
  `],
  template: `
    @if (vendor(); as v) {
      <a class="back" routerLink="/vendors">← Back to vendor desk</a>

      <app-page-header [title]="v.businessName" [subtitle]="subtitle()" />

      <div class="verdict-strip"
           [class.crit]="verdict().severity === 'crit'"
           [class.warn]="verdict().severity === 'warn'"
           [class.ok]="verdict().severity === 'ok'">
        {{ verdict().text }}
      </div>

      <div class="grid">
        <div class="stack gap-20">
          <div class="panel">
            <div class="panel-head">
              <h2>Application</h2>
              <span class="row-flex gap-6">
                <span class="pill pill--brand tier" [title]="v.tier">{{ human(v.tier) }}</span>
                <span class="pill status" [title]="v.status"
                      [class.pill--ok]="v.status === 'ACTIVE'"
                      [class.pill--crit]="v.status === 'SUSPENDED' || v.status === 'TIER_3_REJECTED'"
                      [class.pill--warn]="v.status === 'PENDING_VERIFICATION' || v.status === 'APPLIED' || v.status === 'FSSAI_FILING'">
                  {{ human(v.status) }}
                </span>
              </span>
            </div>
            <div class="panel-body">
              <dl class="kv">
                <dt>Proprietor</dt><dd>{{ v.proprietorName }}</dd>
                <dt>Business type</dt><dd [title]="v.businessType">{{ human(v.businessType) }}</dd>
                <dt>Categories</dt>
                <dd>
                  <span class="chip-list">
                    @for (c of v.categories; track c) { <span class="pill pill--vend" [title]="c">{{ human(c) }}</span> }
                    @if (!v.categories.length) { <span class="muted">none declared</span> }
                  </span>
                </dd>
                <dt>Registered address</dt><dd>{{ v.businessCity }} · {{ v.businessPincode }}</dd>
                <dt>Delivers to</dt>
                <dd>
                  @if (v.servicedPincodes.length) {
                    <span class="chip-list">
                      @for (p of v.servicedPincodes; track p) { <span class="pill pill--mute mono">{{ p }}</span> }
                    </span>
                  } @else {
                    <span class="pill pill--warn">No service area set — cannot be matched to any order</span>
                  }
                </dd>
                <dt>Submitted</dt>
                <dd>{{ v.joinedAt | when }} <span class="muted">· {{ waitedLabel() }}</span></dd>
                @if (v.approvedAt) {
                  <dt>Approved</dt><dd>{{ v.approvedAt | when }}</dd>
                }
              </dl>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>Licence</h2>
              <span class="pill"
                    [class.pill--ok]="fssaiSeverity() === 'ok'"
                    [class.pill--warn]="fssaiSeverity() === 'warn'"
                    [class.pill--crit]="fssaiSeverity() === 'crit'"
                    [class.pill--mute]="fssaiSeverity() === 'idle'">{{ expiry(fssaiDays()) }}</span>
            </div>
            <div class="panel-body">
              <dl class="kv">
                <dt>FSSAI number</dt>
                <dd>
                  @if (v.fssaiNumber) { <span class="mono">{{ v.fssaiNumber }}</span> }
                  @else { <span class="pill pill--crit">Not on file</span> }
                </dd>
                <dt>Expires</dt>
                <dd>{{ v.fssaiExpiresAt | when:'date' }}</dd>
              </dl>
              <p class="text-meta mt-12" style="line-height:1.55;">
                Expiry day auto-blocks this vendor from accepting orders, and reminders go out at 60, 30 and 7 days.
                The uploaded documents behind this date — and the approve/reject controls for them — are on the
                <a class="link" routerLink="/compliance">compliance watch</a>.
              </p>
            </div>
          </div>
        </div>

        <div class="stack gap-20 rail">
          <div class="panel">
            <div class="panel-head"><h2>Decision</h2></div>

            @if (v.status === 'PENDING_VERIFICATION' || v.status === 'FSSAI_FILING') {
              <div class="action-block">
                <p>Approving lets this vendor go live and start receiving routed orders immediately.</p>
                <!-- Approve puts a business in front of customers. It went
                     through on one click while cancelling a ₹385 order demanded
                     a typed reason; it now states its consequence first. -->
                <button type="button" class="btn btn--ok primary" (click)="askApprove()" [disabled]="busy()">
                  {{ busy() ? 'Working…' : 'Approve vendor' }}
                </button>
              </div>
            }

            @if (v.status === 'PENDING_VERIFICATION' || v.status === 'APPLIED' || v.status === 'FSSAI_FILING') {
              <div class="action-block">
                <p>Rejecting sends the reason back to the applicant. Three rejections is permanent (Tier-3).</p>
                <label class="field-label" for="vd-reject">Reason</label>
                <textarea id="vd-reject" class="input" [(ngModel)]="rejectReason"
                          placeholder="What they need to fix and resubmit."></textarea>
                <button type="button" class="btn btn--danger danger mt-8" (click)="reject()"
                        [disabled]="busy() || !rejectReason.trim()">Reject application</button>
              </div>
            }

            @if (v.status === 'ACTIVE') {
              <div class="action-block">
                <p>Suspension stops routing to this vendor at once. Open orders are unaffected, and it can be
                   lifted from this same panel.</p>
                <label class="field-label" for="vd-suspend">Reason</label>
                <textarea id="vd-suspend" class="input" [(ngModel)]="suspendReason"
                          placeholder="Why they are being taken off the platform."></textarea>
                <button type="button" class="btn btn--danger warn mt-8" (click)="suspend()"
                        [disabled]="busy() || !suspendReason.trim()">Suspend vendor</button>
              </div>
            }

            <!-- Suspension was a one-way door in the UI even though the backend
                 has always had a way back. With one live vendor in the city, one
                 click ended all supply with no route out. -->
            @if (v.status === 'SUSPENDED') {
              <div class="action-block">
                <p>
                  This vendor is suspended: nothing is being routed to them. Reinstating puts them straight back
                  into routing{{ suspendedSupplyNote() }}
                </p>
                <label class="field-label" for="vd-reinstate">Reason</label>
                <textarea id="vd-reinstate" class="input" [(ngModel)]="reinstateReason"
                          placeholder="What changed since the suspension. Written to the audit log."></textarea>
                <button type="button" class="btn btn--ok reinstate mt-8" (click)="askReinstate()"
                        [disabled]="busy() || !reinstateReason.trim()">Reinstate vendor</button>
              </div>
            }

            @if (actionError(); as e) { <div class="action-block"><div class="err-line">{{ e }}</div></div> }
          </div>

          <div class="panel">
            <div class="panel-head"><h2>Track record</h2></div>
            <div class="stat-row">
              <div class="stat">
                <div class="k">Orders</div>
                <div class="v">{{ v.totalOrders | count }}</div>
                <div class="n">lifetime, all statuses</div>
              </div>
              <div class="stat">
                <div class="k">Rating</div>
                @if (v.avgRating === null) {
                  <div class="v">—</div><div class="n">no ratings yet</div>
                } @else {
                  <div class="v" [class.crit]="v.avgRating < 3" [class.warn]="v.avgRating < 3.5 && v.avgRating >= 3">
                    {{ v.avgRating | number:'1.1-1' }}★
                  </div>
                  <div class="n">
                    @if (v.avgRating < 3) { under 3.0 — auto-suspend band }
                    @else if (v.avgRating < 3.5) { under 3.5 — review flagged }
                    @else { above both thresholds }
                  </div>
                }
              </div>
            </div>
          </div>

          @if (fssaiSeverity() === 'crit' || fssaiSeverity() === 'warn') {
            <div class="panel" id="renewal">
              <div class="panel-head"><h2>Renewal</h2></div>
              <div class="action-block">
                <p>
                  <strong>{{ expiry(fssaiDays()) }}.</strong>
                  On the expiry date this vendor stops being routed orders automatically. FSSAI turnaround is not
                  same-week, so a renewal started today is already tight.
                </p>
                <p>
                  The portal has no phone number, email address or outbound message for a vendor — no admin
                  endpoint exposes vendor contact details, so chasing has to happen on whatever channel you
                  already use with them. What the portal can do is show you the moment a renewal lands.
                </p>
                <a class="btn btn--ghost" routerLink="/compliance">Watch for the renewal upload</a>
                <a class="btn btn--ghost mt-8" [routerLink]="['/audit']"
                   [queryParams]="{ targetEntityType: 'VENDOR', targetEntityId: v.id }">
                  What has already been chased
                </a>
              </div>
            </div>
          }

          <div class="panel">
            <div class="panel-head"><h2>Audit</h2></div>
            <div class="action-block">
              <p>Every approve, reject and suspend on this vendor is written to the append-only log.</p>
              <a class="btn btn--ghost" [routerLink]="['/audit']"
                 [queryParams]="{ targetEntityType: 'VENDOR', targetEntityId: v.id }">View this vendor's log</a>
            </div>
          </div>
        </div>
      </div>

      <app-confirm-dialog [request]="confirm()" [busy]="busy()"
                          (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
    } @else if (loading()) {
      <div class="panel">
        <div class="panel-body"><span class="text-label">Loading vendor…</span></div>
      </div>
    } @else {
      <div class="panel">
        <div class="panel-body">
          <div class="err-line">{{ error() ?? 'Vendor not found.' }}</div>
          <a class="btn btn--ghost mt-12" routerLink="/vendors">Back to vendor desk</a>
        </div>
      </div>
    }
  `
})
export class VendorDetailComponent implements OnInit {
  @Input({ required: true }) id!: string;

  private service = inject(VendorService);
  private clock = inject(ClockService);
  private toasts = inject(ToastService);

  vendor = signal<VendorResponse | null>(null);
  loading = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  rejectReason = '';
  suspendReason = '';
  reinstateReason = '';

  confirm = signal<ConfirmRequest | null>(null);
  private pending: (() => void) | null = null;

  ngOnInit() { this.reload(); }

  readonly fssaiDays = computed(() =>
    daysUntilDate(this.vendor()?.fssaiExpiresAt ?? null, this.clock.now()));

  readonly fssaiSeverity = computed<Severity>(() =>
    this.vendor()?.fssaiNumber ? expirySeverity(this.fssaiDays()) : 'crit');

  readonly waitedLabel = computed(() => {
    const v = this.vendor();
    if (!v) return '';
    const ms = msSince(v.joinedAt, this.clock.now());
    if (ms === null) return '';
    const pending = v.status === 'PENDING_VERIFICATION' || v.status === 'APPLIED' || v.status === 'FSSAI_FILING';
    return pending ? `waiting ${formatDuration(ms)}` : `${formatDuration(ms)} on the platform`;
  });

  readonly subtitle = computed(() => {
    const v = this.vendor();
    if (!v) return '';
    return `${v.proprietorName} · ${v.businessCity} ${v.businessPincode} · ${v.servicedPincodes.length} pincode${v.servicedPincodes.length === 1 ? '' : 's'} served`;
  });

  readonly verdict = computed<{ severity: Severity; text: string }>(() => {
    const v = this.vendor();
    if (!v) return { severity: 'idle', text: '' };

    const blockers: string[] = [];
    if (!v.fssaiNumber) blockers.push('no FSSAI number on file');
    else if (this.fssaiDays() !== null && this.fssaiDays()! < 0) blockers.push('FSSAI licence already expired');
    if (!v.servicedPincodes.length) blockers.push('no service area declared');
    if (!v.categories.length) blockers.push('no product categories declared');

    if (v.status === 'PENDING_VERIFICATION' || v.status === 'APPLIED' || v.status === 'FSSAI_FILING') {
      if (blockers.length) {
        return { severity: 'crit', text: `Not ready to approve — ${blockers.join(', ')}. Reject with a specific ask so they can resubmit.` };
      }
      const days = this.fssaiDays();
      if (days !== null && days <= 30) {
        return { severity: 'warn', text: `Paperwork is complete, but the FSSAI licence lapses in ${days} day${days === 1 ? '' : 's'} — approving now buys very little runway.` };
      }
      return { severity: 'ok', text: 'Licence, service area and categories are all on file. Nothing is blocking approval.' };
    }

    if (v.status === 'ACTIVE') {
      if (v.avgRating !== null && v.avgRating < 3) {
        return { severity: 'crit', text: `Rating ${v.avgRating.toFixed(1)}★ is under the 3.0 auto-suspend line.` };
      }
      if (this.fssaiSeverity() === 'crit') {
        return { severity: 'crit', text: `Licence status is critical — ${expiryLabel(this.fssaiDays())}. This vendor is blocked from selling on expiry day.` };
      }
      if (v.avgRating !== null && v.avgRating < 3.5) {
        return { severity: 'warn', text: `Rating ${v.avgRating.toFixed(1)}★ sits in the 3.5 review band.` };
      }
      return { severity: 'ok', text: 'Live and healthy — rating and licence both clear their thresholds.' };
    }

    if (v.status === 'SUSPENDED') {
      return { severity: 'crit', text: 'Suspended — nothing is being routed to this vendor. Reinstate from the decision panel when the reason is resolved.' };
    }
    return { severity: 'warn', text: `Currently ${enumLabel(v.status).toLowerCase()}. No decision is pending from you.` };
  });

  human(v: string) { return shortLabel(v); }

  /** Named so the reinstate copy can say what supply is currently missing. */
  suspendedSupplyNote(): string {
    const v = this.vendor();
    return v && v.servicedPincodes.length
      ? `, covering ${v.servicedPincodes.length} pincode${v.servicedPincodes.length === 1 ? '' : 's'} again.`
      : '.';
  }

  askApprove() {
    const v = this.vendor();
    if (!v) return;
    this.confirm.set({
      title: 'Approve this vendor',
      message: `${v.businessName} goes live and starts receiving routed orders immediately.`,
      confirmLabel: 'Approve and go live',
      tone: 'ok',
      consequence: `Customers in ${v.servicedPincodes.length} pincode${v.servicedPincodes.length === 1 ? '' : 's'} can order from them from this moment. Suspending later stops routing but does not undo orders already placed.`
    });
    this.pending = () => this.approve();
  }

  askReinstate() {
    const v = this.vendor();
    if (!v || !this.reinstateReason.trim()) return;
    this.confirm.set({
      title: 'Reinstate this vendor',
      message: `${v.businessName} goes back into routing and can accept orders again straight away.`,
      confirmLabel: 'Reinstate vendor',
      tone: 'ok',
      consequence: 'Whatever the suspension was for is no longer blocking them. Your reason goes to the append-only audit log.'
    });
    this.pending = () => this.reinstate();
  }

  runConfirmed(_result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.();
  }
  expiry(days: number | null) { return this.vendor()?.fssaiNumber ? expiryLabel(days) : 'no licence on file'; }

  /**
   * Re-reads the vendor after a change.
   *
   * The approve/reject/suspend/reinstate responses carry the new status but not
   * the derived track record — `totalOrders` comes back 0 on those paths and 39
   * on `GET /admin/vendors/{id}`. Trusting the mutation response therefore made
   * a vendor with 39 orders look brand new the instant you acted on them.
   */
  private reconcile() { this.reload(); }

  private reload() {
    this.loading.set(true);
    this.error.set(null);
    this.service.get(this.id).subscribe({
      next: v => { this.vendor.set(v); this.loading.set(false); this.clock.sync(); },
      error: e => { this.error.set(describeError(e, 'this vendor')); this.loading.set(false); }
    });
  }

  approve() {
    this.busy.set(true);
    this.actionError.set(null);
    this.service.approve(this.id, {}).subscribe({
      next: v => {
        this.vendor.set(v);
        this.busy.set(false);
        this.reconcile();
        this.toasts.success(
          `${v.businessName} is live`,
          `Orders in ${v.servicedPincodes.length} pincode${v.servicedPincodes.length === 1 ? '' : 's'} can now be routed to them.`
        );
      },
      error: e => { this.actionError.set(describeActionError(e, 'approving this vendor')); this.busy.set(false); }
    });
  }

  reinstate() {
    const reason = this.reinstateReason.trim();
    if (!reason) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.service.reinstate(this.id, { reason }).subscribe({
      next: v => {
        this.vendor.set(v);
        this.reinstateReason = '';
        this.busy.set(false);
        this.reconcile();
        this.toasts.success(`${v.businessName} is back in routing`, 'They can accept orders again from now.');
      },
      error: e => { this.actionError.set(describeActionError(e, 'reinstating this vendor')); this.busy.set(false); }
    });
  }

  reject() {
    if (!this.rejectReason.trim()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.service.reject(this.id, { reason: this.rejectReason.trim() }).subscribe({
      next: v => {
        this.vendor.set(v);
        this.rejectReason = '';
        this.busy.set(false);
        this.reconcile();
        this.toasts.success('Application rejected', `${v.businessName} sees your reason and can resubmit. Three rejections is permanent.`);
      },
      error: e => { this.actionError.set(describeActionError(e, 'rejecting this application')); this.busy.set(false); }
    });
  }

  suspend() {
    if (!this.suspendReason.trim()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.service.suspend(this.id, { reason: this.suspendReason.trim() }).subscribe({
      next: v => {
        this.vendor.set(v);
        this.suspendReason = '';
        this.busy.set(false);
        this.reconcile();
        this.toasts.success(
          `${v.businessName} suspended`,
          'Nothing more is being routed to them. Reinstate from this same panel when it is resolved.'
        );
      },
      error: e => { this.actionError.set(describeActionError(e, 'suspending this vendor')); this.busy.set(false); }
    });
  }
}
