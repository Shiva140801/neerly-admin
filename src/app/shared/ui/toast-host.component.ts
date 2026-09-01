import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

/**
 * Renders the toast stack. Mounted once, in the shell.
 *
 * Bottom-right rather than top-centre: the admin's eye is already at the row or
 * button they just clicked, and a banner over the masthead would cover the page
 * title on the screens that navigate after an action.
 */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      position: fixed; right: 22px; bottom: 22px; z-index: 80;
      pointer-events: none;
    }
    .stack {
      display: flex; flex-direction: column-reverse; gap: 8px; align-items: flex-end;
    }
    .toast {
      pointer-events: auto;
      display: flex; align-items: flex-start; gap: 10px;
      min-width: 260px; max-width: 380px;
      padding: 12px 14px;
      border-radius: var(--r-md);
      background: var(--paper);
      border: 1px solid var(--ink-200);
      border-left: 3px solid var(--ink-300);
      box-shadow: var(--shadow-3);
      animation: rise .16s ease-out;
    }
    .toast.ok   { border-left-color: var(--ok); }
    .toast.info { border-left-color: var(--admn); }
    .toast.warn { border-left-color: var(--warn); }

    @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    .mark {
      flex: none; width: 20px; height: 20px; border-radius: var(--r-pill);
      display: grid; place-items: center; font-size: 11px; font-weight: 800; margin-top: 1px;
    }
    .toast.ok   .mark { background: var(--ok-soft);   color: var(--ok-ink); }
    .toast.info .mark { background: var(--admn-soft); color: var(--admn-dark); }
    .toast.warn .mark { background: var(--warn-soft); color: var(--warn-ink); }

    .body { min-width: 0; }
    .text { display: block; font-size: 13px; font-weight: 650; color: var(--ink-900); line-height: 1.4; }
    .detail { display: block; font-size: 12px; color: var(--ink-600); margin-top: 3px; line-height: 1.45; }

    .close {
      margin-left: auto; flex: none; border: 0; background: none; cursor: pointer;
      color: var(--ink-400); font: inherit; font-size: 15px; line-height: 1; padding: 0 2px;
    }
    .close:hover { color: var(--ink-700); }

    @media (max-width: 720px) {
      :host { right: 12px; left: 12px; bottom: 12px; }
      .toast { max-width: none; }
    }
  `],
  template: `
    <div class="stack" role="status" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class.ok]="t.tone === 'ok'" [class.info]="t.tone === 'info'"
             [class.warn]="t.tone === 'warn'">
          <span class="mark" aria-hidden="true">{{ t.tone === 'warn' ? '!' : '✓' }}</span>
          <span class="body">
            <span class="text">{{ t.text }}</span>
            @if (t.detail) { <span class="detail">{{ t.detail }}</span> }
          </span>
          <button type="button" class="close" aria-label="Dismiss" (click)="toasts.dismiss(t.id)">×</button>
        </div>
      }
    </div>
  `
})
export class ToastHostComponent {
  readonly toasts = inject(ToastService);
}
