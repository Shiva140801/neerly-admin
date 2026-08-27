import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiClient, Page } from '../../core/api/api-client';
import type { ComplianceDoc } from '../../shared/attention.service';
import type { VendorResponse } from '../vendors/vendor.model';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, daysUntilDate, expirySeverity, humanize } from '../../shared/ui/urgency';

interface VendorLicence {
  vendor: VendorResponse;
  days: number | null;
  severity: Severity;
}

interface DocRow {
  doc: ComplianceDoc;
  days: number | null;
  severity: Severity;
}

/** Reminder ladder from PRD §6.4 — 60 / 30 / 7 days, then auto-block. */
const HORIZONS = [7, 30, 60] as const;

/**
 * Compliance watch.
 *
 * Expiry proximity is the entire point of this screen: on expiry day the
 * platform auto-blocks the vendor from accepting orders (PRD §6.4), so a
 * licence lapsing in five days is an outage with a countdown on it. The old
 * table printed `expiresDate` as a formatted date and left the arithmetic to
 * the reader.
 *
 * Two lenses, because the backend splits the information across two payloads:
 *
 *  - **Vendor licences** joins expiry to *identity*. `GET /admin/vendors` is the
 *    only endpoint that returns `fssaiExpiresAt` next to a business name, so it
 *    is the only way to answer "who gets blocked next week".
 *  - **Uploaded documents** is `GET /admin/compliance/expiring`, which is where
 *    approve/reject live. That payload carries no vendor reference at all, so
 *    rows there are identified by document number — see the note on the panel.
 */
