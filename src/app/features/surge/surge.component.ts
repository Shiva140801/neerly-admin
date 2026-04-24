import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SurgeService } from './surge.service';
import type { CreateSurgeRequest, SurgeTrigger, TriggerSource } from './surge.model';

@Component({
  selector: 'app-surge',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .top { display: flex; gap: 16px; margin-bottom: 24px; align-items: end; }
    .top label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
                 color: var(--ink-500); margin-bottom: 4px; font-weight: 600; }
    .top input, .top select { padding: 8px 10px; border: 1px solid var(--ink-200); border-radius: var(--r-sm);
                              font-size: 14px; background: var(--paper); }
    .cap { background: var(--warn-soft); color: var(--warn); padding: 4px 10px; border-radius: var(--r-pill);
           font-size: 12px; font-weight: 600; }
    button.primary { padding: 10px 18px; background: var(--admn); color: var(--paper); border: none;
                     border-radius: var(--r-sm); font-weight: 600; cursor: pointer; font-size: 14px; }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    .mult { font-family: var(--font-mono); font-weight: 600; color: var(--admn); }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.active { background: var(--ok-soft); color: var(--ok); }
    .pill.cancelled { background: var(--ink-100); color: var(--ink-500); }
    button.cancel { padding: 6px 12px; border: 1px solid var(--err); color: var(--err); background: var(--paper);
                    border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 600; }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
    .new-form { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
                padding: 20px; margin-bottom: 24px; display: grid; grid-template-columns: repeat(5, 1fr) auto;
                gap: 12px; align-items: end; }
  `],
  template: `
    <h1>Surge <em>triggers</em> <span class="cap">Cap 1.50×</span></h1>

    <div class="new-form">
      <div>
        <label>City</label>
        <input [(ngModel)]="form.city" />
      </div>
      <div>
        <label>Pincode (opt)</label>
        <input [(ngModel)]="form.pincode" maxlength="6" />
      </div>
      <div>
        <label>Category (opt)</label>
        <input [(ngModel)]="form.categoryCode" />
      </div>
      <div>
        <label>Multiplier</label>
        <input type="number" min="1" max="1.5" step="0.05" [(ngModel)]="form.multiplier" />
      </div>
      <div>
        <label>Reason</label>
        <input [(ngModel)]="form.reason" />
      </div>
      <button class="primary" (click)="create()">Trigger</button>
    </div>

    <div class="top">
      <div>
        <label>Show city</label>
        <input [(ngModel)]="filterCity" (change)="reload()" />
      </div>
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (items().length === 0) { <div class="empty">No surge history for {{ filterCity }}</div> }
    @else {
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Multiplier</th><th>Scope</th><th>Source</th><th>Reason</th>
              <th>Active from</th><th>Active until</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (s of items(); track s.id) {
              <tr>
                <td><span class="mult">{{ s.multiplier | number:'1.2-2' }}×</span></td>
                <td>{{ s.city }}<span style="color: var(--ink-500); font-size: 12px;">
                  @if (s.pincode) { · {{ s.pincode }} }
                  @if (s.categoryCode) { · {{ s.categoryCode }} }
                </span></td>
                <td>{{ s.source }}</td>
                <td style="color: var(--ink-500); font-size: 13px;">{{ s.reason ?? '—' }}</td>
                <td>{{ s.activeFrom | date:'MMM d, h:mm a' }}</td>
                <td>{{ s.activeUntil ? (s.activeUntil | date:'MMM d, h:mm a') : 'Open' }}</td>
                <td>
                  <span class="pill" [class.active]="!s.cancelledAt" [class.cancelled]="s.cancelledAt">
                    {{ s.cancelledAt ? 'CANCELLED' : 'ACTIVE' }}
                  </span>
                </td>
                <td>
                  @if (!s.cancelledAt) {
                    <button class="cancel" (click)="cancel(s)">Cancel</button>
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
export class SurgeComponent {
  private service = inject(SurgeService);

  loading = signal(true);
  items = signal<SurgeTrigger[]>([]);
  filterCity = 'Hyderabad';

  form: CreateSurgeRequest & { source: TriggerSource } = {
    city: 'Hyderabad',
    pincode: '',
    categoryCode: '',
    multiplier: 1.25,
    source: 'MANUAL_ADMIN',
    reason: ''
  };

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.service.list(this.filterCity).subscribe({
      next: rows => { this.items.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  create() {
    const { city, pincode, categoryCode, multiplier, source, reason } = this.form;
    this.service.create({
      city,
      pincode: pincode || undefined,
      categoryCode: categoryCode || undefined,
      multiplier,
      source,
      reason: reason || undefined
    }).subscribe(() => this.reload());
  }

  cancel(s: SurgeTrigger) {
    this.service.cancel(s.id).subscribe(() => this.reload());
  }
}
