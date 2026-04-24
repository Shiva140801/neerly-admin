import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Placeholder page — used by routes that exist in the sidebar but whose
 * feature component is still being built. Shows a polite "coming soon"
 * panel so navigation doesn't 404. Each route provides its own title
 * + paragraph via @Input.
 *
 * Replace with a real feature component as it lands.
 */
@Component({
  selector: 'app-placeholder-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .wrap { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
            box-shadow: var(--shadow-1); padding: 48px; max-width: 720px; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 12px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    p  { color: var(--ink-600); font-size: 14px; line-height: 1.55; margin: 0; }
    .badge { display: inline-block; background: var(--warn-soft); color: var(--warn);
             font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
             padding: 4px 10px; border-radius: var(--r-pill); margin-bottom: 16px; }
  `],
  template: `
    <div class="wrap">
      <span class="badge">In progress</span>
      <h1>{{ title }} · <em>coming soon</em></h1>
      <p>{{ subtitle }}</p>
      <p style="margin-top: 12px;">The backend endpoints for this screen are live — the Angular view is scheduled for the next slice.</p>
    </div>
  `
})
export class PlaceholderPageComponent {
  @Input() title = 'Feature';
  @Input() subtitle = 'This screen will land in the next slice.';
}