@Component({
  selector: 'app-compliance',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }

    .lede {
      padding: 12px 16px; border-radius: var(--r-md); margin-bottom: 18px;
      font-size: 13px; line-height: 1.5; font-weight: 600;
    }
    .lede.crit { background: var(--err-soft);  color: var(--err-ink); }
    .lede.warn { background: var(--warn-soft); color: var(--warn-ink); }
    .lede.ok   { background: var(--ok-soft);   color: var(--ok-ink); }

    .countdown { display: flex; align-items: baseline; gap: 6px; }
    .countdown .n {
      font-size: 20px; font-weight: 800; line-height: 1;
      font-variant-numeric: tabular-nums; color: var(--ink-700);
    }
    .countdown .n.crit { color: var(--err); }
    .countdown .n.warn { color: var(--warn); }
    .countdown .u { font-size: 11.5px; color: var(--ink-500); font-weight: 600; }

    .bar {
      height: 4px; border-radius: var(--r-pill); background: var(--ink-100);
      margin-top: 6px; width: 96px; overflow: hidden;
    }
    .bar i { display: block; height: 100%; background: var(--ok); }
    .bar i.warn { background: var(--warn); }
    .bar i.crit { background: var(--err); }

    .note {
      padding: 12px 18px; font-size: 12.5px; color: var(--ink-600);
      line-height: 1.55; border-top: 1px solid var(--ink-100); background: var(--ink-50);
    }
    .note strong { color: var(--ink-800); }
    .note code {
      font-family: var(--font-mono); font-size: 11.5px;
      background: var(--ink-100); padding: 1px 5px; border-radius: var(--r-xs); color: var(--ink-700);
    }
  `],
  template: `
    <app-page-header
      title="Compliance" accent="watch"
      subtitle="On expiry day the platform stops routing orders to the vendor. Everything here is counted in days remaining, not dates.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div class="chips">
        @for (h of horizons; track h) {
          <button type="button" class="chip" [class.active]="horizon() === h" (click)="horizon.set(h)">
            Next {{ h }} days
            <span class="count" [class.count--crit]="h === 7 && countFor(h) > 0"
                  [class.count--warn]="h !== 7 && countFor(h) > 0">{{ countFor(h) }}</span>
          </button>
        }
      </div>
    </div>

    @if (!loading() && !vendorError()) {
      <div class="lede" [class.crit]="lede().severity === 'crit'"
           [class.warn]="lede().severity === 'warn'"
           [class.ok]="lede().severity === 'ok'">{{ lede().text }}</div>
    }

    <div class="panel">
      <div class="panel-head">
        <h2>Vendor licences · who gets blocked</h2>
        <span class="text-label">{{ licences().length }} inside {{ horizon() }} days</span>
      </div>

      @if (loading() || vendorError() || licences().length === 0) {
        <app-data-state
          what="vendor licences"
          [loading]="loading()" [error]="vendorError()"
          emptyTitle="No licence lapses in this window"
          [emptyDetail]="'No live vendor has an FSSAI licence expiring inside ' + horizon() + ' days. Widen the window to look further ahead.'"
          [clear]="true" [compact]="true"
          (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Days left</th>
                <th>Vendor</th>
                <th>FSSAI number</th>
                <th>Expires</th>
                <th class="right">Live orders</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (l of licences(); track l.vendor.id) {
                <tr [class.sev-crit]="l.severity === 'crit'" [class.sev-warn]="l.severity === 'warn'">
                  <td>
                    <span class="countdown">
                      <span class="n" [class.crit]="l.severity === 'crit'" [class.warn]="l.severity === 'warn'">
                        {{ l.days !== null && l.days < 0 ? 0 : l.days }}
                      </span>
                      <span class="u">{{ l.days !== null && l.days < 0 ? 'expired ' + (-l.days) + 'd ago' : 'days' }}</span>
                    </span>
                    <span class="bar">
                      <i [style.width.%]="runway(l.days)"
                         [class.warn]="l.severity === 'warn'" [class.crit]="l.severity === 'crit'"></i>
                    </span>
                  </td>
                  <td>
                    <div class="primary-cell">{{ l.vendor.businessName }}</div>
                    <div class="sub-cell">{{ l.vendor.proprietorName }} · {{ l.vendor.businessPincode }}</div>
                  </td>
                  <td class="mono" style="font-size:12px;">{{ l.vendor.fssaiNumber ?? '—' }}</td>
                  <td>{{ l.vendor.fssaiExpiresAt ? (l.vendor.fssaiExpiresAt | date:'d MMM y') : '—' }}</td>
                  <td class="right num">{{ l.vendor.totalOrders | number }}</td>
                  <td class="right">
                    <a class="link" [routerLink]="['/vendors', l.vendor.id]">Open vendor →</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <div class="note">
        Reminders go out at <strong>60, 30 and 7 days</strong>. On the expiry date the vendor is automatically
        blocked from accepting new orders until a renewed licence is approved.
      </div>
    </div>

    <div class="panel mt-24">
      <div class="panel-head">
        <h2>Uploaded documents near expiry</h2>
        <span class="text-label">{{ docs().length }} on file</span>
      </div>

      @if (loading() || docError() || docs().length === 0) {
        <app-data-state
          what="expiring documents"
          [loading]="loading()" [error]="docError()"
          emptyTitle="No documents near expiry"
          emptyDetail="Nothing uploaded by a vendor is inside its 30-day expiry window. Submitted documents also appear here once a vendor uploads a renewal."
          [clear]="true" [compact]="true"
          (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Days left</th>
                <th>Document</th>
                <th>Vendor</th>
                <th>Number</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th class="right">Review</th>
              </tr>
            </thead>
            <tbody>
              @for (d of docs(); track d.doc.id) {
                <tr [class.sev-crit]="d.severity === 'crit'" [class.sev-warn]="d.severity === 'warn'">
                  <td>
                    <span class="countdown">
                      <span class="n" [class.crit]="d.severity === 'crit'" [class.warn]="d.severity === 'warn'">
                        {{ d.days !== null && d.days < 0 ? 0 : (d.days ?? '—') }}
                      </span>
                      <span class="u">{{ d.days !== null && d.days < 0 ? 'expired' : 'days' }}</span>
                    </span>
                  </td>
                  <td class="primary-cell">{{ label(d.doc.docType) }}</td>
                  <td>
                    @if (d.doc.vendorId) {
                      <a class="link" [routerLink]="['/vendors', d.doc.vendorId]">
                        {{ d.doc.vendorName ?? d.doc.vendorId.slice(0, 8) }}
                      </a>
                    } @else {
                      <span class="muted">unattributed</span>
                    }
                  </td>
                  <td class="mono" style="font-size:12px;">{{ d.doc.docNumber ?? '—' }}</td>
                  <td>{{ d.doc.uploadedAt | date:'d MMM y' }}</td>
                  <td>
                    <span class="pill"
                          [class.pill--warn]="d.doc.status === 'SUBMITTED'"
                          [class.pill--ok]="d.doc.status === 'APPROVED'"
                          [class.pill--crit]="d.doc.status === 'REJECTED' || d.doc.status === 'EXPIRED'">
                      {{ label(d.doc.status) }}
                    </span>
                  </td>
                  <td class="right">
                    @if (d.doc.status === 'SUBMITTED') {
                      <span class="row-flex gap-6" style="justify-content:flex-end;">
                        <button type="button" class="btn btn--ok btn--sm" (click)="askApprove(d.doc)"
                                [disabled]="busyId() === d.doc.id">Approve</button>
                        <button type="button" class="btn btn--danger btn--sm" (click)="askReject(d.doc)"
                                [disabled]="busyId() === d.doc.id">Reject</button>
                      </span>
                    } @else {
                      <span class="muted">reviewed {{ d.doc.reviewedAt ? (d.doc.reviewedAt | date:'d MMM') : '—' }}</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <div class="note">
        This lens covers <strong>every document type</strong> a vendor has uploaded — trade licence, groundwater
        permit, shop establishment — not just FSSAI, and it is the only place a submitted renewal can be approved
        or rejected. The licence table above stays because a vendor's <code>fssaiExpiresAt</code> is what actually
        triggers the auto-block, and it is set whether or not a document was ever uploaded against it.
      </div>
    </div>

    @if (actionError(); as e) {
      <div class="lede crit mt-16">{{ e }}</div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class ComplianceComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);

  horizons = HORIZONS;
  horizon = signal<number>(30);

  loading = signal(true);
  vendorError = signal<string | null>(null);
  docError = signal<string | null>(null);
  actionError = signal<string | null>(null);
  busyId = signal<string | null>(null);

  private vendors = signal<VendorResponse[]>([]);
  private rawDocs = signal<ComplianceDoc[]>([]);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.reload(); }

  label(v: string) { return humanize(v); }

  /** All live vendors with a dated licence, soonest first — independent of the horizon chip. */
  private allLicences = computed<VendorLicence[]>(() => {
    const now = this.clock.now();
    return this.vendors()
      .map(v => {
        const days = daysUntilDate(v.fssaiExpiresAt, now);
        return { vendor: v, days, severity: expirySeverity(days) };
      })
      .filter(l => l.days !== null)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  });

  readonly licences = computed(() =>
    this.allLicences().filter(l => (l.days ?? Infinity) <= this.horizon()));

  readonly docs = computed<DocRow[]>(() => {
    const now = this.clock.now();
    return this.rawDocs()
      .map(doc => {
        const days = daysUntilDate(doc.expiresDate, now);
        return { doc, days, severity: expirySeverity(days) };
      })
      .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
  });

  countFor(h: number): number {
    return this.allLicences().filter(l => (l.days ?? Infinity) <= h).length;
  }

  /** Fraction of a 60-day runway still remaining, for the inline bar. */
  runway(days: number | null): number {
    if (days === null) return 0;
    return Math.max(3, Math.min(100, Math.round((days / 60) * 100)));
  }

  readonly lede = computed<{ severity: Severity; text: string }>(() => {
    const critical = this.allLicences().filter(l => (l.days ?? 99) <= 7);
    const soon = this.allLicences().filter(l => (l.days ?? 99) > 7 && (l.days ?? 99) <= 30);
    const expired = critical.filter(l => (l.days ?? 0) < 0);

    if (expired.length) {
      return { severity: 'crit', text: `${expired.length} vendor${expired.length === 1 ? '' : 's'} ${expired.length === 1 ? 'is' : 'are'} already past licence expiry and blocked from selling — ${expired[0].vendor.businessName} first.` };
    }
    if (critical.length) {
      return { severity: 'crit', text: `${critical.length} licence${critical.length === 1 ? '' : 's'} lapse${critical.length === 1 ? 's' : ''} inside a week. ${critical[0].vendor.businessName} goes first, in ${critical[0].days} day${critical[0].days === 1 ? '' : 's'}.` };
    }
    if (soon.length) {
      return { severity: 'warn', text: `${soon.length} licence${soon.length === 1 ? '' : 's'} lapse${soon.length === 1 ? 's' : ''} inside 30 days. Chase renewals now — FSSAI turnaround is not same-week.` };
    }
    return { severity: 'ok', text: 'No live vendor loses their licence inside the next 30 days.' };
  });

  reload() {
    this.loading.set(true);
    this.vendorError.set(null);
    this.docError.set(null);
    this.actionError.set(null);

    forkJoin({
      vendors: this.api.get<Page<VendorResponse>>('/admin/vendors', { status: 'ACTIVE', page: 0, size: 200 })
        .pipe(map(p => ({ ok: true as const, rows: p?.content ?? [] })),
              catchError(e => of({ ok: false as const, message: describeError(e, 'vendor licences') }))),
      docs: this.api.get<ComplianceDoc[]>('/admin/compliance/expiring', { withinDays: 60 })
        .pipe(map(r => ({ ok: true as const, rows: Array.isArray(r) ? r : [] })),
              catchError(e => of({ ok: false as const, message: describeError(e, 'expiring documents') })))
    }).subscribe(({ vendors, docs }) => {
      if (vendors.ok) this.vendors.set(vendors.rows); else this.vendorError.set(vendors.message);
      if (docs.ok) this.rawDocs.set(docs.rows); else this.docError.set(docs.message);
      this.loading.set(false);
      this.clock.sync();
    });
  }

  askApprove(d: ComplianceDoc) {
    this.confirm.set({
      title: 'Approve document',
      message: `${humanize(d.docType)}${d.docNumber ? ` · ${d.docNumber}` : ''} is marked verified.`,
      confirmLabel: 'Approve',
      tone: 'ok',
      reason: { label: 'Note (optional)', placeholder: 'Anything worth recording about this check.' }
    });
    this.pending = r => this.approve(d, r.reason);
  }

  askReject(d: ComplianceDoc) {
    this.confirm.set({
      title: 'Reject document',
      message: `${humanize(d.docType)}${d.docNumber ? ` · ${d.docNumber}` : ''} goes back to the vendor.`,
      confirmLabel: 'Reject',
      tone: 'danger',
      reason: { label: 'Reason', placeholder: 'What is wrong with it, so they can resubmit correctly.', required: true },
      consequence: 'The vendor sees this reason verbatim and must upload a replacement before the licence expires.'
    });
    this.pending = r => this.reject(d, r.reason);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(result);
  }

  private approve(d: ComplianceDoc, note: string) {
    this.busyId.set(d.id);
    this.api.post(`/admin/compliance/${d.id}/approve`, { note }).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the approval')); this.busyId.set(null); }
    });
  }

  private reject(d: ComplianceDoc, reason: string) {
    this.busyId.set(d.id);
    // RejectDocRequest expects `reason` — the previous build posted `note`,
    // which failed validation on the server.
    this.api.post(`/admin/compliance/${d.id}/reject`, { reason }).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'the rejection')); this.busyId.set(null); }
    });
  }
}
