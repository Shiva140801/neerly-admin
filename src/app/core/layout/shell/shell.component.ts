import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { TokenStore } from '../../auth/token.store';
import { AttentionService } from '../../../shared/attention.service';
import { ClockService } from '../../../shared/ui/clock.service';
import { Severity } from '../../../shared/ui/urgency';

interface NavItem {
  path: string;
  label: string;
  /** Live backlog count; undefined when the item has no queue behind it. */
  count?: number;
  severity?: Severity;
}

interface NavGroup { heading: string; items: NavItem[] }

/**
 * Sidebar + workspace.
 *
 * The nav is grouped by *what the admin is doing*, not by backend module, and
 * the queues that can hurt someone carry a live count so triage starts before
 * the first click. Counts come from the same AttentionService the overview
 * reads, so the sidebar and the dashboard can never disagree.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterOutlet, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; grid-template-columns: 236px 1fr; min-height: 100vh; background: var(--canvas); }

    aside {
      background: var(--paper); border-right: 1px solid var(--ink-200);
      padding: 22px 14px 16px; display: flex; flex-direction: column;
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
    }
    .brand {
      font-family: var(--font-serif); font-size: 23px; letter-spacing: -0.015em;
      color: var(--ink-900); padding: 0 10px; margin-bottom: 4px;
    }
    .brand em { color: var(--admn); font-style: italic; }
    .brand-sub {
      padding: 0 10px; margin-bottom: 22px;
      font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
      color: var(--ink-400); font-weight: 700;
    }

    .group { margin-bottom: 16px; }
    .group-heading {
      font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
      color: var(--ink-400); font-weight: 700; padding: 0 10px; margin-bottom: 5px;
    }

    nav a {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: var(--r-sm);
      text-decoration: none; color: var(--ink-700);
      font-weight: 550; font-size: 13.5px; margin-bottom: 1px;
      transition: background-color .12s ease, color .12s ease;
    }
    nav a:hover { background: var(--ink-50); color: var(--ink-900); }
    nav a.active { background: var(--admn-softer); color: var(--admn-dark); font-weight: 700; }
    nav a .name { flex: 1; }

    .badge {
      font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums;
      min-width: 19px; text-align: center;
      padding: 1px 6px; border-radius: var(--r-pill);
      background: var(--ink-100); color: var(--ink-600);
    }
    .badge.crit { background: var(--err-soft); color: var(--err-ink); }
    .badge.warn { background: var(--warn-soft); color: var(--warn-ink); }

    .foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--ink-200); }
    .who { padding: 0 10px 10px; }
    .who .name { font-size: 13px; font-weight: 650; color: var(--ink-800); }
    .who .role { font-size: 11px; color: var(--ink-500); margin-top: 2px; display: block; text-decoration: none; }
    .who .role.self:hover { color: var(--admn); text-decoration: underline; }
    .foot button {
      display: block; width: 100%; text-align: left; padding: 8px 10px;
      border: 0; border-radius: var(--r-sm); background: none; cursor: pointer;
      color: var(--ink-600); font: inherit; font-weight: 600; font-size: 13px;
    }
    .foot button:hover { background: var(--err-soft); color: var(--err-ink); }

    main { padding: 30px 36px 56px; overflow: auto; min-width: 0; }
  `],
  template: `
    <aside>
      <div class="brand">neerly · <em>admin</em></div>
      <div class="brand-sub">Hyderabad ops</div>

      <nav>
        @for (group of groups(); track group.heading) {
          <div class="group">
            <div class="group-heading">{{ group.heading }}</div>
            @for (item of group.items; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active">
                <span class="name">{{ item.label }}</span>
                @if (item.count) {
                  <span class="badge"
                        [class.crit]="item.severity === 'crit'"
                        [class.warn]="item.severity === 'warn'">{{ item.count }}</span>
                }
              </a>
            }
          </div>
        }
      </nav>

      <div class="foot">
        <div class="who">
          <div class="name">{{ roleLabel() }}</div>
          @if (userId(); as uid) {
            <a class="role self" [routerLink]="['/audit']" [queryParams]="{ actorId: uid }">
              Review my own actions →
            </a>
          } @else {
            <div class="role">Hyderabad ops</div>
          }
        </div>
        <button type="button" (click)="signOut()">Sign out</button>
      </div>
    </aside>

    <main><router-outlet/></main>
  `
})
export class ShellComponent {
  private auth = inject(AuthService);
  private tokens = inject(TokenStore);
  private router = inject(Router);
  private attention = inject(AttentionService);
  private clock = inject(ClockService);

  constructor() {
    // One fetch on entry feeds both the badges and whichever screen loads next.
    this.attention.refresh();
  }

  readonly userId = computed(() => this.tokens.identity().userId);

  /**
   * The token's role decides what the admin can reach — L2 gates surge, promos,
   * price bands, payouts and the audit log — so it belongs on screen rather
   * than being discovered through a 403.
   */
  readonly roleLabel = computed(() => {
    const role = this.tokens.identity().role;
    if (!role) return 'Platform admin';
    return role.replace(/^ADMIN_/, 'Admin ').replace('_', ' ');
  });

  readonly groups = computed<NavGroup[]>(() => {
    const now = this.clock.now();
    const a = this.attention;

    const breached = a.breachedComplaints(now).length;
    const openDisputes = a.complaints().data.filter(
      c => c.status === 'OPEN' || c.status === 'TRIAGED' || c.status === 'IN_PROGRESS'
    ).length;
    const pendingVendors = a.pendingVendors().data.length;
    const stuck = a.stuckOrders(now).length + a.failedOrders().length;
    const expiring = a.fssaiWatch(now, 30).length + a.expiringDocs().data.length;
    const refunds = a.refundsAwaiting().length;
    const claims = a.claimsAwaiting().length;

    return [
      {
        heading: 'Triage',
        items: [
          { path: '/dashboard', label: 'Overview' },
          {
            path: '/disputes', label: 'Disputes',
            count: openDisputes,
            severity: breached > 0 ? 'crit' : openDisputes > 0 ? 'warn' : 'ok'
          },
          {
            path: '/orders', label: 'Orders',
            count: stuck, severity: stuck > 0 ? 'crit' : 'ok'
          }
        ]
      },
      {
        heading: 'Supply',
        items: [
          {
            path: '/vendors', label: 'Vendors',
            count: pendingVendors, severity: pendingVendors > 0 ? 'warn' : 'ok'
          },
          {
            path: '/compliance', label: 'Compliance',
            count: expiring, severity: expiring > 0 ? 'warn' : 'ok'
          },
          { path: '/reviews', label: 'Reviews' }
        ]
      },
      {
        heading: 'Money',
        items: [
          { path: '/refunds', label: 'Refunds', count: refunds, severity: refunds > 0 ? 'warn' : 'ok' },
          { path: '/claims', label: 'Damage claims', count: claims, severity: claims > 0 ? 'warn' : 'ok' },
          { path: '/payouts', label: 'Payouts' }
        ]
      },
      {
        heading: 'Levers',
        items: [
          { path: '/pricing', label: 'Price bands' },
          { path: '/promos', label: 'Promos' },
          { path: '/surge', label: 'Surge' }
        ]
      },
      {
        heading: 'Records',
        items: [
          { path: '/analytics', label: 'Analytics' },
          { path: '/notifications', label: 'Notifications' },
          { path: '/audit', label: 'Audit log' }
        ]
      }
    ];
  });

  signOut() {
    // Best-effort server-side revoke; local session ends regardless of outcome.
    const finish = () => {
      this.tokens.clear();
      this.router.navigate(['/login']);
    };
    this.auth.logout().subscribe({ next: finish, error: finish });
  }
}
