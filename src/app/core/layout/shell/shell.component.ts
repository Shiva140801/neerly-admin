import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../auth/auth.service';
import { TokenStore } from '../../auth/token.store';
import { AttentionService, QueueKey } from '../../../shared/attention.service';
import { ClockService } from '../../../shared/ui/clock.service';
import { ToastHostComponent } from '../../../shared/ui/toast-host.component';
import { Severity } from '../../../shared/ui/urgency';

interface NavItem {
  path: string;
  label: string;
  /** Which shared queue count this item carries, if any. */
  queue?: QueueKey;
  /**
   * What the badge shows: the count, `·` while the queue is still loading, `!`
   * when it could not be fetched, or null when the queue is loaded and clear.
   * A loading queue must never render `0` — that reads as "nothing waiting".
   */
  badge?: string | null;
  severity?: Severity;
  pending?: boolean;
  /** Spelled-out meaning of the badge, for the title attribute and screen readers. */
  countLabel?: string;
}

interface NavGroup { heading: string; items: NavItem[] }

/**
 * Sidebar + workspace.
 *
 * The nav is grouped by *what the admin is doing*, not by backend module, and
 * the queues that can hurt someone carry a live count so triage starts before
 * the first click. Counts come from `AttentionService.queues()` — the same
 * array the overview rows are built from — so a badge and a row can never
 * disagree about the same queue, and the badge's title says exactly what it
 * counts rather than leaving a bare number next to a nav name.
 *
 * The sidebar is a drawer under 900px. Persona J's listed tools include mobile
 * access, and a fixed 236px rail eats 63% of a 375px screen: the same nav, the
 * same counts, reachable from a button in a top bar instead.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterOutlet, RouterLinkActive, ToastHostComponent],
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
    .badge.pending { color: var(--ink-400); }

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

    /* --- Mobile: the rail becomes a drawer ------------------------------- */

    .topbar { display: none; }

    @media (max-width: 900px) {
      :host { grid-template-columns: 1fr; }

      .topbar {
        display: flex; align-items: center; gap: 12px;
        position: sticky; top: 0; z-index: 40;
        padding: 10px 14px;
        background: var(--paper); border-bottom: 1px solid var(--ink-200);
      }
      .topbar .brand { margin: 0; padding: 0; font-size: 19px; }
      .menu-btn {
        flex: none; display: inline-flex; align-items: center; gap: 7px;
        padding: 7px 12px; border-radius: var(--r-pill);
        border: 1px solid var(--ink-200); background: var(--paper);
        font: inherit; font-size: 13px; font-weight: 650; color: var(--ink-700); cursor: pointer;
      }
      .menu-btn .tally {
        font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums;
        padding: 1px 6px; border-radius: var(--r-pill);
        background: var(--err-soft); color: var(--err-ink);
      }

      aside {
        position: fixed; top: 0; left: 0; bottom: 0; z-index: 60;
        width: min(280px, 84vw);
        transform: translateX(-100%);
        transition: transform .18s ease;
        box-shadow: var(--shadow-3);
      }
      :host(.nav-open) aside { transform: none; }

      .scrim {
        position: fixed; inset: 0; z-index: 50;
        background: color-mix(in srgb, var(--ink-900) 38%, transparent);
        border: 0; padding: 0;
      }

      main { padding: 20px 16px 48px; }
    }

    @media (max-width: 900px) and (prefers-reduced-motion: reduce) {
      aside { transition: none; }
    }
  `],
  host: { '[class.nav-open]': 'navOpen()' },
  template: `
    <div class="topbar">
      <button type="button" class="menu-btn" (click)="navOpen.set(true)"
              [attr.aria-expanded]="navOpen()" aria-controls="admin-nav">
        <span aria-hidden="true">☰</span> Menu
        @if (totalBacklog() > 0) {
          <span class="tally" [attr.aria-label]="totalBacklog() + ' items across your queues'">{{ totalBacklog() }}</span>
        }
      </button>
      <div class="brand">neerly · <em>admin</em></div>
    </div>

    @if (navOpen()) {
      <button type="button" class="scrim" aria-label="Close navigation" (click)="navOpen.set(false)"></button>
    }

    <aside id="admin-nav">
      <div class="brand">neerly · <em>admin</em></div>
      <div class="brand-sub">Hyderabad ops</div>

      <nav>
        @for (group of groups(); track group.heading) {
          <div class="group">
            <div class="group-heading">{{ group.heading }}</div>
            @for (item of group.items; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" (click)="navOpen.set(false)">
                <span class="name">{{ item.label }}</span>
                @if (item.badge) {
                  <span class="badge"
                        [class.crit]="!item.pending && item.severity === 'crit'"
                        [class.warn]="!item.pending && item.severity === 'warn'"
                        [class.pending]="item.pending"
                        [title]="item.countLabel">{{ item.badge }}</span>
                }
              </a>
            }
          </div>
        }
      </nav>

      <div class="foot">
        <div class="who">
          <div class="name">{{ who() }}</div>
          @if (userId(); as uid) {
            <a class="role self" [routerLink]="['/audit']" [queryParams]="{ actorId: uid }">
              {{ roleLabel() }} · review my own actions →
            </a>
          } @else {
            <div class="role">{{ roleLabel() }}</div>
          }
        </div>
        <button type="button" (click)="signOut()">Sign out</button>
      </div>
    </aside>

    <main><router-outlet/></main>

    <app-toast-host />
  `
})
export class ShellComponent {
  private auth = inject(AuthService);
  private tokens = inject(TokenStore);
  private router = inject(Router);
  private attention = inject(AttentionService);
  private clock = inject(ClockService);

  /** Drawer state. Desktop ignores it — the rail is always in the grid there. */
  readonly navOpen = signal(false);

  constructor() {
    // One fetch on entry feeds both the badges and whichever screen loads next.
    this.attention.refresh();
    // A route change from anywhere (a deep link inside a screen, a redirect)
    // closes the drawer, so the nav never sits open over the page it opened.
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntilDestroyed()
    ).subscribe(() => this.navOpen.set(false));
  }

  readonly userId = computed(() => this.tokens.identity().userId);

  /**
   * Who is signed in. The login response's `displayName` when we have it — the
   * role alone answers "what may this session do", never "who is accountable
   * for the next decision", and the audit log records the person.
   */
  readonly who = computed(() => this.tokens.displayName() ?? 'Signed-in admin');

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

  /** Everything waiting across every queue — the drawer button's badge. */
  readonly totalBacklog = computed(() =>
    this.attention.queues(this.clock.now())
      .filter(q => !q.error && !q.loading)
      .reduce((sum, q) => sum + q.count, 0));

  readonly groups = computed<NavGroup[]>(() => {
    const byKey = new Map(this.attention.queues(this.clock.now()).map(q => [q.key, q]));

    const withCount = (path: string, label: string, key: QueueKey): NavItem => {
      const q = byKey.get(key)!;
      return {
        path, label, queue: key,
        badge: q.loading ? '·' : q.error ? '!' : q.count > 0 ? String(q.count) : null,
        pending: q.loading,
        severity: q.error ? 'crit' : q.severity,
        countLabel: q.loading
          ? `${q.label} — still counting`
          : q.error
            ? `${q.label} — could not be counted: ${q.error}`
            : `${q.count} · ${q.label.toLowerCase()}`
      };
    };

    return [
      {
        heading: 'Triage',
        items: [
          { path: '/dashboard', label: 'Overview' },
          withCount('/disputes', 'Disputes', 'disputes'),
          withCount('/orders', 'Orders', 'orders')
        ]
      },
      {
        heading: 'Supply',
        items: [
          withCount('/vendors', 'Vendors', 'vendors'),
          withCount('/compliance', 'Compliance', 'compliance'),
          { path: '/reviews', label: 'Reviews' }
        ]
      },
      {
        heading: 'Money',
        items: [
          withCount('/refunds', 'Refunds', 'refunds'),
          withCount('/claims', 'Damage claims', 'claims'),
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
