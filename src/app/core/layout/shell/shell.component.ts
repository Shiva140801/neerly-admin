import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterOutlet, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; background: var(--canvas); }
    aside { background: var(--paper); border-right: 1px solid var(--ink-200); padding: 24px 16px; }
    .brand { font-family: var(--font-serif); font-size: 24px; letter-spacing: -0.01em; margin-bottom: 32px;
             color: var(--ink-900); }
    .brand em { color: var(--admn); font-style: italic; }
    nav a { display: block; padding: 10px 12px; border-radius: var(--r-md); text-decoration: none;
            color: var(--ink-700); font-weight: 500; font-size: 14px; margin-bottom: 4px; }
    nav a:hover { background: var(--ink-50); }
    nav a.active { background: var(--admn-softer); color: var(--admn-dark); }
    main { padding: 32px 40px; overflow: auto; }
  `],
  template: `
    <aside>
      <div class="brand">neerly · <em>admin</em></div>
      <nav>
        <a routerLink="/dashboard" routerLinkActive="active">Overview</a>
        <a routerLink="/vendors" routerLinkActive="active">Vendors</a>
        <a routerLink="/compliance" routerLinkActive="active">Compliance</a>
        <a routerLink="/pricing" routerLinkActive="active">Price bands</a>
        <a routerLink="/promos" routerLinkActive="active">Promos</a>
        <a routerLink="/surge" routerLinkActive="active">Surge</a>
        <a routerLink="/disputes" routerLinkActive="active">Disputes</a>
        <a routerLink="/reviews" routerLinkActive="active">Reviews</a>
        <a routerLink="/claims" routerLinkActive="active">Damage claims</a>
        <a routerLink="/refunds" routerLinkActive="active">Refunds</a>
        <a routerLink="/orders" routerLinkActive="active">Orders</a>
        <a routerLink="/payouts" routerLinkActive="active">Payouts</a>
        <a routerLink="/notifications" routerLinkActive="active">Notifications</a>
        <a routerLink="/analytics" routerLinkActive="active">Analytics</a>
        <a routerLink="/audit" routerLinkActive="active">Audit log</a>
      </nav>
    </aside>
    <main><router-outlet/></main>
  `
})
export class ShellComponent {}
