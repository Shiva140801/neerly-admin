import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient, Page } from '../../core/api/api-client';
import type { DamageClaim } from '../../shared/attention.service';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { MS_DAY, Severity, formatDuration, humanize, msSince } from '../../shared/ui/urgency';

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
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .lede {
      padding: 12px 16px; border-radius: var(--r-md); margin-bottom: 16px;
      font-size: 13px; line-height: 1.5; font-weight: 600;
    }
    .lede.crit { background: var(--err-soft);  color: var(--err-ink); }
    .lede.warn { background: var(--warn-soft); color: var(--warn-ink); }
    .lede.ok   { background: var(--ok-soft);   color: var(--ok-ink); }

    .amt { font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }
    .age { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink-800); }
    .age.crit { color: var(--err); }
    .age.warn { color: var(--warn); }
    .reason { max-width: 40ch; color: var(--ink-600); font-size: 12.5px; line-height: 1.45; }

    .shots { display: flex; align-items: center; gap: 4px; }
    .shot {
      width: 24px; height: 24px; border-radius: var(--r-xs);
      background: var(--ink-100); border: 1px solid var(--ink-200);
    }
  `],
  template: `
    <app-page-header
      title="Damage" accent="claims"
      subtitle="A vendor wants to keep part of a customer's deposit. Evidence decides it — a claim with no photos is not one to uphold.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    @if (!loading() && !error() && rows().length > 0) {
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
              <th>Vendor's account</th>
              <th>Evidence</th>
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
                  <div class="sub-cell">filed {{ r.claim.filedAt | date:'d MMM' }}</div>
                </td>
                <td class="right">
                  <span class="amt">₹{{ r.claim.claimAmount | number:'1.2-2' }}</span>
                  @if (r.claim.awardedAmount !== null) {
                    <div class="sub-cell">awarded ₹{{ r.claim.awardedAmount | number:'1.2-2' }}</div>
                  }
                </td>
                <td class="reason">
                  {{ r.claim.reason }}
                  <div class="sub-cell mono">vendor {{ r.claim.vendorId.slice(0, 8) }} · customer {{ r.claim.customerId.slice(0, 8) }}</div>
                </td>
                <td>
                  @if (r.claim.evidencePhotos.length) {
                    <span class="shots">
                      @for (p of r.claim.evidencePhotos.slice(0, 4); track p) { <span class="shot" [title]="p"></span> }
                      @if (r.claim.evidencePhotos.length > 4) {
                        <span class="muted">+{{ r.claim.evidencePhotos.length - 4 }}</span>
                      }
                    </span>
                    <div class="sub-cell">{{ r.claim.evidencePhotos.length }} photo{{ r.claim.evidencePhotos.length === 1 ? '' : 's' }}</div>
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
                  @if (r.claim.status === 'FILED' || r.claim.status === 'UNDER_REVIEW') {
                    <span class="row-flex gap-6" style="justify-content:flex-end;">
                      <button type="button" class="btn btn--ok btn--sm" (click)="askApprove(r.claim)"
                              [disabled]="busyId() === r.claim.id">Uphold</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askReject(r.claim)"
                              [disabled]="busyId() === r.claim.id">Dismiss</button>
                    </span>
                  } @else {
                    <span class="muted">{{ r.claim.resolvedAt ? (r.claim.resolvedAt | date:'d MMM') : 'closed' }}</span>
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

    @if (actionError(); as e) { <div class="lede crit mt-16">{{ e }}</div> }

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class ClaimsComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);

  loading = signal(true);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  busyId = signal<string | null>(null);
  items = signal<DamageClaim[]>([]);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.reload(); }

  label(v: string) { return humanize(v); }
  dur(ms: number) { return formatDuration(ms); }

  readonly rows = computed<ClaimRow[]>(() => {
    const now = this.clock.now();
    return this.items()
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
      return { severity: 'crit', text: `${stale} claim${stale === 1 ? ' has' : 's have'} been open more than three days. ₹${Math.round(money).toLocaleString('en-IN')} of customer deposits is frozen while you decide.` };
    }
    if (noEvidence) {
      return { severity: 'warn', text: `${noEvidence} of ${open.length} open claim${open.length === 1 ? '' : 's'} arrived with no photographic evidence — those default to the customer.` };
    }
    return { severity: 'ok', text: `${open.length} claim${open.length === 1 ? '' : 's'} open, ₹${Math.round(money).toLocaleString('en-IN')} contested. All filed with evidence and inside three days.` };
  });

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<Page<DamageClaim>>('/admin/claims', { page: 0, size: 100 }).subscribe({
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
      message: `Award the vendor up to ₹${Number(c.claimAmount).toFixed(2)} out of the customer's deposit.`,
      confirmLabel: 'Award amount',
      tone: 'ok',
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
      message: `The vendor's ₹${Number(c.claimAmount).toFixed(2)} claim is refused and the deposit stays with the customer.`,
      confirmLabel: 'Dismiss claim',
      tone: 'danger',
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
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the verdict')); this.busyId.set(null); }
    });
  }

  private reject(c: DamageClaim, note: string) {
    this.busyId.set(c.id);
    this.actionError.set(null);
    // AdminVerdictRequest requires `note` on both endpoints.
    this.api.post(`/admin/claims/${c.id}/reject`, { note }).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the verdict')); this.busyId.set(null); }
    });
  }
}
