import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VendorService } from './vendor.service';
import type { VendorResponse, VendorStatus } from './vendor.model';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  Severity, daysUntilDate, expiryLabel, expirySeverity, formatDuration,
  humanize, msSince, waitSeverity
} from '../../shared/ui/urgency';

/** A vendor row with everything the admin needs to decide without opening it. */
interface QueueRow {
  vendor: VendorResponse;
  waitedMs: number | null;
  waitSeverity: Severity;
  /** Concrete blockers derived only from fields the API actually returns. */
  gaps: string[];
  fssaiDays: number | null;
  fssaiSeverity: Severity;
}

/**
 * Vendor desk.
 *
 * Two jobs live here and they are not the same job. Verification is a backlog
 * you clear — supply you have already won but cannot sell through, so the axis
 * that matters is *how long has this person been waiting on me*. Live vendors
 * are a portfolio you monitor — the axis there is rating and licence health
 * (PRD §12.4 flags under 3.5★ for review and auto-suspends under 3.0★).
 *
 * So the queue leads with waiting time, sorts longest-wait first, and spells out
 * what is missing from each application inline. The old grid showed a
 * `mediumDate` submission stamp and made the admin subtract dates in their head,
 * then open every row to find out why it was still sitting there.
 */
@Component({
  selector: 'app-vendor-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent, DataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }

    .wait { display: flex; flex-direction: column; gap: 2px; }
    .wait .big { font-size: 14px; font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }
    .wait .big.crit { color: var(--err); }
    .wait .big.warn { color: var(--warn); }
    .wait .when { font-size: 11.5px; color: var(--ink-500); }

    .gaps { display: flex; gap: 5px; flex-wrap: wrap; }
    .biz .name { font-weight: 650; color: var(--ink-900); font-size: 13.5px; }
    .biz .who { font-size: 12px; color: var(--ink-500); margin-top: 2px; }

    .rating { font-weight: 750; font-variant-numeric: tabular-nums; }
    .rating.crit { color: var(--err); }
    .rating.warn { color: var(--warn); }

    .lede {
      padding: 12px 16px; border-radius: var(--r-md); margin-bottom: 16px;
      font-size: 13px; line-height: 1.5; font-weight: 600;
    }
    .lede.crit { background: var(--err-soft); color: var(--err-ink); }
    .lede.warn { background: var(--warn-soft); color: var(--warn-ink); }
    .lede.ok   { background: var(--ok-soft);  color: var(--ok-ink); }

    .crit-text { color: var(--err); font-weight: 650; }
    .warn-text { color: var(--warn); font-weight: 650; }
  `],
  template: `
    <app-page-header
      title="Vendor" accent="desk"
      [subtitle]="isQueue()
        ? 'Applications waiting on a decision — longest wait first. Every day here is supply you have won but cannot sell through.'
        : 'Live and off-boarded vendors. Rating and licence health, per PRD §12.4 thresholds.'">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div class="chips">
        @for (s of statuses; track s) {
          <button type="button" class="chip" [class.active]="selectedStatus() === s"
                  (click)="selectedStatus.set(s); reload()">
            {{ labelFor(s) }}
            @if (selectedStatus() === s && !loading()) { <span class="count">{{ rows().length }}</span> }
          </button>
        }
      </div>
    </div>

    @if (!loading() && !error() && rows().length > 0) {
      <div class="lede" [class.crit]="lede().severity === 'crit'"
           [class.warn]="lede().severity === 'warn'"
           [class.ok]="lede().severity === 'ok'">{{ lede().text }}</div>
    }

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the vendor list"
          [loading]="loading()" [error]="error()"
          [emptyTitle]="emptyTitle()"
          [emptyDetail]="emptyDetail()"
          [clear]="isQueue()"
          (retry)="reload()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>{{ isQueue() ? 'Waiting' : 'Status' }}</th>
              <th>Business</th>
              <th>{{ isQueue() ? 'Missing / risky' : 'Health' }}</th>
              <th>Serves</th>
              <th>FSSAI</th>
              <th class="right">{{ isQueue() ? 'Tier' : 'Orders' }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.vendor.id) {
              <tr [class.sev-crit]="rowSeverity(r) === 'crit'"
                  [class.sev-warn]="rowSeverity(r) === 'warn'">
                <td>
                  @if (isQueue()) {
                    <span class="wait">
                      <span class="big" [class.crit]="r.waitSeverity === 'crit'"
                            [class.warn]="r.waitSeverity === 'warn'">
                        {{ r.waitedMs !== null ? dur(r.waitedMs) : '—' }}
                      </span>
                      <span class="when">since {{ r.vendor.joinedAt | date:'d MMM, HH:mm' }}</span>
                    </span>
                  } @else {
                    <span class="pill"
                          [class.pill--ok]="r.vendor.status === 'ACTIVE'"
                          [class.pill--crit]="r.vendor.status === 'SUSPENDED' || r.vendor.status === 'TIER_3_REJECTED'"
                          [class.pill--mute]="r.vendor.status !== 'ACTIVE' && r.vendor.status !== 'SUSPENDED' && r.vendor.status !== 'TIER_3_REJECTED'">
                      {{ r.vendor.status }}
                    </span>
                  }
                </td>

                <td class="biz">
                  <div class="name">{{ r.vendor.businessName }}</div>
                  <div class="who">{{ r.vendor.proprietorName }} · {{ humanized(r.vendor.businessType) }} · {{ r.vendor.businessPincode }}</div>
                </td>

                <td>
                  @if (isQueue()) {
                    @if (r.gaps.length) {
                      <span class="gaps">
                        @for (g of r.gaps; track g) { <span class="pill pill--warn">{{ g }}</span> }
                      </span>
                    } @else {
                      <span class="pill pill--ok">Complete — ready to approve</span>
                    }
                  } @else {
                    @if (r.vendor.avgRating === null) {
                      <span class="muted">no ratings yet</span>
                    } @else {
                      <span class="rating"
                            [class.crit]="r.vendor.avgRating < 3"
                            [class.warn]="r.vendor.avgRating < 3.5 && r.vendor.avgRating >= 3">
                        {{ r.vendor.avgRating | number:'1.1-1' }}★
                      </span>
                      @if (r.vendor.avgRating < 3) { <span class="pill pill--crit" style="margin-left:6px;">Auto-suspend band</span> }
                      @else if (r.vendor.avgRating < 3.5) { <span class="pill pill--warn" style="margin-left:6px;">Review flagged</span> }
                    }
                  }
                </td>

                <td class="num">
                  {{ r.vendor.servicedPincodes.length || 0 }}
                  <span class="muted">pincode{{ r.vendor.servicedPincodes.length === 1 ? '' : 's' }}</span>
                </td>

                <td>
                  @if (r.vendor.fssaiNumber) {
                    <div class="mono" style="font-size:12px;">{{ r.vendor.fssaiNumber }}</div>
                    <div class="sub-cell"
                         [class.crit-text]="r.fssaiSeverity === 'crit'"
                         [class.warn-text]="r.fssaiSeverity === 'warn'">{{ expiry(r.fssaiDays) }}</div>
                  } @else {
                    <span class="pill pill--warn">Not on file</span>
                  }
                </td>

                <td class="right num">
                  @if (isQueue()) {
                    <span class="pill" [class.pill--brand]="r.vendor.tier === 'TIER_1'"
                          [class.pill--info]="r.vendor.tier !== 'TIER_1'">{{ r.vendor.tier }}</span>
                  } @else {
                    {{ r.vendor.totalOrders | number }}
                  }
                </td>

                <td class="right">
                  <a class="link" [routerLink]="['/vendors', r.vendor.id]">
                    {{ isQueue() ? 'Review' : 'Open' }} →
                  </a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `
})
export class VendorQueueComponent {
  private service = inject(VendorService);
  private clock = inject(ClockService);

  statuses: VendorStatus[] = ['PENDING_VERIFICATION', 'APPLIED', 'ACTIVE', 'SUSPENDED', 'TIER_3_REJECTED'];
  selectedStatus = signal<VendorStatus>('PENDING_VERIFICATION');
  loading = signal(false);
  error = signal<string | null>(null);
  vendors = signal<{ content: VendorResponse[] }>({ content: [] });

  constructor() { this.reload(); }

  /** True for the statuses that represent an application awaiting a decision. */
  readonly isQueue = computed(() => {
    const s = this.selectedStatus();
    return s === 'PENDING_VERIFICATION' || s === 'APPLIED';
  });

  readonly rows = computed<QueueRow[]>(() => {
    const now = this.clock.now();
    const list = this.vendors().content ?? [];
    const mapped = list.map(v => {
      const waitedMs = msSince(v.joinedAt, now);
      const fssaiDays = daysUntilDate(v.fssaiExpiresAt, now);
      return {
        vendor: v,
        waitedMs,
        waitSeverity: waitSeverity(waitedMs),
        gaps: this.gapsFor(v, fssaiDays),
        fssaiDays,
        fssaiSeverity: expirySeverity(fssaiDays)
      };
    });

    return this.isQueue()
      // Longest wait first — the whole point of a review queue.
      ? mapped.sort((a, b) => (b.waitedMs ?? 0) - (a.waitedMs ?? 0))
      // Portfolio view: worst-rated first, then soonest licence expiry.
      : mapped.sort((a, b) =>
          (a.vendor.avgRating ?? 9) - (b.vendor.avgRating ?? 9) ||
          (a.fssaiDays ?? 9999) - (b.fssaiDays ?? 9999));
  });

  /**
   * What is stopping this application from being approved, using only fields the
   * vendor endpoint returns. No document-level detail exists on this payload, so
   * the list stays honest about what it can actually see.
   */
  private gapsFor(v: VendorResponse, fssaiDays: number | null): string[] {
    const gaps: string[] = [];
    if (!v.fssaiNumber) gaps.push('No FSSAI number');
    else if (!v.fssaiExpiresAt) gaps.push('No FSSAI expiry');
    else if (fssaiDays !== null && fssaiDays < 0) gaps.push('FSSAI already expired');
    else if (fssaiDays !== null && fssaiDays <= 30) gaps.push(`FSSAI lapses in ${fssaiDays}d`);
    if (!v.servicedPincodes.length) gaps.push('No service area');
    if (!v.categories.length) gaps.push('No categories');
    if (v.tier === 'TIER_2') gaps.push('Tier-2 — licence still being filed');
    return gaps;
  }

  rowSeverity(r: QueueRow): Severity {
    if (this.isQueue()) {
      return r.waitSeverity === 'crit' ? 'crit'
        : (r.waitSeverity === 'warn' || r.fssaiSeverity === 'crit') ? 'warn' : 'ok';
    }
    const rating = r.vendor.avgRating;
    if (rating !== null && rating < 3) return 'crit';
    if (r.fssaiSeverity === 'crit') return 'crit';
    if ((rating !== null && rating < 3.5) || r.fssaiSeverity === 'warn') return 'warn';
    return 'ok';
  }

  readonly lede = computed<{ severity: Severity; text: string }>(() => {
    const rows = this.rows();
    if (this.isQueue()) {
      const overdue = rows.filter(r => r.waitSeverity === 'crit').length;
      const ready = rows.filter(r => r.gaps.length === 0).length;
      if (overdue) {
        return { severity: 'crit', text: `${overdue} application${overdue === 1 ? ' has' : 's have'} been waiting more than three days. ${ready} of ${rows.length} ${ready === 1 ? 'is' : 'are'} complete and can be approved without asking for anything more.` };
      }
      return { severity: ready === rows.length ? 'ok' : 'warn',
        text: `${ready} of ${rows.length} application${rows.length === 1 ? '' : 's'} ${ready === 1 ? 'is' : 'are'} complete and can be approved right now. The rest are missing something the applicant has to supply.` };
    }
    const critical = rows.filter(r => this.rowSeverity(r) === 'crit').length;
    const warn = rows.filter(r => this.rowSeverity(r) === 'warn').length;
    if (critical) return { severity: 'crit', text: `${critical} live vendor${critical === 1 ? '' : 's'} ${critical === 1 ? 'is' : 'are'} under the 3.0★ auto-suspend line or already past licence expiry.` };
    if (warn) return { severity: 'warn', text: `${warn} vendor${warn === 1 ? '' : 's'} ${warn === 1 ? 'sits' : 'sit'} in the review band — under 3.5★, or a licence lapsing inside 30 days.` };
    return rows.length === 1
      ? { severity: 'ok', text: 'The one vendor here is above the rating thresholds with a licence in date.' }
      : { severity: 'ok', text: `All ${rows.length} vendors are above the rating thresholds with licences in date.` };
  });

  readonly emptyTitle = computed(() =>
    this.isQueue() ? 'Verification queue is clear' : `No vendors in ${this.labelFor(this.selectedStatus())}`);

  readonly emptyDetail = computed(() =>
    this.isQueue()
      ? 'Nobody is waiting on a decision. New Tier-1 applications land here the moment a vendor submits for review.'
      : 'Nothing on the platform currently carries this status.');

  labelFor(s: VendorStatus): string {
    return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  humanized(v: string) { return humanize(v); }
  dur(ms: number) { return formatDuration(ms); }
  expiry(days: number | null) { return expiryLabel(days); }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(this.selectedStatus()).subscribe({
      next: (page) => { this.vendors.set(page); this.loading.set(false); this.clock.sync(); },
      error: (e) => {
        this.error.set(describeError(e, 'the vendor list'));
        this.vendors.set({ content: [] });
        this.loading.set(false);
      }
    });
  }
}
