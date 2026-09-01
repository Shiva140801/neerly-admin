import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PricingService } from './pricing.service';
import type { PriceBandResponse } from './price-band.model';
import { describeActionError, describeError } from '../../shared/api-error';
import { PRODUCT_CATEGORY_CODES, label as enumLabel } from '../../shared/labels';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { formatRupees } from '../../shared/ui/format';
import { RupeesPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';

/**
 * Price bands.
 *
 * The band is the floor and ceiling a vendor may price a category within
 * (PRD §10.1) — it is the single lever that stops a race to the bottom on one
 * side and gouging on the other, so the width of each band matters as much as
 * its endpoints. The table draws that width so a band that has drifted too
 * wide, or collapsed to a near-fixed price, is visible at a glance.
 */
@Component({
  selector: 'app-price-bands',
  standalone: true,
  imports: [
    CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent,
    WhenPipe, RupeesPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 20px; align-items: start; }
    @media (max-width: 1040px) { .grid { grid-template-columns: 1fr; } }

    .range { display: flex; align-items: center; gap: 9px; }
    .range .bar {
      position: relative; height: 5px; width: 130px;
      background: var(--ink-100); border-radius: var(--r-pill);
    }
    .range .bar i {
      position: absolute; top: 0; height: 100%;
      background: var(--admn); border-radius: var(--r-pill);
    }
    .range .w { font-size: 11.5px; color: var(--ink-500); font-variant-numeric: tabular-nums; white-space: nowrap; }

    .price { font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }

    .form-body { padding: 18px; }
    .form-body .hint { font-size: 12.5px; color: var(--ink-600); line-height: 1.55; margin: 0 0 14px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .err { color: var(--err-ink); font-size: 12.5px; font-weight: 600; margin-top: 10px; }
  `],
  template: `
    <app-page-header
      title="Price" accent="bands"
      subtitle="The floor and ceiling a vendor may price a category within. Too wide invites gouging; too narrow and vendors cannot compete on anything but speed." />

    <div class="grid">
      <div class="panel">
        <div class="panel-head">
          <h2>Bands in force</h2>
          <span class="text-label">{{ loading() ? 'still counting…' : bands().length + ' active' }}</span>
        </div>

        @if (loading() || error() || bands().length === 0) {
          <app-data-state
            what="price bands"
            [loading]="loading()" [error]="error()"
            emptyTitle="No bands set"
            emptyDetail="Without a band, nothing constrains what a vendor charges for a category. Create the first one on the right."
            [compact]="true"
            (retry)="reload()" />
        } @else {
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Category</th><th>City</th>
                  <th class="right">Min</th><th class="right">Max</th>
                  <th>Spread</th><th>In force since</th>
                </tr>
              </thead>
              <tbody>
                @for (b of bands(); track b.id) {
                  <tr>
                    <td class="primary-cell">
                      {{ categoryLabel(b.categoryCode) }}
                      <div class="sub-cell mono">{{ b.categoryCode }}</div>
                    </td>
                    <td>{{ b.city }}</td>
                    <td class="right"><span class="price">{{ b.minPrice | rupees }}</span></td>
                    <td class="right"><span class="price">{{ b.maxPrice | rupees }}</span></td>
                    <td>
                      <span class="range">
                        <span class="bar"><i [style.left.%]="offset(b)" [style.width.%]="width(b)"></i></span>
                        <span class="w">{{ b.maxPrice - b.minPrice | rupees }} wide</span>
                      </span>
                    </td>
                    <td>
                      {{ b.effectiveFrom | when:'date' }}
                      @if (b.effectiveTo) { <div class="sub-cell">until {{ b.effectiveTo | when:'date' }}</div> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="panel">
        <div class="panel-head"><h2>New band</h2></div>
        <div class="form-body">
          <p class="hint">
            Saving a band for a (category, city) pair that already has one closes the previous band and
            opens this one from now. Existing orders keep the price they were quoted.
          </p>

          <!-- Typed free-text silently created a band against a category that
               does not exist. The list is the platform's own catalog, plus any
               code an existing band already uses. -->
          <label class="field-label" for="pb-cat">Category</label>
          <select id="pb-cat" class="input" [(ngModel)]="form.categoryCode">
            <option value="" disabled>Choose a category…</option>
            @for (c of categoryOptions(); track c) { <option [value]="c">{{ categoryLabel(c) }}</option> }
          </select>

          <label class="field-label mt-12" for="pb-city">City</label>
          <input id="pb-city" class="input" [(ngModel)]="form.city" placeholder="Hyderabad" />

          <div class="pair mt-12">
            <div>
              <label class="field-label" for="pb-min">Min ₹</label>
              <input id="pb-min" class="input num" type="number" min="0" [(ngModel)]="form.minPrice" />
            </div>
            <div>
              <label class="field-label" for="pb-max">Max ₹</label>
              <input id="pb-max" class="input num" type="number" min="0" [(ngModel)]="form.maxPrice" />
            </div>
          </div>

          @if (form.maxPrice > 0 && form.maxPrice < form.minPrice) {
            <div class="err">Maximum has to be at least the minimum.</div>
          }

          <!-- This changes what every vendor in the city may charge for a whole
               category. It saved on one click while cancelling a single ₹385
               order demanded a typed reason. -->
          <button type="button" class="btn btn--primary primary mt-16" style="width:100%;"
                  [disabled]="!valid() || saving()" (click)="askSave()">
            {{ saving() ? 'Saving…' : 'Save band' }}
          </button>

          @if (saveError(); as e) { <div class="err">{{ e }}</div> }
        </div>
      </div>
    </div>

    <app-confirm-dialog [request]="confirm()" [busy]="saving()"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class PriceBandsComponent {
  private service = inject(PricingService);
  private toasts = inject(ToastService);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: (() => void) | null = null;

  bands = signal<PriceBandResponse[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  saveError = signal<string | null>(null);
  saving = signal(false);
  form = { categoryCode: '', city: 'Hyderabad', minPrice: 0, maxPrice: 0 };

  constructor() { this.reload(); }

  valid() {
    return this.form.categoryCode.trim() && this.form.city.trim()
      && this.form.minPrice > 0 && this.form.maxPrice >= this.form.minPrice;
  }

  categoryLabel(code: string) { return enumLabel(code); }

  /**
   * The catalog's categories plus any code already carrying a band.
   *
   * The admin token cannot read `/vendor/catalog/templates` (it is vendor-role
   * gated), so the canonical list is mirrored in `labels.ts`; merging in the
   * codes actually in use means a category added on the backend still appears
   * here as soon as anything references it.
   */
  readonly categoryOptions = computed(() => {
    const inUse = this.bands().map(b => b.categoryCode);
    return [...new Set([...PRODUCT_CATEGORY_CODES, ...inUse])];
  });

  askSave() {
    if (!this.valid()) return;
    const f = this.form;
    const existing = this.bands().find(b => b.categoryCode === f.categoryCode && b.city === f.city);
    this.confirm.set({
      title: `Set the ${enumLabel(f.categoryCode)} band`,
      message: `Every vendor in ${f.city} will be held to ${formatRupees(f.minPrice)}–${formatRupees(f.maxPrice)} for this category.`,
      confirmLabel: 'Put this band in force',
      tone: 'primary',
      consequence: existing
        ? `This closes the current ${formatRupees(existing.minPrice)}–${formatRupees(existing.maxPrice)} band and opens the new one from now. Orders already placed keep the price they were quoted.`
        : 'No band exists for this pair yet, so nothing currently constrains what vendors charge for it.'
    });
    this.pending = () => this.save();
  }

  runConfirmed(_result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.();
  }

  /** Widest ceiling across all bands, so every spread bar shares one scale. */
  private ceiling = computed(() =>
    Math.max(1, ...this.bands().map(b => Number(b.maxPrice) || 0)));

  offset(b: PriceBandResponse): number {
    return Math.max(0, Math.min(100, (Number(b.minPrice) / this.ceiling()) * 100));
  }

  width(b: PriceBandResponse): number {
    const w = ((Number(b.maxPrice) - Number(b.minPrice)) / this.ceiling()) * 100;
    return Math.max(3, Math.min(100 - this.offset(b), w));
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: bs => { this.bands.set(bs ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'price bands')); this.bands.set([]); this.loading.set(false); }
    });
  }

  save() {
    this.saving.set(true);
    this.saveError.set(null);
    const saved = { ...this.form };
    this.service.upsert(saved).subscribe({
      next: () => {
        this.form = { categoryCode: '', city: 'Hyderabad', minPrice: 0, maxPrice: 0 };
        this.saving.set(false);
        this.toasts.success(
          `${enumLabel(saved.categoryCode)} band in force`,
          `${formatRupees(saved.minPrice)}–${formatRupees(saved.maxPrice)} in ${saved.city}, from now. Existing orders keep their quoted price.`
        );
        this.reload();
      },
      error: e => { this.saveError.set(describeActionError(e, 'saving this price band')); this.saving.set(false); }
    });
  }
}
