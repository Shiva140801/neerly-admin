import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient, Page } from '../../core/api/api-client';
import type { DamageClaim } from '../../shared/attention.service';
import { describeActionError, describeError } from '../../shared/api-error';
import { DirectoryService, unknownParty } from '../../shared/directory.service';
import { label as enumLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { EvidenceStripComponent } from '../../shared/ui/evidence-strip.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { formatRupees } from '../../shared/ui/format';
import { RupeesPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { MS_DAY, Severity, formatDuration, msSince } from '../../shared/ui/urgency';

/** Decided claims stay reachable, so the queue can be filtered by outcome. */
const CLAIM_VIEWS = [
  { key: 'open', label: 'Awaiting a verdict' },
  { key: 'APPROVED', label: 'Upheld' },
  { key: 'REJECTED', label: 'Dismissed' },
  { key: 'WITHDRAWN', label: 'Withdrawn' }
] as const;

type ClaimView = typeof CLAIM_VIEWS[number]['key'];

interface ClaimRow {
  claim: DamageClaim;
  ageMs: number | null;
  severity: Severity;
}

/**
 * Damage-claim arbitration.
 *
 * A vendor is asking to keep part of a customer's container deposit. Both sides
 * are Neerly users, so the decision is a judgement call on evidence — the row
 * therefore leads with the money at stake and how much photographic evidence
 * was actually filed, because a claim with no photos is not a claim you should
 * be upholding (PRD §8.5).
 *
 * Also fixes two wire bugs: the status enum is `UNDER_REVIEW`, not `REVIEWING`
 * (so in-review claims never matched and lost their action buttons), and both
 * verdict endpoints take an `AdminVerdictRequest` whose `note` is mandatory.
 */
@Component({
  selector: 'app-claims',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, PageHeaderComponent, DataStateComponent,
    ConfirmDialogComponent, EvidenceStripComponent, WhenPipe, RupeesPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }

    .amt { font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }
    .age { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink-800); }
    .age.crit { color: var(--err); }
    .age.warn { color: var(--warn); }
    .reason { max-width: 40ch; color: var(--ink-600); font-size: 12.5px; line-height: 1.45; }

    .party { font-size: 12.5px; line-height: 1.5; }
    .party .who { font-weight: 650; color: var(--ink-900); }
    .party .role { color: var(--ink-500); }
    .party .unknown { color: var(--ink-500); font-style: italic; }
    .evidence-cell { min-width: 190px; }
  `],
  template: `
    <app-page-header
      title="Damage" accent="claims"
      subtitle="A vendor wants to keep part of a customer's deposit. Evidence decides it — a claim with no photos is not one to uphold.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div class="chips">
        @for (v of views; track v.key) {
          <button type="button" class="chip" [class.active]="view() === v.key" (click)="setView(v.key)">
            {{ v.label }}
            @if (view() === v.key && !loading()) { <span class="count">{{ rows().length }}</span> }
          </button>
        }
      </div>
    </div>

    @if (!loading() && !error() && rows().length > 0 && view() === 'open') {
      <div class="lede" [class.crit]="lede().severity === 'crit'"
           [class.warn]="lede().severity === 'warn'"
           [class.ok]="lede().severity === 'ok'">{{ lede().text }}</div>
    }

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the claims queue"
          [loading]="loading()" [error]="error()"
          emptyTitle="No claims awaiting arbitration"
          emptyDetail="Vendors file these against a customer's container deposit when a jar comes back damaged. Nothing is currently contested."
          [clear]="true"
          (retry)="reload()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Open</th>
              <th class="right">Claimed</th>
              <th>Who is arguing</th>
              <th>Vendor's account</th>
              <th>Evidence filed</th>
              <th>Status</th>
              <th class="right">Verdict</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.claim.id) {
              <tr [class.sev-crit]="r.severity === 'crit'" [class.sev-warn]="r.severity === 'warn'">
                <td>
                  <div class="age" [class.crit]="r.severity === 'crit'" [class.warn]="r.severity === 'warn'">
                    {{ r.ageMs !== null ? dur(r.ageMs) : '—' }}
                  </div>
                  <div class="sub-cell">filed {{ r.claim.filedAt | when:'date' }}</div>
                </td>
                <td class="right">
                  <span class="amt">{{ r.claim.claimAmount | rupees }}</span>
                  @if (r.claim.awardedAmount !== null) {
                    <div class="sub-cell">awarded {{ r.claim.awardedAmount | rupees }}</div>
                  }
                </td>
                <td class="party">
                  <div>
                    <span class="who" [class.unknown]="!vendorName(r.claim)">{{ vendorName(r.claim) ?? unknownVendor(r.claim) }}</span>
                    <span class="role"> is claiming</span>
                  </div>
                  <div>
                    <span class="role">against </span>
                    <span class="who" [class.unknown]="!customerName(r.claim)">{{ customerName(r.claim) ?? unknownCustomer(r.claim) }}</span>
                  </div>
                </td>
                <td class="reason">{{ r.claim.reason }}</td>
                <td class="evidence-cell">
                  @if (r.claim.evidencePhotos.length) {
                    <app-evidence-strip [keys]="r.claim.evidencePhotos" />
                    <div class="sub-cell">{{ r.claim.evidencePhotos.length }} photo{{ r.claim.evidencePhotos.length === 1 ? '' : 's' }} filed</div>
                  } @else {
                    <span class="pill pill--crit">No photos filed</span>
                  }
                </td>
                <td>
                  <span class="pill"
                        [class.pill--warn]="r.claim.status === 'FILED' || r.claim.status === 'UNDER_REVIEW'"
                        [class.pill--ok]="r.claim.status === 'APPROVED'"
                        [class.pill--crit]="r.claim.status === 'REJECTED'"
                        [class.pill--mute]="r.claim.status === 'WITHDRAWN'">
                    {{ label(r.claim.status) }}
                  </span>
                  @if (r.claim.adminNote) { <div class="sub-cell">{{ r.claim.adminNote }}</div> }
                </td>
                <td class="right">
                  <!-- Uphold moves the customer's deposit to the vendor; Dismiss
                       moves nothing. Colour therefore tracks *risk*, not verdict:
                       the money-moving button carries the danger treatment. -->
                  @if (r.claim.status === 'FILED' || r.claim.status === 'UNDER_REVIEW') {
                    <span class="row-flex gap-6" style="justify-content:flex-end;">
                      <button type="button" class="btn btn--danger btn--sm" (click)="askApprove(r.claim)"
                              [disabled]="busyId() === r.claim.id"
                              title="Moves money out of the customer's deposit">Uphold · pays out</button>
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askReject(r.claim)"
                              [disabled]="busyId() === r.claim.id"
                              title="No money moves; the deposit stays with the customer">Dismiss</button>
                    </span>
                  } @else {
                    <span class="muted">
                      {{ r.claim.resolvedAt ? ('decided ' + (r.claim.resolvedAt | when:'date')) : 'closed' }}
                    </span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p class="text-meta mt-16" style="max-width:70ch;line-height:1.6;">
        Upholding a claim moves money out of the customer's deposit to the vendor. Where neither side has
        evidence, the platform defaults to the customer on a first dispute — check the
        <a class="link" routerLink="/audit">audit log</a> for a repeat pattern before flipping that default.
      </p>
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
export class ClaimsComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private toasts = inject(ToastService);
  private directory = inject(DirectoryService);

  views = CLAIM_VIEWS;
  view = signal<ClaimView>('open');

  loading = signal(true);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  busyId = signal<string | null>(null);
  items = signal<DamageClaim[]>([]);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() {
    this.reload();
    // Names for the two parties, from the endpoints that hold them. The claim
    // payload names them by id alone, and "vendor a4b64aa2 vs customer 8c4cb9cf"
    // is not an arbitration anyone can make.
    this.directory.ensureLoaded();
  }

  setView(v: ClaimView) { this.view.set(v); this.reload(); }

  label(v: string) { return enumLabel(v); }
  dur(ms: number) { return formatDuration(ms); }

  /** Payload name first; the directory only fills a gap, never overrides. */
  vendorName(c: DamageClaim): string | null {
    return c.vendorName ?? this.directory.vendorName(c.vendorId);
  }

  customerName(c: DamageClaim): string | null {
    return c.customerName ?? this.directory.customerName(c.customerId);
  }

  unknownVendor(c: DamageClaim) { return unknownParty('vendor', c.vendorId); }
  unknownCustomer(c: DamageClaim) { return unknownParty('customer', c.customerId); }

  readonly rows = computed<ClaimRow[]>(() => {
    const now = this.clock.now();
    const open = this.view() === 'open';
    return this.items()
      .filter(c => open ? (c.status === 'FILED' || c.status === 'UNDER_REVIEW') : true)
      .map(claim => {
        const ageMs = msSince(claim.filedAt, now);
        const open = claim.status === 'FILED' || claim.status === 'UNDER_REVIEW';
        const severity: Severity = !open ? 'idle'
          : (ageMs ?? 0) >= 3 * MS_DAY ? 'crit'
          : (ageMs ?? 0) >= MS_DAY ? 'warn' : 'ok';
        return { claim, ageMs, severity };
      })
      .sort((a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0));
  });

  readonly lede = computed<{ severity: Severity; text: string }>(() => {
    const open = this.rows().filter(r => r.claim.status === 'FILED' || r.claim.status === 'UNDER_REVIEW');
    const money = open.reduce((s, r) => s + Number(r.claim.claimAmount ?? 0), 0);
    const noEvidence = open.filter(r => r.claim.evidencePhotos.length === 0).length;
    const stale = open.filter(r => r.severity === 'crit').length;

    if (stale) {
      return { severity: 'crit', text: `${stale} claim${stale === 1 ? ' has' : 's have'} been open more than three days. ${formatRupees(Math.round(money))} of customer deposits is frozen while you decide.` };
    }
    if (noEvidence) {
      return { severity: 'warn', text: `${noEvidence} of ${open.length} open claim${open.length === 1 ? '' : 's'} arrived with no photographic evidence — those default to the customer.` };
    }
    return { severity: 'ok', text: `${open.length} claim${open.length === 1 ? '' : 's'} open, ${formatRupees(Math.round(money))} contested. All filed with evidence and inside three days.` };
  });

  reload() {
    this.loading.set(true);
    this.error.set(null);
    const v = this.view();
    const params: Record<string, string | number> = { page: 0, size: 100 };
    if (v !== 'open') params['status'] = v;
    this.api.get<Page<DamageClaim>>('/admin/claims', params).subscribe({
      next: res => { this.items.set(res?.content ?? []); this.loading.set(false); this.clock.sync(); },
      error: e => {
        this.error.set(describeError(e, 'the claims queue'));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }

  askApprove(c: DamageClaim) {
    this.confirm.set({
      title: 'Uphold claim',
      message: `Awards ${this.vendorName(c) ?? 'the vendor'} up to ${formatRupees(c.claimAmount)} out of ${this.customerName(c) ?? 'the customer'}'s deposit.`,
      confirmLabel: 'Move the money',
      // Danger, not success: this is the button that takes money off a customer.
      tone: 'danger',
      cancelLabel: 'Leave undecided',
      amount: { label: 'Award (₹)', max: Number(c.claimAmount), initial: Number(c.claimAmount) },
      reason: { label: 'Verdict note', placeholder: 'What the evidence showed. Both parties see this.', required: true },
      consequence: c.evidencePhotos.length === 0
        ? 'This claim was filed without any photographs. Upholding it against the customer will be hard to defend.'
        : undefined
    });
    this.pending = res => this.approve(c, res.amount ?? Number(c.claimAmount), res.reason);
  }

  askReject(c: DamageClaim) {
    this.confirm.set({
      title: 'Dismiss claim',
      message: `The ${formatRupees(c.claimAmount)} claim is refused and the deposit stays with ${this.customerName(c) ?? 'the customer'}. No money moves.`,
      confirmLabel: 'Dismiss claim',
      tone: 'primary',
      reason: { label: 'Verdict note', placeholder: 'Why the evidence did not support the claim.', required: true }
    });
    this.pending = res => this.reject(c, res.reason);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(result);
  }

  private approve(c: DamageClaim, awardedAmount: number, note: string) {
    this.busyId.set(c.id);
    this.actionError.set(null);
    this.api.post(`/admin/claims/${c.id}/approve`, { awardedAmount, note }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          `Claim upheld — ${formatRupees(awardedAmount)} awarded`,
          `Paid to ${this.vendorName(c) ?? 'the vendor'} out of ${this.customerName(c) ?? 'the customer'}'s deposit. Both parties see your note.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'recording this verdict')); this.busyId.set(null); }
    });
  }

  private reject(c: DamageClaim, note: string) {
    this.busyId.set(c.id);
    this.actionError.set(null);
    // AdminVerdictRequest requires `note` on both endpoints.
    this.api.post(`/admin/claims/${c.id}/reject`, { note }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          'Claim dismissed',
          `No money moved — the ${formatRupees(c.claimAmount)} deposit stays with ${this.customerName(c) ?? 'the customer'}.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'recording this verdict')); this.busyId.set(null); }
    });
  }
}
