import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReviewService } from './review.service';
import type { Review, ReviewStatus } from './review.model';

/**
 * Two-mode moderation surface:
 *  • Default = global flagged-queue (`/admin/reviews/flagged`) — every
 *    review the spam detector raised + anything still PENDING_MODERATION,
 *    sorted by spam score so worst-first.
 *  • Vendor lookup = enter a vendor UUID for spot-checks of their public feed.
 *
 * Hide / restore actions PATCH /admin/reviews/{id}/moderate.
 */
@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .top { display: flex; gap: 12px; margin-bottom: 24px; align-items: end; }
    label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--ink-500);
            font-weight: 600; display: block; margin-bottom: 4px; }
    input { padding: 8px 10px; border: 1px solid var(--ink-200); border-radius: var(--r-sm);
            font-size: 14px; background: var(--paper); min-width: 320px; }
    button.primary { padding: 8px 14px; background: var(--admn); color: #fff; border: 0;
                     border-radius: var(--r-sm); font-size: 13px; font-weight: 600; cursor: pointer; }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .stars { color: var(--admn); font-weight: 700; }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.visible { background: var(--ok-soft); color: var(--ok); }
    .pill.pending { background: var(--warn-soft); color: var(--warn); }
    .pill.hidden  { background: var(--err-soft); color: var(--err); }
    .flag { background: var(--err-soft); color: var(--err); padding: 2px 6px;
            border-radius: var(--r-pill); font-size: 10px; margin-right: 4px; }
    button.hide, button.show { padding: 6px 10px; border-radius: var(--r-sm);
      cursor: pointer; font-size: 12px; font-weight: 600; border: 0; }
    button.hide { background: var(--err-soft); color: var(--err); }
    button.show { background: var(--ok-soft); color: var(--ok); }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Review <em>moderation</em></h1>
    <div class="top">
      <button class="primary" (click)="loadFlagged()">Flagged queue</button>
      <div>
        <label>or vendor id</label>
        <input [(ngModel)]="vendorId" placeholder="UUID (from Vendors page)" />
      </div>
      <button class="primary" (click)="loadByVendor()">Load feed</button>
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">No reviews to moderate.</div> }
    @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>Rating</th><th>Text</th><th>Status · flags</th><th>Posted</th><th></th>
          </tr></thead>
          <tbody>
            @for (r of items(); track r.id) {
              <tr>
                <td><span class="stars">{{ stars(r.rating) }}</span></td>
                <td style="max-width: 480px;">{{ r.text ?? '—' }}</td>
                <td>
                  <span class="pill"
                        [class.visible]="r.status === 'VISIBLE'"
                        [class.pending]="r.status === 'PENDING_MODERATION'"
                        [class.hidden]="r.status === 'HIDDEN_SPAM' || r.status === 'HIDDEN_ABUSE' || r.status === 'DELETED'">
                    {{ r.status }}
                  </span>
                  @if (r.spamFlags.length) {
                    <div style="margin-top: 4px;">
                      @for (f of r.spamFlags; track f) { <span class="flag">{{ f }}</span> }
                    </div>
                  }
                </td>
                <td>{{ r.createdAt | date:'mediumDate' }}</td>
                <td>
                  @if (r.status === 'VISIBLE' || r.status === 'PENDING_MODERATION') {
                    <button class="hide" (click)="moderate(r, 'HIDDEN_ABUSE')">Hide (abuse)</button>
                  } @else {
                    <button class="show" (click)="moderate(r, 'VISIBLE')">Restore</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `
})
export class ReviewsComponent {
  private service = inject(ReviewService);
  loading = signal(false);
  items = signal<Review[]>([]);
  vendorId = '';
  /** Last-load mode: re-runs after a moderation action so the row updates. */
  private lastMode: 'FLAGGED' | 'VENDOR' = 'FLAGGED';

  constructor() { this.loadFlagged(); }

  loadFlagged() {
    this.lastMode = 'FLAGGED';
    this.loading.set(true);
    this.service.listFlagged().subscribe({
      next: rows => { this.items.set(rows ?? []); this.loading.set(false); },
      error: () => { this.items.set([]); this.loading.set(false); }
    });
  }

  loadByVendor() {
    if (!this.vendorId.trim()) return;
    this.lastMode = 'VENDOR';
    this.loading.set(true);
    this.service.listForVendor(this.vendorId.trim()).subscribe({
      next: rows => { this.items.set(rows ?? []); this.loading.set(false); },
      error: () => { this.items.set([]); this.loading.set(false); }
    });
  }

  moderate(r: Review, status: ReviewStatus) {
    const note = status !== 'VISIBLE' ? (prompt('Reason for hiding (optional)') ?? '') : '';
    this.service.moderate(r.id, { status, note: note || undefined }).subscribe(() => {
      if (this.lastMode === 'FLAGGED') this.loadFlagged();
      else this.loadByVendor();
    });
  }

  stars(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n); }
}
