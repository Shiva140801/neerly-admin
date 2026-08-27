import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReviewService } from './review.service';
import type { Review, ReviewStatus } from './review.model';
import { describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, humanize } from '../../shared/ui/urgency';

interface ReviewRow {
  review: Review;
  severity: Severity;
}

/**
 * Review moderation.
 *
 * The spam detector has already done the ranking work — `spamScore` and
 * `spamFlags` come back on every row — so the queue's job is to put the most
 * suspicious review at the top and show the admin *why* it was flagged before
 * they read the text. Hiding a genuine review costs a vendor real ranking
 * (rating is 40% of search position, PRD §12.3), so the score is shown as a
 * number rather than hidden behind a pill.
 */
@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .toolbar { display: flex; align-items: flex-end; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
    .toolbar .lookup { width: 300px; }

    .stars { font-size: 14px; font-weight: 700; letter-spacing: 1px; color: var(--admn); white-space: nowrap; }
    .stars.low { color: var(--err); }
    .body { max-width: 52ch; font-size: 13px; line-height: 1.55; color: var(--ink-800); }
    .no-text { color: var(--ink-400); font-style: italic; }

    .score { display: flex; align-items: baseline; gap: 5px; }
    .score .n { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ink-700); }
    .score .n.crit { color: var(--err); }
    .score .n.warn { color: var(--warn); }
    .score .u { font-size: 11px; color: var(--ink-500); }
    .flags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; }

    .reply { margin-top: 6px; padding: 8px 10px; background: var(--vend-soft); border-radius: var(--r-sm); font-size: 12px; color: var(--vend-dark); }
  `],
  template: `
    <app-page-header
      title="Review" accent="moderation"
      subtitle="Sorted by spam score, worst first. Rating is 40% of a vendor's search ranking — hiding a genuine review costs them real orders.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="loadFlagged()" [disabled]="loading()">
        {{ loading() ? 'Loading…' : 'Reload flagged' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div>
        <span class="field-label">Queue</span>
        <div class="chips">
          <button type="button" class="chip" [class.active]="mode() === 'FLAGGED'" (click)="loadFlagged()">
            Flagged queue
            @if (mode() === 'FLAGGED' && !loading()) { <span class="count">{{ rows().length }}</span> }
          </button>
        </div>
      </div>
      <div>
        <label class="field-label" for="rv-vendor">Or inspect one vendor's public feed</label>
        <div class="row-flex gap-8">
          <input id="rv-vendor" class="input lookup mono" [(ngModel)]="vendorId" placeholder="Vendor UUID" />
          <button type="button" class="btn btn--ghost btn--sm" (click)="loadByVendor()"
                  [disabled]="!vendorId.trim()">Load feed</button>
        </div>
      </div>
    </div>

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the moderation queue"
          [loading]="loading()" [error]="error()"
          [emptyTitle]="mode() === 'FLAGGED' ? 'Nothing flagged' : 'No reviews for that vendor'"
          [emptyDetail]="mode() === 'FLAGGED'
            ? 'The spam detector has not raised anything, and no review is sitting in pending moderation.'
            : 'That vendor has no public reviews yet, or the id does not match a vendor.'"
          [clear]="mode() === 'FLAGGED'"
          (retry)="mode() === 'FLAGGED' ? loadFlagged() : loadByVendor()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Spam score</th>
              <th>Rating</th>
              <th>What the customer wrote</th>
              <th>Status</th>
              <th>Posted</th>
              <th class="right">Moderate</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.review.id) {
              <tr [class.sev-crit]="r.severity === 'crit'" [class.sev-warn]="r.severity === 'warn'">
                <td>
                  <span class="score">
                    <span class="n" [class.crit]="r.severity === 'crit'" [class.warn]="r.severity === 'warn'">
                      {{ r.review.spamScore | number:'1.2-2' }}
                    </span>
                    <span class="u">/ 1.00</span>
                  </span>
                  @if (r.review.spamFlags.length) {
                    <span class="flags">
                      @for (f of r.review.spamFlags; track f) { <span class="pill pill--crit">{{ label(f) }}</span> }
                    </span>
                  } @else {
                    <div class="sub-cell">no detector flags</div>
                  }
                </td>
                <td>
                  <span class="stars" [class.low]="r.review.rating <= 2">{{ stars(r.review.rating) }}</span>
                  <div class="sub-cell">{{ r.review.rating }} of 5</div>
                </td>
                <td>
                  @if (r.review.text) {
                    <div class="body">{{ r.review.text }}</div>
                  } @else {
                    <div class="body no-text">Rating only — no written review.</div>
                  }
                  @if (r.review.vendorResponse) {
                    <div class="reply">Vendor replied: {{ r.review.vendorResponse.text }}</div>
                  }
                </td>
                <td>
                  <span class="pill"
                        [class.pill--ok]="r.review.status === 'VISIBLE'"
                        [class.pill--warn]="r.review.status === 'PENDING_MODERATION'"
                        [class.pill--crit]="r.review.status !== 'VISIBLE' && r.review.status !== 'PENDING_MODERATION'">
                    {{ label(r.review.status) }}
                  </span>
                </td>
                <td>{{ r.review.createdAt | date:'d MMM y' }}</td>
                <td class="right">
                  <span class="row-flex gap-6" style="justify-content:flex-end;">
                    @if (r.review.status === 'VISIBLE' || r.review.status === 'PENDING_MODERATION') {
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askModerate(r.review, 'VISIBLE')"
                              [disabled]="busyId() === r.review.id">Keep</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askModerate(r.review, 'HIDDEN_ABUSE')"
                              [disabled]="busyId() === r.review.id">Hide</button>
                    } @else {
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askModerate(r.review, 'VISIBLE')"
                              [disabled]="busyId() === r.review.id">Restore</button>
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

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class ReviewsComponent {
  private service = inject(ReviewService);

  loading = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  busyId = signal<string | null>(null);
  items = signal<Review[]>([]);
  vendorId = '';

  mode = signal<'FLAGGED' | 'VENDOR'>('FLAGGED');

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.loadFlagged(); }

  label(v: string) { return humanize(v); }
  stars(n: number): string { return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)); }

  readonly rows = computed<ReviewRow[]>(() =>
    [...this.items()]
      .map(review => {
        const score = Number(review.spamScore ?? 0);
        const severity: Severity = score >= 0.7 || review.spamFlags.length >= 2 ? 'crit'
          : score >= 0.4 || review.spamFlags.length > 0 ? 'warn' : 'ok';
        return { review, severity };
      })
      .sort((a, b) => Number(b.review.spamScore ?? 0) - Number(a.review.spamScore ?? 0)));

  loadFlagged() {
    this.mode.set('FLAGGED');
    this.loading.set(true);
    this.error.set(null);
    this.service.listFlagged(0, 100).subscribe({
      next: rows => { this.items.set(rows ?? []); this.loading.set(false); },
      error: e => {
        this.error.set(describeError(e, 'the moderation queue'));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }

  loadByVendor() {
    if (!this.vendorId.trim()) return;
    this.mode.set('VENDOR');
    this.loading.set(true);
    this.error.set(null);
    this.service.listForVendor(this.vendorId.trim(), 0, 100).subscribe({
      next: rows => { this.items.set(rows ?? []); this.loading.set(false); },
      error: e => {
        this.error.set(describeError(e, "that vendor's reviews"));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }

  askModerate(r: Review, status: ReviewStatus) {
    const hiding = status !== 'VISIBLE';
    this.confirm.set({
      title: hiding ? 'Hide this review' : 'Keep this review public',
      message: hiding
        ? `${r.rating}★ review is pulled from the vendor's public profile and stops counting toward their rating.`
        : `${r.rating}★ review stays on the vendor's public profile and counts toward their rating.`,
      confirmLabel: hiding ? 'Hide review' : 'Keep visible',
      tone: hiding ? 'danger' : 'ok',
      reason: {
        label: hiding ? 'Reason' : 'Note (optional)',
        placeholder: hiding ? 'Why this is abuse or spam rather than a real complaint.' : 'Why you cleared the flag.',
        required: hiding
      },
      consequence: hiding
        ? 'Average rating is 40% of a vendor’s search ranking — hiding a genuine review costs them orders.'
        : undefined
    });
    this.pending = res => this.moderate(r, status, res.reason);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(result);
  }

  moderate(r: Review, status: ReviewStatus, note = '') {
    this.busyId.set(r.id);
    this.actionError.set(null);
    this.service.moderate(r.id, { status, note: note || undefined }).subscribe({
      next: () => {
        this.busyId.set(null);
        if (this.mode() === 'FLAGGED') this.loadFlagged(); else this.loadByVendor();
      },
      error: e => { this.actionError.set(describeError(e, 'the moderation action')); this.busyId.set(null); }
    });
  }
}
