import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PricingService } from './pricing.service';
import type { PriceBandResponse } from './price-band.model';

@Component({
  selector: 'app-price-bands',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start; }
    .card { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
            padding: 20px; box-shadow: var(--shadow-1); margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; letter-spacing: 0.5px; color: var(--ink-500);
         font-weight: 600; text-transform: uppercase; padding: 12px 12px 12px 0; border-bottom: 1px solid var(--ink-100); }
    td { padding: 14px 12px 14px 0; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    input { width: 100%; padding: 10px; border: 1px solid var(--ink-200); border-radius: var(--r-md);
            font: inherit; font-size: 14px; }
    label { display: block; font-size: 12px; color: var(--ink-600); font-weight: 600; margin-bottom: 4px; margin-top: 12px; }
    button.primary { background: var(--admn); color: #fff; border: 0; border-radius: var(--r-pill);
                     padding: 12px 18px; font-weight: 600; cursor: pointer; margin-top: 16px; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .hint { font-size: 12px; color: var(--ink-500); margin-top: 4px; }
    .mono { font-family: var(--font-mono); font-size: 12px; color: var(--ink-700); }
  `],
  template: `
    <h1>Price <em>bands</em></h1>

    <div class="grid">
      <div class="card">
        <h3 style="margin: 0 0 16px; font-size: 15px;">Active bands</h3>
        @if (bands().length === 0) {
          <p style="color: var(--ink-500);">No bands set. Create the first one on the right.</p>
        } @else {
          <table>
            <thead>
              <tr><th>Category</th><th>City</th><th>Min</th><th>Max</th><th>Effective</th></tr>
            </thead>
            <tbody>
              @for (b of bands(); track b.id) {
                <tr>
                  <td class="mono">{{ b.categoryCode }}</td>
                  <td>{{ b.city }}</td>
                  <td>₹{{ b.minPrice }}</td>
                  <td>₹{{ b.maxPrice }}</td>
                  <td>{{ b.effectiveFrom | date:'shortDate' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <div class="card">
        <h3 style="margin: 0 0 8px; font-size: 15px;">New band</h3>
        <p class="hint">Creating a band for an existing (category, city) closes the previous one.</p>

        <label>Category code</label>
        <input [(ngModel)]="form.categoryCode" placeholder="e.g. JAR_20L_NORMAL"/>

        <label>City</label>
        <input [(ngModel)]="form.city" placeholder="Hyderabad"/>

        <label>Min price (₹)</label>
        <input type="number" [(ngModel)]="form.minPrice"/>

        <label>Max price (₹)</label>
        <input type="number" [(ngModel)]="form.maxPrice"/>

        <button class="primary" [disabled]="!valid() || saving()" (click)="save()">
          {{ saving() ? 'Saving…' : 'Save band' }}
        </button>
      </div>
    </div>
  `
})
export class PriceBandsComponent {
  private service = inject(PricingService);

  bands = signal<PriceBandResponse[]>([]);
  saving = signal(false);
  form = { categoryCode: '', city: 'Hyderabad', minPrice: 0, maxPrice: 0 };

  constructor() { this.reload(); }

  valid() {
    return this.form.categoryCode.trim() && this.form.city.trim()
      && this.form.minPrice > 0 && this.form.maxPrice >= this.form.minPrice;
  }

  reload() {
    this.service.list().subscribe(bs => this.bands.set(bs));
  }

  save() {
    this.saving.set(true);
    this.service.upsert({ ...this.form }).subscribe({
      next: () => { this.form = { categoryCode: '', city: 'Hyderabad', minPrice: 0, maxPrice: 0 };
                    this.saving.set(false); this.reload(); },
      error: () => this.saving.set(false)
    });
  }
}
