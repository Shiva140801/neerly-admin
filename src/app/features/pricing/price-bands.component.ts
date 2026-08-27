import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PricingService } from './pricing.service';
import type { PriceBandResponse } from './price-band.model';
import { describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

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
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent],
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
          <span class="text-label">{{ bands().length }} active</span>
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
                    <td class="mono primary-cell">{{ b.categoryCode }}</td>
                    <td>{{ b.city }}</td>
                    <td class="right"><span class="price">₹{{ b.minPrice }}</span></td>
                    <td class="right"><span class="price">₹{{ b.maxPrice }}</span></td>
                    <td>
                      <span class="range">
                        <span class="bar"><i [style.left.%]="offset(b)" [style.width.%]="width(b)"></i></span>
                        <span class="w">₹{{ b.maxPrice - b.minPrice }} wide</span>
                      </span>
                    </td>
                    <td>
                      {{ b.effectiveFrom | date:'d MMM y' }}
                      @if (b.effectiveTo) { <div class="sub-cell">until {{ b.effectiveTo | date:'d MMM y' }}</div> }
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

          <label class="field-label" for="pb-cat">Category code</label>
          <input id="pb-cat" class="input mono" [(ngModel)]="form.categoryCode" placeholder="JAR_20L_NORMAL" />

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

          <button type="button" class="btn btn--primary primary mt-16" style="width:100%;"
                  [disabled]="!valid() || saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save band' }}
          </button>

          @if (saveError(); as e) { <div class="err">{{ e }}</div> }
        </div>
      </div>
    </div>
  `
})
export class PriceBandsComponent {
  private service = inject(PricingService);

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
    this.service.upsert({ ...this.form }).subscribe({
      next: () => {
        this.form = { categoryCode: '', city: 'Hyderabad', minPrice: 0, maxPrice: 0 };
        this.saving.set(false);
        this.reload();
      },
      error: e => { this.saveError.set(describeError(e, 'the band')); this.saving.set(false); }
    });
  }
}
