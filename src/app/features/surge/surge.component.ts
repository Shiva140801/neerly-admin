import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SurgeService } from './surge.service';
import type { CreateSurgeRequest, SurgeTrigger, TriggerSource } from './surge.model';
import { describeActionError, describeError } from '../../shared/api-error';
import { PRODUCT_CATEGORY_CODES, label as enumLabel } from '../../shared/labels';
import { AttentionService } from '../../shared/attention.service';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { formatDuration, msSince, msUntil } from '../../shared/ui/urgency';

interface SurgeRow {
  trigger: SurgeTrigger;
  live: boolean;
  /** "running 3h" while live, "ended 2d ago" once it is not. */
  window: string;
}

/**
 * Surge control.
 *
 * Surge is the most customer-visible lever in the product and the policy caps
 * it at 1.50× (PRD §11) — so the screen puts what is *live right now* above the
 * history, since the only urgent question is "is a customer being charged extra
 * this second, and do I still stand behind why". Cancelling is one click from
 * that top band.
 */
@Component({
  selector: 'app-surge',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .cap {
      font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
      background: var(--warn-soft); color: var(--warn-ink);
      padding: 4px 10px; border-radius: var(--r-pill);
    }

    .live-band {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      padding: 14px 18px; border-radius: var(--r-md); margin-bottom: 18px;
      font-size: 13.5px; font-weight: 600;
    }
    .live-band.on  { background: var(--warn-soft); color: var(--warn-ink); }
    .live-band.off { background: var(--ok-soft);   color: var(--ok-ink); }
    .live-band .mult { font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; }

    .create { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: 10px; align-items: end; padding: 18px; }
    @media (max-width: 1080px) { .create { grid-template-columns: repeat(2, 1fr); } }

    .mult-cell { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ink-900); }
    .mult-cell.hot { color: var(--warn); }
  `],
  template: `
    <app-page-header
      title="Surge" accent="control"
      subtitle="Policy caps surge at 1.50×. Every multiplier here is money a real customer paid on top — the reason field is what you will be quoted back.">
      <span class="cap">Cap 1.50×</span>
    </app-page-header>

    @if (!loading() && !error() && filterCity.trim()) {
      <div class="live-band" [class.on]="liveRows().length > 0" [class.off]="liveRows().length === 0">
        @if (liveRows().length > 0) {
          <span class="mult">{{ topMultiplier() | number:'1.2-2' }}×</span>
          <span>
            {{ liveRows().length }} surge trigger{{ liveRows().length === 1 ? '' : 's' }} live in {{ filterCity }} right now.
            Customers ordering in the affected scope are paying the surcharge.
          </span>
        } @else {
          <span>No surge is active in {{ filterCity }}. Customers are paying list price.</span>
        }
      </div>
    }

    <div class="panel">
      <div class="panel-head"><h2>Trigger a new surge</h2></div>
      <div class="create">
        <div>
          <label class="field-label" for="sg-city">City</label>
          <input id="sg-city" class="input" [(ngModel)]="form.city" />
        </div>
        <div>
          <label class="field-label" for="sg-pin">Pincode (optional)</label>
          <input id="sg-pin" class="input mono" [(ngModel)]="form.pincode" maxlength="6" placeholder="all" />
        </div>
        <div>
          <label class="field-label" for="sg-cat">Category</label>
          <select id="sg-cat" class="input" [(ngModel)]="form.categoryCode">
            <option value="">Every category</option>
            @for (c of categories; track c) { <option [value]="c">{{ label(c) }}</option> }
          </select>
        </div>
        <div>
          <label class="field-label" for="sg-mult">Multiplier</label>
          <input id="sg-mult" class="input num" type="number" min="1" max="1.5" step="0.05" [(ngModel)]="form.multiplier" />
        </div>
        <div>
          <label class="field-label" for="sg-reason">Reason</label>
          <input id="sg-reason" class="input" [(ngModel)]="form.reason" placeholder="Heat wave, tanker shortage…" />
        </div>
        <button type="button" class="btn btn--primary" (click)="askCreate()" [disabled]="!formValid()">Trigger</button>
      </div>
      @if (createError(); as e) {
        <div class="panel-body" style="padding-top:0;color:var(--err-ink);font-weight:600;font-size:12.5px;">{{ e }}</div>
      }
    </div>

    <div class="row-flex gap-12 mt-24" style="align-items:flex-end;">
      <div>
        <label class="field-label" for="sg-filter">History for city</label>
        <input id="sg-filter" class="input" style="width:220px;" [(ngModel)]="filterCity" (change)="reload()" />
      </div>
    </div>

    <div class="panel mt-12">
      <div class="panel-head">
        <h2>Surge history</h2>
        <span class="text-label">{{ loading() ? 'still counting…' : rows().length + ' triggers' }}</span>
      </div>

      @if (loading() || error() || rows().length === 0) {
        <app-data-state
          what="surge history"
          [loading]="loading()" [error]="error()"
          [emptyTitle]="filterCity.trim() ? 'No surge has ever run here' : 'Name a city first'"
          [emptyDetail]="filterCity.trim()
            ? 'Nothing has been triggered for ' + filterCity + '. That is the healthy default — surge is an exception, not a pricing strategy.'
            : 'Surge history is scoped to one city at a time. Type a city name above to see what has run there.'"
          [clear]="true" [compact]="true"
          (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Multiplier</th><th>Scope</th><th>Why</th>
                <th>Window</th><th>Source</th><th>Status</th><th class="right"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.trigger.id) {
                <tr [class.sev-warn]="r.live">
                  <td>
                    <span class="mult-cell" [class.hot]="r.live">{{ r.trigger.multiplier | number:'1.2-2' }}×</span>
                  </td>
                  <td>
                    <div class="primary-cell">{{ r.trigger.city }}</div>
                    <div class="sub-cell">
                      {{ r.trigger.pincode ? r.trigger.pincode : 'all pincodes' }} ·
                      {{ r.trigger.categoryCode ? label(r.trigger.categoryCode) : 'all categories' }}
                    </div>
                  </td>
                  <td class="muted" style="max-width:30ch;font-size:12.5px;">{{ r.trigger.reason ?? '—' }}</td>
                  <td>
                    <div>{{ r.trigger.activeFrom | when }}</div>
                    <div class="sub-cell">{{ r.window }}</div>
                  </td>
                  <td><span class="pill pill--outline">{{ label(r.trigger.source) }}</span></td>
                  <td>
                    <span class="pill" [class.pill--warn]="r.live" [class.pill--mute]="!r.live">
                      {{ r.live ? 'Live' : (r.trigger.cancelledAt ? 'Cancelled' : 'Ended') }}
                    </span>
                  </td>
                  <td class="right">
                    @if (!r.trigger.cancelledAt) {
                      <button type="button" class="btn btn--danger btn--sm" (click)="askCancel(r.trigger)">Cancel</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (actionError(); as e) {
      <div class="lede crit mt-16" role="alert">
        {{ e }}
        <button type="button" class="btn btn--ghost btn--sm" style="margin-left:10px;"
                (click)="actionError.set(null)">Dismiss</button>
      </div>
    }

    <app-confirm-dialog [request]="confirm()" (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class SurgeComponent {
  private service = inject(SurgeService);
  private clock = inject(ClockService);
  private toasts = inject(ToastService);
  private attention = inject(AttentionService);

  categories = PRODUCT_CATEGORY_CODES;

  loading = signal(true);
  /** A failed *load*: the history is empty. */
  error = signal<string | null>(null);
  createError = signal<string | null>(null);
  /** A failed *action*: the history is fine, the cancellation is not. */
  actionError = signal<string | null>(null);
  items = signal<SurgeTrigger[]>([]);
  filterCity = 'Hyderabad';

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  form: CreateSurgeRequest & { source: TriggerSource } = {
    city: 'Hyderabad',
    pincode: '',
    categoryCode: '',
    multiplier: 1.25,
    source: 'MANUAL_ADMIN',
    reason: ''
  };

  constructor() { this.reload(); }

  label(v: string) { return enumLabel(v); }

  formValid(): boolean {
    return !!this.form.city.trim() && this.form.multiplier >= 1 && this.form.multiplier <= 1.5;
  }

  readonly rows = computed<SurgeRow[]>(() => {
    const now = this.clock.now();
    return [...this.items()]
      .map(trigger => {
        const started = (msUntil(trigger.activeFrom, now) ?? 0) <= 0;
        const ended = trigger.activeUntil !== null && (msUntil(trigger.activeUntil, now) ?? 1) <= 0;
        const live = !trigger.cancelledAt && started && !ended;
        let window: string;
        if (live) {
          const runningMs = msSince(trigger.activeFrom, now) ?? 0;
          window = trigger.activeUntil
            ? `running ${formatDuration(runningMs)}, ends ${new Date(trigger.activeUntil).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
            : `running ${formatDuration(runningMs)}, open-ended`;
        } else if (trigger.cancelledAt) {
          window = `cancelled ${formatDuration(msSince(trigger.cancelledAt, now) ?? 0)} ago`;
        } else if (!started) {
          window = `starts in ${formatDuration(msUntil(trigger.activeFrom, now) ?? 0)}`;
        } else {
          window = `ended ${formatDuration(msSince(trigger.activeUntil, now) ?? 0)} ago`;
        }
        return { trigger, live, window };
      })
      // Live first, then most recent.
      .sort((a, b) => Number(b.live) - Number(a.live) ||
        Date.parse(b.trigger.activeFrom) - Date.parse(a.trigger.activeFrom));
  });

  readonly liveRows = computed(() => this.rows().filter(r => r.live));
  readonly topMultiplier = computed(() => {
    const live = this.liveRows();
    return live.length ? Math.max(...live.map(r => Number(r.trigger.multiplier))) : 1;
  });

  reload() {
    // The endpoint requires `city` and now answers a blank one with a 400. Catching
    // it here keeps an empty box looking like an empty box rather than a failure.
    const city = this.filterCity.trim();
    if (!city) {
      this.items.set([]);
      this.error.set(null);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.service.list(city).subscribe({
      next: rows => { this.items.set(rows ?? []); this.loading.set(false); this.clock.sync(); },
      error: e => { this.error.set(describeError(e, 'surge history')); this.items.set([]); this.loading.set(false); }
    });
  }

  askCreate() {
    if (!this.formValid()) return;
    const scope = [
      this.form.city,
      this.form.pincode ? this.form.pincode : 'all pincodes',
      this.form.categoryCode ? this.form.categoryCode : 'all categories'
    ].join(' · ');
    this.confirm.set({
      title: `Apply ${this.form.multiplier.toFixed(2)}× surge`,
      message: `${scope}. Takes effect immediately and stays until you cancel it.`,
      confirmLabel: 'Trigger surge',
      tone: 'danger',
      consequence: 'Every customer ordering inside this scope pays the surcharge, and the reason you gave is what you will be answering for.'
    });
    this.pending = () => this.create();
  }

  askCancel(s: SurgeTrigger) {
    this.confirm.set({
      title: 'Cancel surge',
      message: `${Number(s.multiplier).toFixed(2)}× on ${s.city}${s.pincode ? ' · ' + s.pincode : ''} stops immediately.`,
      confirmLabel: 'Cancel surge',
      tone: 'primary'
    });
    this.pending = () => this.cancel(s);
  }

  runConfirmed(_result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(_result);
  }

  create() {
    const { city, pincode, categoryCode, multiplier, source, reason } = this.form;
    this.createError.set(null);
    this.service.create({
      city,
      pincode: pincode || undefined,
      categoryCode: categoryCode || undefined,
      multiplier,
      source,
      reason: reason || undefined
    }).subscribe({
      next: () => {
        this.toasts.success(
          `${multiplier.toFixed(2)}× surge is live in ${city}`,
          `Every order placed in ${pincode || 'any pincode'}${categoryCode ? ` for ${enumLabel(categoryCode)}` : ''} now carries the surcharge. Cancel it from the row below.`
        );
        this.reload();
        // The overview reads the trigger list to answer "is surge on".
        this.attention.refresh();
      },
      error: e => this.createError.set(describeActionError(e, 'triggering this surge'))
    });
  }

  cancel(s: SurgeTrigger) {
    this.actionError.set(null);
    this.service.cancel(s.id).subscribe({
      next: () => {
        this.toasts.success(
          `${Number(s.multiplier).toFixed(2)}× surge stopped in ${s.city}`,
          'Orders placed from now pay list price. Orders already placed keep the price they were quoted.'
        );
        this.reload();
        this.attention.refresh();
      },
      // A refused cancellation must not replace the history it was launched from.
      error: e => this.actionError.set(describeActionError(e, 'cancelling this surge'))
    });
  }
}
