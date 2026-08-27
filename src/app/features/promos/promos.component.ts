import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PromoService } from './promo.service';
import type { CreatePromoRequest, DiscountType, Promo, PromoEligibility } from './promo.model';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, daysUntilDate, formatDuration, humanize, msUntil } from '../../shared/ui/urgency';

interface PromoRow {
  promo: Promo;
  live: boolean;
  daysLeft: number | null;
  /** Fraction of the global cap already redeemed, or null when uncapped. */
  usedPct: number | null;
  severity: Severity;
  note: string;
}

/**
 * Promo catalog.
 *
 * A promo is discount the platform pays for out of margin (PRD §13.5), so the
 * two numbers that matter are how much of the global cap has burnt and how long
 * is left to run. Both are shown on every row: a code at 95% of its cap with a
 * month to go is about to stop working mid-campaign, and a code that expires
 * tomorrow with 3% burnt never reached anyone.
 */
@Component({
  selector: 'app-promos',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 18px; }
    @media (max-width: 1080px) { .form { grid-template-columns: repeat(2, 1fr); } }
    .form .wide { grid-column: span 2; }
    .form .actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }

    .code {
      font-family: var(--font-mono); font-weight: 600; font-size: 13.5px;
      background: var(--admn-softer); color: var(--admn-dark);
      padding: 3px 8px; border-radius: var(--r-xs);
    }
    .discount { font-weight: 750; font-variant-numeric: tabular-nums; color: var(--ink-900); }

    .burn { display: flex; align-items: center; gap: 8px; }
    .burn .bar { width: 78px; height: 5px; border-radius: var(--r-pill); background: var(--ink-100); overflow: hidden; }
    .burn .bar i { display: block; height: 100%; background: var(--admn); }
    .burn .bar i.warn { background: var(--warn); }
    .burn .bar i.crit { background: var(--err); }
    .burn .n { font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--ink-700); font-weight: 650; }

    .err { color: var(--err-ink); font-size: 12.5px; font-weight: 600; }
  `],
  template: `
    <app-page-header
      title="Promo" accent="catalog"
      subtitle="Every redemption is margin the platform gives back. Watch the burn rate and the run-out date, not just whether the code is live." />

    <div class="panel">
      <div class="panel-head"><h2>New promo</h2></div>
      <div class="form">
        <div>
          <label class="field-label" for="pr-code">Code</label>
          <input id="pr-code" class="input mono" [(ngModel)]="form.code" placeholder="NEERLY50" />
        </div>
        <div>
          <label class="field-label" for="pr-type">Type</label>
          <select id="pr-type" class="input" [(ngModel)]="form.discountType">
            <option value="FLAT">Flat ₹</option>
            <option value="PERCENT">Percent %</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="pr-val">Value</label>
          <input id="pr-val" class="input num" type="number" step="0.01" [(ngModel)]="form.discountValue" />
        </div>
        <div>
          <label class="field-label" for="pr-cap">Discount cap ₹</label>
          <input id="pr-cap" class="input num" type="number" step="0.01" [(ngModel)]="form.maxDiscount" placeholder="none" />
        </div>
        <div>
          <label class="field-label" for="pr-min">Min order ₹</label>
          <input id="pr-min" class="input num" type="number" step="0.01" [(ngModel)]="form.minOrderValue" />
        </div>
        <div>
          <label class="field-label" for="pr-elig">Eligibility</label>
          <select id="pr-elig" class="input" [(ngModel)]="form.eligibility">
            <option value="ALL">All customers</option>
            <option value="FIRST_ORDER">First order only</option>
            <option value="REFERRAL">Referral</option>
            <option value="SPECIFIC_CUSTOMER">Specific customer</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="pr-per">Max per customer</label>
          <input id="pr-per" class="input num" type="number" [(ngModel)]="form.maxPerCustomer" />
        </div>
        <div>
          <label class="field-label" for="pr-global">Global cap</label>
          <input id="pr-global" class="input num" type="number" [(ngModel)]="form.maxRedemptions" placeholder="unlimited" />
        </div>
        <div>
          <label class="field-label" for="pr-from">Valid from</label>
          <input id="pr-from" class="input" type="datetime-local" [(ngModel)]="form.validFromLocal" />
        </div>
        <div>
          <label class="field-label" for="pr-until">Valid until</label>
          <input id="pr-until" class="input" type="datetime-local" [(ngModel)]="form.validUntilLocal" />
        </div>
        <div class="wide">
          <label class="field-label" for="pr-desc">Description</label>
          <input id="pr-desc" class="input" [(ngModel)]="form.description" placeholder="What this campaign is for." />
        </div>
        <div class="actions">
          @if (createError(); as e) { <span class="err">{{ e }}</span> }
          @if (!formReady()) { <span class="muted" style="font-size:12.5px;align-self:center;">Code and both dates are required.</span> }
          <button type="button" class="btn btn--primary primary" (click)="askCreate()" [disabled]="!formReady()">
            Create promo
          </button>
        </div>
      </div>
    </div>

    <div class="panel mt-24">
      <div class="panel-head">
        <h2>Catalog</h2>
        <span class="text-label">{{ liveCount() }} live of {{ rows().length }}</span>
      </div>

      @if (loading() || error() || rows().length === 0) {
        <app-data-state
          what="the promo catalog"
          [loading]="loading()" [error]="error()"
          emptyTitle="No active promos"
          emptyDetail="Nothing is discounting an order right now. Seed a campaign above when you want to buy demand."
          [compact]="true"
          (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Code</th><th>Discount</th><th class="right">Min order</th>
                <th>Who</th><th>Burn</th><th>Runs until</th><th>Status</th><th class="right"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.promo.id) {
                <tr [class.sev-crit]="r.severity === 'crit'" [class.sev-warn]="r.severity === 'warn'">
                  <td>
                    <span class="code">{{ r.promo.code }}</span>
                    @if (r.promo.description) { <div class="sub-cell">{{ r.promo.description }}</div> }
                  </td>
                  <td>
                    <span class="discount">
                      @if (r.promo.discountType === 'FLAT') { ₹{{ r.promo.discountValue }} }
                      @else { {{ r.promo.discountValue }}% }
                    </span>
                    @if (r.promo.maxDiscount) { <div class="sub-cell">capped at ₹{{ r.promo.maxDiscount }}</div> }
                  </td>
                  <td class="right num">₹{{ r.promo.minOrderValue }}</td>
                  <td>
                    <span class="pill pill--outline">{{ label(r.promo.eligibility) }}</span>
                    <div class="sub-cell">{{ r.promo.maxPerCustomer }} per customer</div>
                  </td>
                  <td>
                    <span class="burn">
                      @if (r.usedPct !== null) {
                        <span class="bar">
                          <i [style.width.%]="r.usedPct"
                             [class.warn]="r.usedPct >= 70 && r.usedPct < 90"
                             [class.crit]="r.usedPct >= 90"></i>
                        </span>
                        <span class="n">{{ r.promo.currentRedemptions }} / {{ r.promo.maxRedemptions }}</span>
                      } @else {
                        <span class="n">{{ r.promo.currentRedemptions }}</span>
                        <span class="muted" style="font-size:11.5px;">uncapped</span>
                      }
                    </span>
                  </td>
                  <td>
                    <div>{{ r.promo.validUntil | date:'d MMM y' }}</div>
                    <div class="sub-cell">{{ r.note }}</div>
                  </td>
                  <td>
                    <span class="pill" [class.pill--ok]="r.live" [class.pill--mute]="!r.live">
                      {{ r.live ? 'Live' : (r.promo.isActive ? 'Scheduled' : 'Retired') }}
                    </span>
                  </td>
                  <td class="right">
                    @if (r.promo.isActive) {
                      <button type="button" class="btn btn--danger btn--sm off" (click)="askDeactivate(r.promo)">Retire</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <app-confirm-dialog [request]="confirm()" (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class PromosComponent {
  private service = inject(PromoService);
  private clock = inject(ClockService);

  loading = signal(true);
  error = signal<string | null>(null);
  createError = signal<string | null>(null);
  items = signal<Promo[]>([]);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

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

  label(v: string) { return humanize(v); }

  formReady(): boolean {
    return !!this.form.code.trim() && !!this.form.validFromLocal && !!this.form.validUntilLocal;
  }

  readonly rows = computed<PromoRow[]>(() => {
    const now = this.clock.now();
    return [...this.items()]
      .map(promo => {
        const started = (msUntil(promo.validFrom, now) ?? 0) <= 0;
        const remaining = msUntil(promo.validUntil, now);
        const live = promo.isActive && started && (remaining ?? 0) > 0;
        const daysLeft = daysUntilDate(promo.validUntil?.slice(0, 10), now);
        const usedPct = promo.maxRedemptions
          ? Math.min(100, Math.round((promo.currentRedemptions / promo.maxRedemptions) * 100))
          : null;

        let severity: Severity = 'ok';
        let note: string;
        if (!promo.isActive) { severity = 'idle'; note = 'retired'; }
        else if (!started) { note = `starts in ${formatDuration(msUntil(promo.validFrom, now) ?? 0)}`; }
        else if ((remaining ?? 0) <= 0) { severity = 'idle'; note = 'expired'; }
        else if (usedPct !== null && usedPct >= 90) { severity = 'crit'; note = `${100 - usedPct}% of cap left`; }
        else if ((daysLeft ?? 99) <= 3) { severity = 'warn'; note = `${daysLeft}d left to run`; }
        else { note = `${formatDuration(remaining ?? 0)} left to run`; }

        return { promo, live, daysLeft, usedPct, severity, note };
      })
      .sort((a, b) => Number(b.live) - Number(a.live) ||
        Date.parse(b.promo.createdAt) - Date.parse(a.promo.createdAt));
  });

  readonly liveCount = computed(() => this.rows().filter(r => r.live).length);

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: rows => { this.items.set(rows ?? []); this.loading.set(false); this.clock.sync(); },
      error: e => { this.error.set(describeError(e, 'the promo catalog')); this.items.set([]); this.loading.set(false); }
    });
  }

  askCreate() {
    if (!this.formReady()) return;
    const value = this.form.discountType === 'FLAT'
      ? `₹${this.form.discountValue}` : `${this.form.discountValue}%`;
    this.confirm.set({
      title: `Publish ${this.form.code.toUpperCase()}`,
      message: `${value} off orders over ₹${this.form.minOrderValue}, ${humanize(this.form.eligibility)}.`,
      confirmLabel: 'Create promo',
      tone: 'primary',
      consequence: this.form.maxRedemptions
        ? `Capped at ${this.form.maxRedemptions} total redemptions — the platform absorbs the discount out of margin.`
        : 'No global cap set. Every redemption comes out of platform margin with nothing to stop it.'
    });
    this.pending = () => this.create();
  }

  askDeactivate(p: Promo) {
    this.confirm.set({
      title: `Retire ${p.code}`,
      message: `The code stops working immediately. ${p.currentRedemptions} redemption${p.currentRedemptions === 1 ? '' : 's'} already granted are unaffected.`,
      confirmLabel: 'Retire promo',
      tone: 'danger'
    });
    this.pending = () => this.deactivate(p);
  }

  runConfirmed(_result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(_result);
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
    this.createError.set(null);
    this.service.create(body).subscribe({
      next: () => {
        this.form.code = '';
        this.form.description = '';
        this.reload();
      },
      error: e => this.createError.set(describeError(e, 'the promo'))
    });
  }

  deactivate(p: Promo) {
    this.service.deactivate(p.id).subscribe({
      next: () => this.reload(),
      error: e => this.error.set(describeError(e, 'the retirement'))
    });
  }
}
