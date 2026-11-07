import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiClient, Page } from '../../core/api/api-client';
import type { ComplianceDoc } from '../../shared/attention.service';
import type { VendorResponse } from '../vendors/vendor.model';
import { describeActionError, describeError } from '../../shared/api-error';
import { label as enumLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { EvidenceStripComponent } from '../../shared/ui/evidence-strip.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { CountPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, daysUntilDate, expirySeverity } from '../../shared/ui/urgency';

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
  imports: [
    CommonModule, RouterLink, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent,
    EvidenceStripComponent, WhenPipe, CountPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }


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

    <div class="toolbar toolbar--split">
      <div class="chips">
        <span class="text-label" style="margin-right:2px;">Licence window</span>
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
        <span class="text-label">
          {{ loading() ? 'still counting…' : licences().length + ' inside ' + horizon() + ' days' }}
        </span>
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
                <th class="right">Orders served</th>
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
                    <!-- Chasing a renewal means phoning someone. Without a number on the
                         row the operator had to go hunting, so the CTA dead-ended. -->
                    @if (l.vendor.ownerPhone; as phone) {
                      <div class="sub-cell">
                        <a class="link" [href]="'tel:' + phone">{{ phone }}</a>
                        @if (l.vendor.ownerName) { <span> · {{ l.vendor.ownerName }}</span> }
                      </div>
                    }
                  </td>
                  <td class="mono" style="font-size:12px;">{{ l.vendor.fssaiNumber ?? '—' }}</td>
                  <td>{{ l.vendor.fssaiExpiresAt | when:'date' }}</td>
                  <td class="right num">{{ l.vendor.totalOrders | count }}</td>
                  <td class="right">
                    <!-- "Chase renewal" used to dead-end. It now lands on the one
                         page that holds everything needed to act on this vendor. -->
                    <a class="link" [routerLink]="['/vendors', l.vendor.id]"
                       [fragment]="'renewal'">Chase renewal →</a>
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
        <h2>Documents · waiting for review, then near expiry</h2>
        <span class="text-label">{{ loading() ? 'still counting…' : (awaitingReview() + ' to review · ' + docs().length + ' on file') }}</span>
      </div>

      @if (loading() || docError() || docs().length === 0) {
        <app-data-state
          what="documents"
          [loading]="loading()" [error]="docError()"
          emptyTitle="Nothing to review, nothing near expiry"
          emptyDetail="No vendor has a document waiting for review, and nothing approved is inside its 60-day expiry window."
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
                <th>The file</th>
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
                  <!-- You are being asked to approve a licence. The document
                       itself has to be openable, or the approval is a rubber
                       stamp on a filename. -->
                  <td style="min-width:150px;">
                    @if (d.doc.s3Key) {
                      <app-evidence-strip [keys]="[d.doc.s3Key]" />
                    } @else {
                      <span class="pill pill--crit">No file uploaded</span>
                    }
                  </td>
                  <td>{{ d.doc.uploadedAt | when:'date' }}</td>
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
                      <span class="muted">reviewed {{ d.doc.reviewedAt ? (d.doc.reviewedAt | when:'date') : '—' }}</span>
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
        or rejected. The table above stays separate because the expiry date held on the vendor's own record is
        what triggers the auto-block, and a vendor can carry one whether or not they ever uploaded a document
        against it.
      </div>
    </div>

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
export class ComplianceComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private toasts = inject(ToastService);

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

  label(v: string) { return enumLabel(v); }

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

  /**
   * Waiting-for-review first (oldest upload first — a vendor may be blocked on it), then
   * approved documents by days to expiry.
   */
  readonly docs = computed<DocRow[]>(() => {
    const now = this.clock.now();
    const rows = this.rawDocs().map(doc => {
      const days = daysUntilDate(doc.expiresDate, now);
      return { doc, days, severity: expirySeverity(days) };
    });
    const waiting = rows.filter(r => r.doc.status === 'SUBMITTED')
      .sort((a, b) => (a.doc.uploadedAt ?? '').localeCompare(b.doc.uploadedAt ?? ''));
    const rest = rows.filter(r => r.doc.status !== 'SUBMITTED')
      .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
    return [...waiting, ...rest];
  });

  readonly awaitingReview = computed(() => this.rawDocs().filter(d => d.status === 'SUBMITTED').length);

  countFor(h: number): number {
    return this.allLicences().filter(l => (l.days ?? Infinity) <= h).length;
  }

  /** Fraction of a 60-day runway still remaining, for the inline bar. */
  runway(days: number | null): number {
    if (days === null) return 0;
    return Math.max(3, Math.min(100, Math.round((days / 60) * 100)));
  }

  /**
   * The headline has to answer for *both* tables on this screen.
   *
   * It used to read only the vendor records, so it could announce "no live
   * vendor loses their licence inside 30 days" directly above an uploaded
   * document expiring in 16 — the two dates come from different rows and can
   * disagree until a renewal is approved. Where they disagree, the sooner one
   * wins, because that is the one that can actually stop supply.
   */
  readonly lede = computed<{ severity: Severity; text: string }>(() => {
    const critical = this.allLicences().filter(l => (l.days ?? 99) <= 7);
    const soon = this.allLicences().filter(l => (l.days ?? 99) > 7 && (l.days ?? 99) <= 30);
    const expired = critical.filter(l => (l.days ?? 0) < 0);
    const docsSoon = this.docs().filter(d => (d.days ?? 999) <= 30);

    if (expired.length) {
      return { severity: 'crit', text: `${expired.length} vendor${expired.length === 1 ? '' : 's'} ${expired.length === 1 ? 'is' : 'are'} already past licence expiry and blocked from selling — ${expired[0].vendor.businessName} first.` };
    }
    if (critical.length) {
      return { severity: 'crit', text: `${critical.length} licence${critical.length === 1 ? '' : 's'} lapse${critical.length === 1 ? 's' : ''} inside a week. ${critical[0].vendor.businessName} goes first, in ${critical[0].days} day${critical[0].days === 1 ? '' : 's'}.` };
    }
    if (soon.length) {
      return { severity: 'warn', text: `${soon.length} licence${soon.length === 1 ? '' : 's'} lapse${soon.length === 1 ? 's' : ''} inside 30 days. Chase renewals now — FSSAI turnaround is not same-week.` };
    }
    const toReview = this.awaitingReview();
    if (toReview > 0) {
      return { severity: 'warn', text: `${toReview} vendor document${toReview === 1 ? ' is' : 's are'} waiting for review — oldest first in the table below. Licence expiry looks clear for the next 30 days.` };
    }
    if (docsSoon.length) {
      const first = docsSoon[0];
      return {
        severity: 'warn',
        text: `No vendor record shows a licence lapsing inside 30 days, but ${docsSoon.length} uploaded document${docsSoon.length === 1 ? '' : 's'} ${docsSoon.length === 1 ? 'does' : 'do'} — ${enumLabel(first.doc.docType)} for ${first.doc.vendorName ?? 'an unattributed vendor'}, in ${first.days} day${first.days === 1 ? '' : 's'}. Where the two disagree, treat the earlier date as the real one.`
      };
    }
    return { severity: 'ok', text: 'No live vendor loses their licence inside the next 30 days, and no uploaded document is near expiry.' };
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
              catchError(e => of({ ok: false as const, message: describeError(e, 'expiring documents') }))),
      // The review queue. Before it existed this screen only ever received approved
      // documents, so Approve / Reject could never appear and nothing could be approved.
      submitted: this.api.get<Page<ComplianceDoc>>('/admin/compliance', { status: 'SUBMITTED', page: 0, size: 100 })
        .pipe(map(p => ({ ok: true as const, rows: p?.content ?? [] })),
              catchError(e => of({ ok: false as const, message: describeError(e, 'documents to review') })))
    }).subscribe(({ vendors, docs, submitted }) => {
      if (vendors.ok) this.vendors.set(vendors.rows); else this.vendorError.set(vendors.message);
      if (docs.ok && submitted.ok) {
        const seen = new Set<string>();
        this.rawDocs.set([...submitted.rows, ...docs.rows].filter(d => !seen.has(d.id) && !!seen.add(d.id)));
      } else {
        this.docError.set(!submitted.ok ? submitted.message : (docs as { message: string }).message);
      }
      this.loading.set(false);
      this.clock.sync();
    });
  }

  askApprove(d: ComplianceDoc) {
    this.confirm.set({
      title: 'Approve document',
      message: `${enumLabel(d.docType)}${d.docNumber ? ` · ${d.docNumber}` : ''} is marked verified${d.vendorName ? ` for ${d.vendorName}` : ''}.`,
      consequence: 'Approving an expiry date writes it onto the vendor record, which is what the auto-block reads.',
      confirmLabel: 'Approve',
      tone: 'ok',
      reason: { label: 'Note (optional)', placeholder: 'Anything worth recording about this check.' }
    });
    this.pending = r => this.approve(d, r.reason);
  }

  askReject(d: ComplianceDoc) {
    this.confirm.set({
      title: 'Reject document',
      message: `${enumLabel(d.docType)}${d.docNumber ? ` · ${d.docNumber}` : ''} goes back to ${d.vendorName ?? 'the vendor'}.`,
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
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          `${enumLabel(d.docType)} approved`,
          `${d.vendorName ?? 'The vendor'} keeps selling. The expiry on this document is now the date the auto-block reads.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'approving this document')); this.busyId.set(null); }
    });
  }

  private reject(d: ComplianceDoc, reason: string) {
    this.busyId.set(d.id);
    // RejectDocRequest expects `reason` — the previous build posted `note`,
    // which failed validation on the server.
    this.api.post(`/admin/compliance/${d.id}/reject`, { reason }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          `${enumLabel(d.docType)} rejected`,
          `${d.vendorName ?? 'The vendor'} sees your reason verbatim and has to upload a replacement before the licence expires.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'rejecting this document')); this.busyId.set(null); }
    });
  }
}
