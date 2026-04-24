import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PromoService } from './promo.service';
import type { CreatePromoRequest, DiscountType, Promo, PromoEligibility } from './promo.model';

@Component({
  selector: 'app-promos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .form { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
            padding: 20px; margin-bottom: 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .form label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
                  color: var(--ink-500); margin-bottom: 4px; font-weight: 600; }
    .form input, .form select, .form textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--ink-200);
                                                 border-radius: var(--r-sm); font-size: 14px; background: var(--paper); }
    .form .wide { grid-column: span 2; }
    .actions { grid-column: span 4; display: flex; justify-content: flex-end; }
    button.primary { padding: 10px 18px; background: var(--admn); color: var(--paper); border: none;
                     border-radius: var(--r-sm); font-weight: 600; cursor: pointer; font-size: 14px; }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .code { font-family: var(--font-mono); font-weight: 700; color: var(--admn); }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.active { background: var(--ok-soft); color: var(--ok); }
    .pill.off { background: var(--ink-100); color: var(--ink-500); }
    button.off { padding: 6px 12px; border: 1px solid var(--err); color: var(--err); background: var(--paper);
                 border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Promos <em>catalog</em></h1>

    <div class="form">
      <div>
        <label>Code</label>
        <input [(ngModel)]="form.code" placeholder="NEERLY50" />
      </div>
      <div>
        <label>Type</label>
        <select [(ngModel)]="form.discountType">
          <option value="FLAT">Flat ₹</option>
          <option value="PERCENT">Percent %</option>
        </select>
      </div>
      <div>
        <label>Value</label>
        <input type="number" step="0.01" [(ngModel)]="form.discountValue" />
      </div>
      <div>
        <label>Max discount (cap)</label>
        <input type="number" step="0.01" [(ngModel)]="form.maxDiscount" />
      </div>
      <div>
        <label>Min order value</label>
        <input type="number" step="0.01" [(ngModel)]="form.minOrderValue" />
      </div>
      <div>
        <label>Eligibility</label>
        <select [(ngModel)]="form.eligibility">
          <option value="ALL">All customers</option>
          <option value="FIRST_ORDER">First order only</option>
          <option value="REFERRAL">Referral</option>
          <option value="SPECIFIC_CUSTOMER">Specific customer</option>
        </select>
      </div>
      <div>
        <label>Max per customer</label>
        <input type="number" [(ngModel)]="form.maxPerCustomer" />
      </div>
      <div>
        <label>Global cap</label>
        <input type="number" [(ngModel)]="form.maxRedemptions" placeholder="unlimited" />
      </div>
      <div>
        <label>Valid from</label>
        <input type="datetime-local" [(ngModel)]="form.validFromLocal" />
      </div>
      <div>
        <label>Valid until</label>
        <input type="datetime-local" [(ngModel)]="form.validUntilLocal" />
      </div>
      <div class="wide">
        <label>Description</label>
        <input [(ngModel)]="form.description" />
      </div>
      <div class="actions">
        <button class="primary" (click)="create()">Create promo</button>
      </div>
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">No active promos — seed one above.</div> }
    @else {
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Discount</th><th>Min order</th><th>Eligibility</th>
              <th>Redemptions</th><th>Valid until</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (p of items(); track p.id) {
              <tr>
                <td><span class="code">{{ p.code }}</span>
                  <div style="color: var(--ink-500); font-size: 12px;">{{ p.description }}</div>
                </td>
                <td>
                  @if (p.discountType === 'FLAT') { ₹{{ p.discountValue }} }
                  @else { {{ p.discountValue }}%
                    @if (p.maxDiscount) { <span style="color: var(--ink-500);"> · cap ₹{{ p.maxDiscount }}</span> }
                  }
                </td>
                <td>₹{{ p.minOrderValue }}</td>
                <td>{{ p.eligibility }}</td>
                <td>{{ p.currentRedemptions }}@if (p.maxRedemptions) { <span style="color: var(--ink-500);"> / {{ p.maxRedemptions }}</span> }</td>
                <td>{{ p.validUntil | date:'mediumDate' }}</td>
                <td>
                  <span class="pill" [class.active]="p.isActive" [class.off]="!p.isActive">
                    {{ p.isActive ? 'ACTIVE' : 'RETIRED' }}
                  </span>
                </td>
                <td>
                  @if (p.isActive) {
                    <button class="off" (click)="deactivate(p)">Retire</button>
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
export class PromosComponent {
  private service = inject(PromoService);

  loading = signal(true);
  items = signal<Promo[]>([]);

  form: Omit<CreatePromoRequest, 'validFrom' | 'validUntil'> & {
    validFromLocal: string;
    validUntilLocal: string;
  } = {
    code: '',
    description: '',
    discountType: 'FLAT' as DiscountType,
    discountValue: 50,
    maxDiscount: undefined,
    minOrderValue: 100,
    eligibility: 'ALL' as PromoEligibility,
    maxRedemptions: undefined,
    maxPerCustomer: 1,
    validFromLocal: '',
    validUntilLocal: ''
  };

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.service.list().subscribe({
      next: rows => { this.items.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  create() {
    if (!this.form.code || !this.form.validFromLocal || !this.form.validUntilLocal) return;
    const body: CreatePromoRequest = {
      code: this.form.code.toUpperCase(),
      description: this.form.description || undefined,
      discountType: this.form.discountType,
      discountValue: this.form.discountValue,
      maxDiscount: this.form.maxDiscount,
      minOrderValue: this.form.minOrderValue,
      eligibility: this.form.eligibility,
      specificCustomerId: this.form.specificCustomerId,
      maxRedemptions: this.form.maxRedemptions,
      maxPerCustomer: this.form.maxPerCustomer,
      validFrom: new Date(this.form.validFromLocal).toISOString(),
      validUntil: new Date(this.form.validUntilLocal).toISOString()
    };
    this.service.create(body).subscribe(() => {
      this.form.code = '';
      this.form.description = '';
      this.reload();
    });
  }

  deactivate(p: Promo) {
    this.service.deactivate(p.id).subscribe(() => this.reload());
  }
}
