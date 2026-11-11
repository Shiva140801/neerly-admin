import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';
import { describeActionError, describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import { EvidenceService } from '../../shared/evidence.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';

/** Mirror of backend `ProductReviewRow` (fields this page reads). */
export interface ProductReviewRow {
  vendorName: string | null;
  submittedAt: string | null;
  product: {
    id: string;
    vendorId: string;
    price: number;
    dailyCapacity: number;
    photoUrl: string | null;
    description: string | null;
    depositAmount: number | null;
    allowTransferAndReturn: boolean;
    template: { displayName: string; sizeLabel: string; containerType: string };
    custom: {
      category: 'WATER' | 'ICE' | 'OTHER';
      kind: string | null;
      unit: 'L' | 'ML' | 'KG' | 'PCS';
      size: number;
      packaging: 'RETURNABLE' | 'SEALED' | 'BAG' | 'TANKER' | 'LOOSE';
      packCount: number | null;
      name: string | null;
    } | null;
  };
}

const PACKAGING: Record<string, string> = {
  RETURNABLE: 'Returnable jar/can', SEALED: 'Sealed bottle/case', BAG: 'Bag', TANKER: 'Tanker (per trip)', LOOSE: 'Loose / refill'
};

/**
 * Products to review — products a shop made itself (no template fits: "Ice cubes · 1 kg
 * bag"). Customers don't see them until they're approved here. Check the name says what
 * it is, the size and unit are believable for the price, and a deposit is only on a
 * container that comes back.
 */
@Component({
  selector: 'app-products-review',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Products to review" accent="supply"
      subtitle="Products shops made themselves. Customers can't see them until you approve. Oldest first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="panel">
      @if (loading() || error() || rows().length === 0) {
        <app-data-state what="products" [loading]="loading()" [error]="error()"
          emptyTitle="No product is waiting" [clear]="true" (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Sent</th><th>Shop</th><th>Product</th><th>Packed as</th><th class="right">Price</th><th>Photo</th><th class="right"></th></tr></thead>
            <tbody>
              @for (r of rows(); track r.product.id) {
                <tr>
                  <td>{{ r.submittedAt | when }}</td>
                  <td><strong>{{ r.vendorName ?? r.product.vendorId.slice(0, 8) }}</strong></td>
                  <td><strong>{{ r.product.template.displayName }}</strong>
                    <div class="sub-cell">{{ category(r) }} · {{ r.product.template.sizeLabel }}{{ r.product.custom?.kind ? ' · ' + (r.product.custom?.kind | lowercase) : '' }}</div>
                    @if (r.product.description) { <div class="sub-cell">{{ r.product.description }}</div> }
                  </td>
                  <td>{{ packaging(r) }}
                    @if (r.product.depositAmount) { <div class="sub-cell">Deposit ₹{{ r.product.depositAmount }}</div> }
                  </td>
                  <td class="right mono">₹{{ r.product.price }}<div class="sub-cell">{{ r.product.dailyCapacity }}/day</div></td>
                  <td>
                    @if (r.product.photoUrl; as key) {
                      @if (evidence.link(key)(); as l) {
                        @if (l.url) { <a [href]="l.url" target="_blank" rel="noopener">Open photo</a> }
                        @else if (l.state === 'loading') { <span class="sub-cell">Loading…</span> }
                        @else { <span class="sub-cell">{{ l.reason }}</span> }
                      }
                    } @else { <span class="sub-cell">No photo</span> }
                  </td>
                  <td class="right">
                    <span class="row-flex gap-6" style="justify-content:flex-end;">
                      <button type="button" class="btn btn--ok btn--sm" (click)="askApprove(r)" [disabled]="busy()">Approve…</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askReject(r)" [disabled]="busy()">Reject…</button>
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (actionError(); as e) { <div class="lede crit mt-16" role="alert">{{ e }}</div> }

    <app-confirm-dialog [request]="confirm()" [busy]="busy()"
                        (confirmed)="run($event)" (cancelled)="confirm.set(null)" />
  `
})
export class ProductsReviewComponent {
  private api = inject(ApiClient);
  private toasts = inject(ToastService);
  readonly evidence = inject(EvidenceService);

  readonly rows = signal<ProductReviewRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.reload(); }

  category(r: ProductReviewRow) {
    return ({ WATER: 'Water', ICE: 'Ice', OTHER: 'Other' } as Record<string, string>)[r.product.custom?.category ?? ''] ?? 'Product';
  }

  packaging(r: ProductReviewRow) {
    const p = r.product.custom?.packaging;
    const label = p ? PACKAGING[p] : r.product.template.containerType;
    return r.product.custom?.packCount ? `${label} · pack of ${r.product.custom.packCount}` : label;
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<ProductReviewRow[]>('/admin/catalog/products/pending').subscribe({
      next: rows => { this.rows.set(rows ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'products to review')); this.loading.set(false); }
    });
  }

  askApprove(r: ProductReviewRow) {
    this.confirm.set({
      title: 'Approve product',
      message: `${r.product.template.displayName} · ₹${r.product.price} from ${r.vendorName ?? 'this shop'}.`,
      consequence: 'Customers in the shop\'s area will see it and can order it straight away.',
      confirmLabel: 'Approve', tone: 'ok'
    });
    this.pending = () => this.act(`/admin/catalog/products/${r.product.id}/approve`, {}, `${r.product.template.displayName} is on sale`);
  }

  askReject(r: ProductReviewRow) {
    this.confirm.set({
      title: 'Reject product',
      message: `${r.product.template.displayName} from ${r.vendorName ?? 'this shop'}.`,
      consequence: 'The shop sees your reason and can fix the product and send it again.',
      confirmLabel: 'Reject', tone: 'danger',
      reason: { label: 'What the shop should fix', placeholder: 'e.g. The name doesn\'t say what size it is', required: true }
    });
    this.pending = c => this.act(`/admin/catalog/products/${r.product.id}/reject`, { reason: c.reason }, 'Product rejected — the shop has been told why');
  }

  run(r: ConfirmResult) { const p = this.pending; this.pending = null; p?.(r); }

  private act(path: string, body: unknown, done: string) {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.post<unknown>(path, body).subscribe({
      next: () => { this.busy.set(false); this.confirm.set(null); this.toasts.success(done); this.reload(); },
      error: e => { this.busy.set(false); this.confirm.set(null); this.actionError.set(describeActionError(e, 'reviewing this product')); }
    });
  }
}
