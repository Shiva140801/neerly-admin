import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * The one masthead every screen uses: serif display title with the second word
 * set in italic accent (the Neerly logotype treatment), a one-line statement of
 * what this screen is *for*, and a slot for screen-level actions.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; margin-bottom: 22px; }
    .bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    h1 {
      font-family: var(--font-serif); font-weight: 400;
      font-size: 34px; line-height: 1.08; letter-spacing: -0.015em;
      color: var(--ink-900); margin: 0;
    }
    h1 em { color: var(--admn); font-style: italic; }
    .sub {
      color: var(--ink-600); font-size: 13.5px; margin-top: 6px; max-width: 68ch;
    }
    .actions { display: flex; align-items: center; gap: 8px; flex: none; padding-top: 6px; }
  `],
  template: `
    <div class="bar">
      <div>
        <h1>{{ title }} @if (accent) {<em>{{ accent }}</em>}</h1>
        @if (subtitle) { <div class="sub">{{ subtitle }}</div> }
      </div>
      <div class="actions"><ng-content /></div>
    </div>
  `
})
export class PageHeaderComponent {
  @Input({ required: true }) title = '';
  /** Rendered italic in the brand accent, following the "neerly · admin" logotype. */
  @Input() accent = '';
  @Input() subtitle = '';
}
