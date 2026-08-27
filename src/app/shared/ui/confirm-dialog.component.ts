import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ConfirmField {
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Pre-filled value. */
  initial?: string;
}

export interface ConfirmAmountField {
  label: string;
  max?: number;
  initial?: number;
}

export interface ConfirmRequest {
  title: string;
  /** One sentence naming the concrete thing being changed. */
  message: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'ok';
  /** Free-text capture — most Neerly mutations require a reason on the wire. */
  reason?: ConfirmField;
  amount?: ConfirmAmountField;
  /** Extra consequence text shown in a tinted strip. */
  consequence?: string;
}

export interface ConfirmResult {
  reason: string;
  amount: number | null;
}

/**
 * Confirmation gate for admin mutations (CLAUDE.md: "All admin mutations render
 * a confirmation dialog"). Replaces the `window.prompt()` calls the CRUD
 * screens were using — prompt() cannot show what is being changed, cannot
 * validate, cannot be styled, and is invisible to the audit-minded admin who
 * wants to re-read the reason before it is written to the append-only log.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: contents; }
    .scrim {
      position: fixed; inset: 0; z-index: 60;
      background: color-mix(in srgb, var(--ink-900) 42%, transparent);
      display: grid; place-items: center; padding: 24px;
    }
    .dialog {
      width: min(460px, 100%);
      background: var(--paper);
      border-radius: var(--r-lg);
      box-shadow: var(--shadow-3);
      overflow: hidden;
    }
    .head { padding: 20px 22px 0; }
    h2 {
      font-family: var(--font-serif); font-weight: 400; font-size: 23px;
      letter-spacing: -0.01em; color: var(--ink-900); margin: 0 0 6px;
    }
    .msg { font-size: 13.5px; color: var(--ink-600); line-height: 1.55; }
    .body { padding: 16px 22px 4px; }
    .consequence {
      margin: 14px 22px 0; padding: 10px 13px;
      background: var(--warn-soft); color: var(--warn-ink);
      border-radius: var(--r-sm); font-size: 12.5px; line-height: 1.5; font-weight: 600;
    }
    .foot {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 18px 22px 20px; margin-top: 8px;
    }
    .hint { font-size: 11.5px; color: var(--ink-500); margin-top: 5px; }
  `],
  template: `
    @if (request) {
      <div class="scrim" role="dialog" aria-modal="true" [attr.aria-label]="request.title"
           (click)="onScrim($event)">
        <div class="dialog">
          <div class="head">
            <h2>{{ request.title }}</h2>
            <div class="msg">{{ request.message }}</div>
          </div>

          @if (request.consequence) { <div class="consequence">{{ request.consequence }}</div> }

          @if (request.amount || request.reason) {
            <div class="body">
              @if (request.amount; as a) {
                <label class="field-label" for="cd-amount">{{ a.label }}</label>
                <input id="cd-amount" class="input num" type="number" min="0" step="0.01"
                       [max]="a.max ?? null" [(ngModel)]="amount" />
                @if (a.max !== undefined) { <div class="hint">Maximum ₹{{ a.max }}</div> }
              }
              @if (request.reason; as r) {
                <label class="field-label" [class.mt-12]="!!request.amount" for="cd-reason">{{ r.label }}</label>
                <textarea id="cd-reason" class="input" [placeholder]="r.placeholder ?? ''"
                          [(ngModel)]="reason"></textarea>
                @if (r.required) { <div class="hint">Required — written to the audit log.</div> }
              }
            </div>
          }

          <div class="foot">
            <button type="button" class="btn btn--ghost" (click)="cancelled.emit()">Cancel</button>
            <button type="button" class="btn"
                    [class.btn--primary]="tone() === 'primary'"
                    [class.btn--danger]="tone() === 'danger'"
                    [class.btn--ok]="tone() === 'ok'"
                    [disabled]="!valid() || busy"
                    (click)="submit()">
              {{ busy ? 'Working…' : request.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class ConfirmDialogComponent {
  private req = signal<ConfirmRequest | null>(null);

  @Input()
  set request(value: ConfirmRequest | null) {
    this.req.set(value);
    this.reason = value?.reason?.initial ?? '';
    this.amount = value?.amount?.initial ?? null;
  }
  get request(): ConfirmRequest | null { return this.req(); }

  /** Keeps the confirm button in a working state while the call is in flight. */
  @Input() busy = false;

  @Output() confirmed = new EventEmitter<ConfirmResult>();
  @Output() cancelled = new EventEmitter<void>();

  reason = '';
  amount: number | null = null;

  tone(): 'primary' | 'danger' | 'ok' { return this.req()?.tone ?? 'primary'; }

  valid(): boolean {
    const r = this.req();
    if (!r) return false;
    if (r.reason?.required && !this.reason.trim()) return false;
    if (r.amount && (this.amount === null || this.amount < 0)) return false;
    if (r.amount?.max !== undefined && (this.amount ?? 0) > r.amount.max) return false;
    return true;
  }

  submit() {
    if (!this.valid()) return;
    this.confirmed.emit({ reason: this.reason.trim(), amount: this.amount });
  }

  onScrim(event: MouseEvent) {
    if (event.target === event.currentTarget && !this.busy) this.cancelled.emit();
  }
}
