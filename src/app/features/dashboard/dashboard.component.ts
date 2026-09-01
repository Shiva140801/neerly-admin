import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AttentionService, HOME_CITY, QueueKey } from '../../shared/attention.service';
import { ClockService } from '../../shared/ui/clock.service';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PENDING_FIGURE, formatRupees } from '../../shared/ui/format';
import { CountPipe, RupeesPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { Severity, formatDuration } from '../../shared/ui/urgency';

/** One row of the "needs you now" list. */
interface AttentionRow {
  key: QueueKey;
  count: number;
  /** Plural noun for the count, e.g. "disputes past SLA". */
  label: string;
  /** Why it matters / what happens if ignored. Empty when the queue is clear. */
  detail: string;
  severity: Severity;
  link: string;
  queryParams?: Record<string, string>;
  cta: string;
  loading: boolean;
  error: string | null;
}

/**
 * The morning triage cockpit.
 *
 * The old overview was four vanity KPI tiles. A solo founder with ~15 hrs/week
 * (PRD §5.3, Persona J) does not open this screen to admire GMV — they open it
 * to find out what breaks today if they close the laptop. So the page leads
 * with a ranked "needs you now" list: every row is a real queue, carries its
 * own count and consequence, and links straight into the screen that clears it.
 * The business numbers still ship, but underneath, as context rather than
 * headline.
 *
 * Every figure comes from an endpoint that exists. Nothing is derived from a
 * field the backend does not return.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent, WhenPipe, RupeesPipe, CountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }

    .layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 1fr); gap: 20px; align-items: start; }
    @media (max-width: 1180px) { .layout { grid-template-columns: 1fr; } }

    /* --- Attention list --- */
    .queue-row {
      display: grid; grid-template-columns: 58px 1fr auto;
      align-items: center; gap: 14px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--ink-100);
      text-decoration: none; color: inherit;
      transition: background-color .12s ease;
    }
    .queue-row:last-child { border-bottom: 0; }
    .queue-row:hover { background: var(--ink-50); }
    .queue-row.clear { opacity: .72; }

    /* On a phone the three-column row squeezes the sentence into a gutter.
       Count above, text full width, CTA on its own line. */
    @media (max-width: 620px) {
      .queue-row { grid-template-columns: auto 1fr; gap: 6px 12px; padding: 14px 16px; }
      .count { text-align: left; font-size: 22px; }
      .cta { grid-column: 1 / -1; }
    }

    .count {
      font-size: 26px; font-weight: 800; line-height: 1;
      font-variant-numeric: tabular-nums;
      text-align: right; color: var(--ink-300);
    }
    .count.crit { color: var(--err); }
    .count.warn { color: var(--warn); }
    .count.ok   { color: var(--ok); }

    .label { display: block; font-size: 14px; font-weight: 650; color: var(--ink-900); }
    .detail { display: block; font-size: 12.5px; color: var(--ink-500); margin-top: 3px; line-height: 1.45; }
    .detail.err { color: var(--err-ink); }
    .cta { font-size: 12.5px; font-weight: 650; color: var(--admn); white-space: nowrap; }
    .queue-row.clear .cta { color: var(--ink-400); }

    .skel { height: 10px; width: 120px; border-radius: var(--r-pill); background: var(--ink-100); }

    /* --- Headline banner --- */
    .verdict {
      display: flex; align-items: center; gap: 13px;
      padding: 15px 18px; border-radius: var(--r-md);
      margin-bottom: 18px; font-size: 14px; font-weight: 600; line-height: 1.45;
    }
    .verdict.crit { background: var(--err-soft);  color: var(--err-ink); }
    .verdict.warn { background: var(--warn-soft); color: var(--warn-ink); }
    .verdict.ok   { background: var(--ok-soft);   color: var(--ok-ink); }
    .verdict.pending { background: var(--ink-100); color: var(--ink-600); }
    .verdict .badge {
      flex: none; width: 30px; height: 30px; border-radius: var(--r-pill);
      display: grid; place-items: center; font-size: 15px; font-weight: 800;
      background: color-mix(in srgb, currentColor 16%, transparent);
    }

    /* --- Metric grid --- */
    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--ink-100); }
    .metric { background: var(--paper); padding: 14px 16px; }
    .metric .k { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-500); }
    .metric .v {
      font-size: 22px; font-weight: 750; color: var(--ink-900); margin-top: 5px;
      font-variant-numeric: tabular-nums; line-height: 1.1;
    }
    .metric .n { font-size: 11.5px; color: var(--ink-500); margin-top: 3px; }
    .metric.hero { grid-column: 1 / -1; background: var(--admn); }
    .metric.hero .k { color: color-mix(in srgb, #fff 78%, transparent); }
    .metric.hero .v { color: #fff; font-size: 30px; }
    .metric.hero .n { color: color-mix(in srgb, #fff 72%, transparent); }

    .note {
      padding: 12px 16px; font-size: 12.5px; color: var(--ink-600);
      border-top: 1px solid var(--ink-100); line-height: 1.5;
    }
    .note strong { color: var(--ink-800); }
    .note.err-note { color: var(--err-ink); }

    .stamp { font-size: 11.5px; color: var(--ink-500); }
  `],
  template: `
    <app-page-header
      title="Morning" accent="triage"
      subtitle="Everything on this page is a queue you can clear. Ranked by what breaks first if you close the laptop.">
      <span class="stamp">
        @if (attention.loadedAt(); as t) { Refreshed {{ t | when:'time' }} }
      </span>
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()"
              [disabled]="attention.anyLoading()">
        {{ attention.anyLoading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="verdict" [class.crit]="verdict().severity === 'crit'"
         [class.warn]="verdict().severity === 'warn'"
         [class.ok]="verdict().severity === 'ok' && !verdict().pending"
         [class.pending]="verdict().pending">
      <span class="badge">{{ verdict().pending ? '·' : (verdict().severity === 'ok' ? '✓' : '!') }}</span>
      <span>{{ verdict().text }}</span>
    </div>

    <div class="layout">
      <div class="panel">
        <div class="panel-head">
          <h2>Needs you now</h2>
          <span class="text-label">
            {{ stillCounting() ? pendingFigure : openItemCount() }} open
          </span>
        </div>
        @for (row of rows(); track row.key) {
          <a class="queue-row" [class.clear]="row.count === 0 && !row.error"
             [routerLink]="row.link" [queryParams]="row.queryParams">
            <span class="count" [class.crit]="row.severity === 'crit'"
                  [class.warn]="row.severity === 'warn'"
                  [class.ok]="row.severity === 'ok'">
              {{ row.loading ? '·' : (row.error ? '!' : row.count) }}
            </span>
            <span>
              <span class="label">{{ row.label }}</span>
              @if (row.loading) {
                <span class="detail"><span class="skel"></span></span>
              } @else if (row.error) {
                <span class="detail err">{{ row.error }}</span>
              } @else {
                <span class="detail">{{ row.detail }}</span>
              }
            </span>
            <span class="cta">{{ row.cta }} →</span>
          </a>
        }
      </div>

      <div class="stack gap-20">
        <div class="panel">
          <div class="panel-head"><h2>Hyderabad today</h2></div>

          @if (attention.summary().error; as err) {
            <div class="note err-note">{{ err }}</div>
          } @else {
          @if (summaryData(); as d) {
            <div class="metrics">
              <div class="metric hero">
                <div class="k">WAPC · north star</div>
                <div class="v">{{ d.wapc | count }}</div>
                <div class="n">Unique customers with a delivered order in the last 7 days</div>
              </div>
              <div class="metric">
                <div class="k">Orders · 24h</div>
                <div class="v">{{ d.ordersToday | count }}</div>
                <div class="n">{{ d.deliveredToday | count }} delivered{{ completionNote() }}</div>
              </div>
              <div class="metric">
                <div class="k">Gross revenue · 24h</div>
                <div class="v">{{ d.grossRevenueToday | rupees }}</div>
                <div class="n">Order value from placed through delivered, excluding cancelled</div>
              </div>
              <div class="metric">
                <div class="k">Live vendors</div>
                <div class="v">{{ d.activeVendors | count }}</div>
                <div class="n">{{ d.activeSubscriptions | count }} active subscriptions</div>
              </div>
              <div class="metric">
                <div class="k">Deposits held</div>
                <div class="v">{{ d.depositsHeld | rupees }}</div>
                <div class="n">{{ d.depositsForfeitedThisWeek | rupees }} forfeited this week</div>
              </div>
            </div>
          } @else {
            <!-- A tile of zeros while the fetch is in flight reads as a real
                 reading of zero. Show the shape, not fabricated figures. -->
            <div class="metrics" aria-busy="true">
              @for (k of pendingMetrics; track k) {
                <div class="metric">
                  <div class="k">{{ k }}</div>
                  <div class="v muted">{{ pendingFigure }}</div>
                  <div class="n">still reading…</div>
                </div>
              }
            </div>
          }
          }
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Watchlist</h2></div>
          <div class="note">
            @if (ratingWatch().length > 0) {
              <div class="mt-4">
                <strong>{{ ratingWatch().length }} live vendor{{ ratingWatch().length === 1 ? '' : 's' }}</strong>
                below the 3.5★ auto-review threshold —
                {{ ratingWatch()[0].businessName }} at {{ ratingWatch()[0].avgRating | number:'1.1-1' }}★.
                Under 3.0★ triggers automatic suspension.
              </div>
            } @else if (attention.activeVendors().loading) {
              <div>Checking vendor ratings…</div>
            } @else {
              <div>No live vendor is under the 3.5★ auto-review threshold.</div>
            }

            <div class="mt-12">
              @if (unrouted().length > 0) {
                <strong>{{ unrouted().length }} order{{ unrouted().length === 1 ? '' : 's' }}</strong>
                never reached a vendor — the routing broadcast found nobody to take them.
              } @else {
                Every order on file has a vendor attached.
              }
            </div>

            <div class="mt-12">
              @if (attention.surge().loading) {
                Checking whether surge is running…
              } @else if (attention.surge().error) {
                <span class="err-note">Could not read the surge state — {{ attention.surge().error }}</span>
              } @else if (liveSurge().length > 0) {
                <strong>Surge is live</strong> — {{ topLiveMultiplier() | number:'1.2-2' }}× running in {{ city }}
                across {{ liveSurge().length }} trigger{{ liveSurge().length === 1 ? '' : 's' }}.
                @if (surgedOrders() > 0) {
                  {{ surgedOrders() }} open order{{ surgedOrders() === 1 ? '' : 's' }} already
                  carr{{ surgedOrders() === 1 ? 'ies' : 'y' }} a surcharge.
                } @else {
                  No open order has been priced under it yet — the next one placed in scope will be.
                }
              } @else {
                No surge trigger is running in {{ city }}. Customers are paying list price.
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class DashboardComponent {
  readonly attention = inject(AttentionService);
  private clock = inject(ClockService);

  // The shell primes these queues on entry; re-fetch only if that read is stale.
  constructor() { this.attention.refreshIfStale(); }

  reload() { this.attention.refresh(); this.clock.sync(); }

  private now = computed(() => this.clock.now());

  readonly summaryData = computed(() => this.attention.summary().data);
  readonly ratingWatch = computed(() => this.attention.ratingWatch());
  readonly unrouted = computed(() =>
    this.attention.orders().data.filter(o => !o.vendorId && !['DELIVERED', 'CANCELLED', 'FAILED'].includes(o.status))
  );

  readonly city = HOME_CITY;
  readonly pendingFigure = PENDING_FIGURE;
  /** Tile captions shown while the city summary is still in flight. */
  readonly pendingMetrics = ['WAPC · north star', 'Orders · 24h', 'Gross revenue · 24h', 'Live vendors', 'Deposits held'];

  /**
   * Whether surge is on is a fact about *triggers*, not about orders.
   *
   * The watchlist used to read the highest `surgeMultiplier` across open orders
   * and, finding none, print "No surge multiplier is applied to any open order
   * right now" — literally true, and read as "surge is off" while a 1.25×
   * trigger was live with nothing yet placed under it. The trigger list is the
   * only thing that answers the question the sentence is asking.
   */
  readonly liveSurge = computed(() => this.attention.liveSurge(this.now()));

  readonly topLiveMultiplier = computed(() => {
    const live = this.liveSurge();
    return live.length ? Math.max(...live.map(t => Number(t.multiplier))) : 1;
  });

  /** Open orders already carrying a surcharge — the consequence, not the state. */
  readonly surgedOrders = computed(() =>
    this.attention.orders().data
      .filter(o => !['DELIVERED', 'CANCELLED', 'FAILED'].includes(o.status))
      .filter(o => Number(o.surgeMultiplier ?? 1) > 1).length);

  readonly completionNote = computed(() => {
    const d = this.attention.summary().data;
    if (!d || d.ordersToday === 0) return '';
    return ` · ${Math.round((d.deliveredToday / d.ordersToday) * 100)}% completion`;
  });

  /**
   * The overview rows.
   *
   * Count and severity come from `AttentionService.queues()`, which the sidebar
   * badges read too — the two surfaces cannot disagree about a queue because
   * neither owns the number. What lives here is only the copy: the label that
   * says what the number counts, and the consequence of leaving it.
   */
  readonly rows = computed<AttentionRow[]>(() => {
    const now = this.now();
    const a = this.attention;
    const queues = new Map(a.queues(now).map(q => [q.key, q]));

    const breached = a.breachedComplaints(now);
    const atRisk = a.atRiskComplaints(now);
    const stuck = a.stuckOrders(now);
    const failed = a.failedOrders();
    const longestWait = a.longestVendorWait(now);
    const fssai = a.fssaiWatch(now, 30);
    const docs = a.docsExpiring(now, 30);
    const refunds = a.refundsAwaiting();
    const claims = a.claimsAwaiting();
    const soonestFssai = fssai.length ? fssai[0].days : null;

    const copy: Record<QueueKey, { label: string; detail: string; link: string; cta: string; queryParams?: Record<string, string> }> = {
      disputes: {
        label: 'Disputes open',
        detail: breached.length
          ? `${breached.length} already past the resolution deadline, oldest breached ${this.oldestBreach(breached, now)}. Every hour past 24h is a refund you will end up paying anyway.`
          : atRisk.length
            ? `None breached — but ${atRisk.length} ${atRisk.length === 1 ? 'is' : 'are'} inside the last four hours.`
            : queues.get('disputes')!.count > 0
              ? 'All comfortably inside their 24-hour resolution deadline.'
              : 'Nothing is waiting on a decision. A new complaint lands here with its clock already running.',
        link: '/disputes',
        cta: 'Work the queue'
      },
      orders: {
        label: 'Orders needing a rescue',
        detail: (stuck.length + failed.length)
          ? `${stuck.length} past the promised delivery window${failed.length ? `, ${failed.length} failed outright` : ''}. Reroute or cancel before the customer files.`
          : 'Every open order has a vendor attached and is inside the window the customer was promised.',
        link: '/orders',
        queryParams: { view: 'attention' },
        cta: 'Reroute / cancel'
      },
      vendors: {
        label: 'Vendors waiting on verification',
        detail: longestWait !== null
          ? `Longest wait ${formatDuration(longestWait)}. Supply you have already won but cannot sell through.`
          : 'Nobody is waiting on a verification decision.',
        link: '/vendors',
        cta: 'Review'
      },
      compliance: {
        label: 'Licences and documents lapsing in 30 days',
        detail: fssai.length
          ? `Soonest: ${fssai[0].vendor.businessName}, ${soonestFssai !== null && soonestFssai < 0 ? `expired ${Math.abs(soonestFssai)}d ago` : `${soonestFssai}d left`}. Expiry day auto-blocks them from selling.`
          : docs.length
            ? `No vendor licence lapses inside 30 days, but ${docs.length} uploaded document${docs.length === 1 ? '' : 's'} ${docs.length === 1 ? 'is' : 'are'} near expiry — ${docs[0].vendorName ?? 'an unattributed vendor'} first.`
            : 'No licence and no uploaded document lapses in the next 30 days.',
        link: '/compliance',
        cta: 'Chase renewal'
      },
      refunds: {
        label: 'Refunds awaiting approval',
        detail: refunds.length
          ? `${formatRupees(Math.round(this.attention.refundExposure()))} held up. Manual-review refunds carry a 24-hour SLA.`
          : 'No refund request is waiting on your decision.',
        link: '/refunds',
        cta: 'Decide'
      },
      claims: {
        label: 'Damage claims to arbitrate',
        detail: claims.length
          ? `${formatRupees(Math.round(claims.reduce((s, c) => s + Number(c.claimAmount ?? 0), 0)))} claimed against customer deposits.`
          : 'No vendor has an unresolved claim against a deposit.',
        link: '/claims',
        cta: 'Arbitrate'
      }
    };

    const list: AttentionRow[] = [...queues.values()].map(q => ({
      key: q.key,
      count: q.count,
      severity: q.severity,
      loading: q.loading,
      error: q.error,
      ...copy[q.key]
    }));

    // Most urgent first; inside a severity band, the bigger backlog wins.
    const rank: Record<Severity, number> = { crit: 0, warn: 1, ok: 2, idle: 3 };
    return list.sort((x, y) => rank[x.severity] - rank[y.severity] || y.count - x.count);
  });

  /** Rows whose count is known — the only ones the header and banner may total. */
  private counted = computed(() => this.rows().filter(r => !r.error && !r.loading));

  readonly stillCounting = computed(() => this.rows().some(r => r.loading));

  readonly openItemCount = computed(() =>
    this.counted().reduce((sum, r) => sum + r.count, 0));

  /**
   * The banner and the "N open" header count the same rows.
   *
   * They used to total different sets — the header summed every row, the banner
   * only the ones in a severity band with something in them — so a board showing
   * "27 items" sat above a header reading 28.
   */
  readonly verdict = computed<{ severity: Severity; text: string; pending?: boolean }>(() => {
    if (this.stillCounting()) {
      return { severity: 'idle', text: 'Reading the queues…', pending: true };
    }
    const rows = this.counted();
    const total = this.openItemCount();
    const crit = rows.filter(r => r.severity === 'crit' && r.count > 0);
    const warn = rows.filter(r => r.severity === 'warn' && r.count > 0);
    const critTotal = crit.reduce((s, r) => s + r.count, 0);

    if (crit.length) {
      return {
        severity: 'crit',
        text: `${total} item${total === 1 ? '' : 's'} open across your queues. ${critTotal} of them, in ${crit.length} queue${crit.length === 1 ? '' : 's'}, ${critTotal === 1 ? 'is' : 'are'} already hurting someone — start at the top.`
      };
    }
    if (warn.length) {
      const warnTotal = warn.reduce((s, r) => s + r.count, 0);
      return {
        severity: 'warn',
        text: `${total} item${total === 1 ? '' : 's'} open, nothing breached yet. ${warnTotal} will be if today goes by untouched.`
      };
    }
    return { severity: 'ok', text: 'Every queue is clear. Nothing needs you before tomorrow.' };
  });

  private oldestBreach(rows: { slaDeadline: string }[], now: number): string {
    const overdue = rows
      .map(r => now - Date.parse(r.slaDeadline))
      .filter(n => Number.isFinite(n) && n > 0);
    if (!overdue.length) return 'just now';
    return `${formatDuration(Math.max(...overdue))} ago`;
  }
}
