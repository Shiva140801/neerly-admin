import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { AdminOrder, TERMINAL_ORDER_STATUSES, isStuck, isUnrouted } from '../../shared/attention.service';
import { describeActionError, describeError } from '../../shared/api-error';
import { label as enumLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { RupeesPipe, WhenPipe } from '../../shared/ui/format.pipe';
import { formatRupees } from '../../shared/ui/format';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, formatDuration, msSince, msUntil } from '../../shared/ui/urgency';

/**
 * The states an admin cancel is actually allowed from.
 *
 * Mirrors `OrderStatus.ALLOWED` on the backend: once a driver has the order
 * (DISPATCHED, ARRIVING) the only exits are DELIVERED and FAILED, so offering
 * Cancel there asks the operator to type a mandatory audited reason and *then*
 * tells them it was never possible.
 */
const CANCELLABLE = new Set(['PLACED', 'VENDOR_ASSIGNED', 'VENDOR_ACCEPTED', 'PREPARING']);

/** Why Cancel is unavailable, for the tooltip on the disabled control. */
function cancelBlockedReason(status: string): string {
  if (TERMINAL_ORDER_STATUSES.has(status)) return `Already ${enumLabel(status).toLowerCase()} — nothing left to cancel.`;
  if (status === 'DISPATCHED' || status === 'ARRIVING') {
    return 'A driver is already carrying this order. It can only be delivered or marked failed from here.';
  }
  if (status === 'VENDOR_REJECTED') {
    return 'The vendor declined this one — reroute it to another vendor, or let it fail.';
  }
  return 'The backend does not allow a cancellation from this stage.';
}

/** Lifecycle stages, in the order the backend allows them to move. */
const PIPELINE: string[] = [
  'PLACED', 'VENDOR_ASSIGNED', 'VENDOR_ACCEPTED', 'VENDOR_REJECTED',
  'PREPARING', 'DISPATCHED', 'ARRIVING', 'DELIVERED', 'CANCELLED', 'FAILED'
];

type View = 'attention' | 'live' | 'all' | string;

/**
 * How close two failures have to be to count as the same incident, and how many
 * it takes before the board treats them as one. Ten minutes is well outside the
 * three-minute vendor accept window, so a routing outage lands in one cluster
 * while two unrelated failures on the same afternoon stay separate rows.
 */
const INCIDENT_WINDOW_MS = 10 * 60_000;
const INCIDENT_MIN_SIZE = 3;

/** A run of failures that happened together — one problem, many orders. */
interface Incident {
  id: string;
  orders: AdminOrder[];
  firstAt: string;
  /** "under a minute" / "3h 12m" — how long the run lasted. */
  spanLabel: string;
  /** "All against Sri Ganesh Water Supply." */
  vendorLabel: string;
}

interface OrderRow {
  order: AdminOrder;
  /** ms past `deliverBy`; negative while still inside the promise. */
  overdueMs: number | null;
  stuck: boolean;
  unrouted: boolean;
  severity: Severity;
  /** ms since the last status transition, when history is loaded. */
  stalledMs: number | null;
  reason: string;
}

/**
 * Cross-vendor order board.
 *
 * Status is the axis, but "which status" is the wrong first question — the
 * useful one is "which of these has stopped moving". An order is stuck when it
 * is past the `deliverBy` the customer was promised and has not reached a
 * terminal state, and unrouted when the routing broadcast never attached a
 * vendor. Both fall straight out of fields the list endpoint returns.
 *
 * The screen therefore opens on the Attention view and puts the two rescue
 * tools the backend exposes — `POST /admin/orders/{id}/reroute` and `/cancel` —
 * on the rows that need them, instead of being read-only.
 */
@Component({
  selector: 'app-orders-admin',
  standalone: true,
  imports: [
    CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent,
    WhenPipe, RupeesPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .toolbar .vendor-filter { width: 260px; }


    .clock { font-weight: 750; font-variant-numeric: tabular-nums; font-size: 13.5px; }
    .clock.crit { color: var(--err); }
    .clock.ok   { color: var(--ink-700); }
    .why { font-size: 11.5px; color: var(--ink-500); margin-top: 2px; }
    .why.crit { color: var(--err-ink); font-weight: 600; }

    .stage { display: flex; align-items: center; gap: 6px; }
    .track { display: flex; gap: 2px; }
    .track i {
      width: 12px; height: 4px; border-radius: var(--r-pill); background: var(--ink-200);
    }
    .track i.done { background: var(--admn); }
    .track i.bad  { background: var(--err); }

    .row-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .row-actions .btn:disabled { cursor: not-allowed; }

    .action-error {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 16px; border-radius: var(--r-md); margin-bottom: 16px;
      background: var(--err-soft); color: var(--err-ink);
      font-size: 13px; font-weight: 600; line-height: 1.5;
    }
    .action-error .btn { margin-left: auto; flex: none; }

    .search { width: 260px; }
    .toolbar .find { display: flex; align-items: center; gap: 8px; margin-left: auto; }
    .toolbar select.vendor-pick { width: 190px; }

    .incident {
      display: grid; grid-template-columns: 58px 1fr auto; gap: 14px; align-items: center;
      padding: 13px 16px; background: var(--ink-50);
      border-bottom: 1px solid var(--ink-200);
    }
    .incident .n { font-size: 22px; font-weight: 800; line-height: 1; text-align: right; color: var(--ink-500); font-variant-numeric: tabular-nums; }
    .incident .t { font-size: 13px; font-weight: 650; color: var(--ink-800); }
    .incident .s { font-size: 12px; color: var(--ink-500); margin-top: 2px; line-height: 1.45; }
    @media (max-width: 720px) {
      .incident { grid-template-columns: 1fr; }
      .incident .n { text-align: left; }
      .toolbar .find { margin-left: 0; width: 100%; flex-wrap: wrap; }
      .search { width: 100%; }
    }

    .expand { background: var(--ink-50); }
    .expand td { padding: 0; }
    .expand-inner { padding: 14px 18px; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 22px; }
    @media (max-width: 900px) { .expand-inner { grid-template-columns: 1fr; } }
    .hist { display: flex; flex-direction: column; gap: 6px; }
    .hist .step { display: flex; gap: 10px; font-size: 12.5px; }
    .hist .step .t { color: var(--ink-500); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .hist .step .s { font-weight: 650; color: var(--ink-800); }
    .hist .step .r { color: var(--ink-500); }
    .lines { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
    .lines .line { display: flex; justify-content: space-between; gap: 12px; }
    .money { display: grid; grid-template-columns: 1fr auto; gap: 3px 14px; font-size: 12.5px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ink-200); }
    .money .amt { font-variant-numeric: tabular-nums; text-align: right; }
    .money .total { font-weight: 750; color: var(--ink-900); }
  `],
  template: `
    <app-page-header
      title="Order" accent="board"
      subtitle="An order is stuck when it is past the delivery window the customer was promised and still has not landed. Those come first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div class="chips">
        <button type="button" class="chip" [class.active]="view() === 'attention'" (click)="setView('attention')">
          Needs action
          @if (counts().attention > 0) { <span class="count count--crit">{{ counts().attention }}</span> }
        </button>
        <button type="button" class="chip" [class.active]="view() === 'live'" (click)="setView('live')">
          In flight <span class="count">{{ counts().live }}</span>
        </button>
        <button type="button" class="chip" [class.active]="view() === 'all'" (click)="setView('all')">
          All <span class="count">{{ counts().all }}</span>
        </button>
        @for (s of pipeline; track s) {
          @if (counts().byStatus[s]) {
            <button type="button" class="chip" [class.active]="view() === s" (click)="setView(s)">
              {{ label(s) }} <span class="count">{{ counts().byStatus[s] }}</span>
            </button>
          }
        }
      </div>
      <div class="find">
        <input class="input search" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"
               placeholder="Find an order — NEE-26243-0002, or a customer" aria-label="Find an order by number or customer" />
        <select class="input vendor-pick" [ngModel]="vendorFilter()" (ngModelChange)="vendorFilter.set($event)"
                aria-label="Filter by vendor">
          <option value="">Every vendor</option>
          @for (v of vendorOptions(); track v.id) { <option [value]="v.id">{{ v.name }}</option> }
          @if (unroutedCount() > 0) { <option value="__none">No vendor attached ({{ unroutedCount() }})</option> }
        </select>
      </div>
    </div>

    @if (actionError(); as e) {
      <div class="action-error" role="alert">
        <span aria-hidden="true">!</span>
        <span>{{ e }}</span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="actionError.set(null)">Dismiss</button>
      </div>
    }

    @if (!loading() && !error() && all().length > 0) {
      <div class="lede" [class.crit]="counts().attention > 0" [class.ok]="counts().attention === 0">
        @if (counts().attention > 0) {
          {{ counts().attention }} order{{ counts().attention === 1 ? '' : 's' }} need{{ counts().attention === 1 ? 's' : '' }} you:
          {{ counts().stuck }} past the promised window,
          {{ counts().unrouted }} never matched to a vendor,
          {{ counts().failed }} failed.
        } @else {
          Nothing is stranded. Every open order has a vendor and is inside its delivery window.
        }
      </div>
    }

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the order board"
          [loading]="loading()" [error]="error()"
          [emptyTitle]="emptyTitle()"
          [emptyDetail]="emptyDetail()"
          [clear]="view() === 'attention' && !filtering()"
          (retry)="reload()" />
      </div>
    } @else {
      @if (view() === 'attention' && incidents().length > 0) {
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-head">
            <h2>Failure clusters</h2>
            <span class="text-label">{{ incidents().length }} incident{{ incidents().length === 1 ? '' : 's' }}</span>
          </div>
          @for (inc of incidents(); track inc.id) {
            <div class="incident">
              <span class="n">{{ inc.orders.length }}</span>
              <span>
                <span class="t">{{ inc.orders.length }} orders failed inside {{ inc.spanLabel }}</span>
                <span class="s">
                  {{ inc.firstAt | when }} — one incident, not {{ inc.orders.length }} separate problems.
                  Failed orders are terminal: there is nothing to reroute or cancel.
                  {{ inc.vendorLabel }}
                </span>
              </span>
              <span class="row-flex gap-6">
                <button type="button" class="btn btn--ghost btn--sm" (click)="toggleIncident(inc.id)">
                  {{ expandedIncidents().has(inc.id) ? 'Fold back up' : 'List them' }}
                </button>
                <button type="button" class="btn btn--ghost btn--sm" (click)="dismissIncident(inc.id)">
                  Set aside
                </button>
              </span>
            </div>
          }
          @if (dismissedIncidents().size > 0) {
            <div class="incident">
              <span class="n muted">{{ dismissedCount() }}</span>
              <span>
                <span class="t">{{ dismissedCount() }} failed order{{ dismissedCount() === 1 ? '' : 's' }} set aside</span>
                <span class="s">
                  Hidden from this board for this session only. Nothing was changed on the platform, and they are
                  back after a reload — the backend has no "acknowledged" flag to write to.
                </span>
              </span>
              <button type="button" class="btn btn--ghost btn--sm" (click)="restoreIncidents()">Bring back</button>
            </div>
          }
        </div>
      }

      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Order</th>
              <th>Stage</th>
              <th>Delivery window</th>
              <th>Vendor</th>
              <th class="right">Value</th>
              <th class="right">Rescue</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.order.id) {
              <tr [class.sev-crit]="r.severity === 'crit'" [class.sev-warn]="r.severity === 'warn'">
                <td>
                  <button type="button" class="link" style="background:none;border:0;padding:0;font:inherit;cursor:pointer;"
                          (click)="toggle(r.order)">
                    <span class="mono">{{ r.order.orderNumber }}</span>
                  </button>
                  <div class="sub-cell">
                    {{ r.order.customerName ?? unnamedCustomer(r.order.customerId) }}
                    · {{ r.order.placedAt | when }} · {{ label(r.order.paymentMethod) }}
                  </div>
                </td>

                <td>
                  <span class="stage">
                    <span class="pill"
                          [class.pill--ok]="r.order.status === 'DELIVERED'"
                          [class.pill--crit]="r.order.status === 'FAILED' || r.order.status === 'CANCELLED' || r.order.status === 'VENDOR_REJECTED'"
                          [class.pill--brand]="r.order.status === 'DISPATCHED' || r.order.status === 'ARRIVING'"
                          [class.pill--info]="r.order.status === 'VENDOR_ACCEPTED' || r.order.status === 'PREPARING'"
                          [class.pill--warn]="r.order.status === 'PLACED' || r.order.status === 'VENDOR_ASSIGNED'">
                      {{ label(r.order.status) }}
                    </span>
                  </span>
                  <span class="track mt-4">
                    @for (step of trackFor(r.order); track $index) {
                      <i [class.done]="step === 1" [class.bad]="step === 2"></i>
                    }
                  </span>
                </td>

                <td>
                  <div class="clock" [class.crit]="r.stuck" [class.ok]="!r.stuck">
                    @if (r.overdueMs === null) { — }
                    @else if (r.stuck) { {{ dur(r.overdueMs) }} over }
                    @else if (terminal(r.order)) { {{ r.order.deliverBy | when }} }
                    @else { {{ dur(r.overdueMs) }} left }
                  </div>
                  <div class="why" [class.crit]="r.severity === 'crit'">{{ r.reason }}</div>
                </td>

                <td>
                  @if (r.order.vendorId) {
                    <div class="primary-cell">{{ r.order.vendorName ?? unnamedVendor(r.order.vendorId) }}</div>
                    <div class="sub-cell">
                      @if (r.order.driverId) { {{ r.order.driverName ?? unnamedDriver(r.order.driverId) }} driving }
                      @else { no driver yet }
                    </div>
                  } @else {
                    <span class="pill pill--crit">Unrouted</span>
                  }
                </td>

                <td class="right num">
                  {{ r.order.totalAmount | rupees }}
                  @if (r.order.surgeMultiplier > 1) {
                    <div class="sub-cell">{{ r.order.surgeMultiplier | number:'1.2-2' }}× surge</div>
                  } @else if (r.order.depositTotal > 0) {
                    <div class="sub-cell">{{ r.order.depositTotal | rupees }} deposit</div>
                  }
                </td>

                <td class="right">
                  @if (!terminal(r.order)) {
                    <span class="row-actions">
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askReroute(r.order)"
                              [disabled]="busyId() === r.order.id">Reroute</button>
                      <!-- Cancel is offered only from the stages the backend
                           actually allows it from; elsewhere the control stays
                           visible but disabled and says why, rather than taking
                           a mandatory typed reason and then refusing. -->
                      <button type="button" class="btn btn--danger btn--sm" (click)="askCancel(r.order)"
                              [disabled]="busyId() === r.order.id || !canCancel(r.order)"
                              [title]="canCancel(r.order) ? 'Cancel this order' : cancelBlocked(r.order.status)">
                        Cancel
                      </button>
                    </span>
                  } @else {
                    <span class="muted">{{ label(r.order.status).toLowerCase() }}</span>
                  }
                </td>
              </tr>

              @if (expandedId() === r.order.id) {
                <tr class="expand">
                  <td colspan="6">
                    <div class="expand-inner">
                      <div>
                        <div class="text-label" style="margin-bottom:8px;">Status history</div>
                        @if (detail(); as d) {
                          @if (d.history.length) {
                            <div class="hist">
                              @for (h of d.history; track $index) {
                                <div class="step">
                                  <span class="t">{{ h.changedAt | when }}</span>
                                  <span class="s">{{ label(h.toStatus) }}</span>
                                  <span class="r">{{ h.actorRole ? '· by ' + label(h.actorRole) : '' }}{{ h.reason ? ' · ' + h.reason : '' }}</span>
                                </div>
                              }
                            </div>
                            @if (r.stalledMs !== null) {
                              <div class="why mt-8">No movement for {{ dur(r.stalledMs) }}.</div>
                            }
                          } @else {
                            <div class="muted">No transitions recorded.</div>
                          }
                        } @else {
                          <div class="muted">Loading history…</div>
                        }
                      </div>

                      <div>
                        <div class="text-label" style="margin-bottom:8px;">Basket</div>
                        @if (detail(); as d) {
                          <div class="lines">
                            @for (i of d.items; track i.id) {
                              <div class="line">
                                <span>
                                  {{ i.quantity }} × {{ productName(i) }}
                                  @if (i.containerMode) { <span class="muted">· {{ containerNote(i.containerMode) }}</span> }
                                </span>
                                <span class="num">{{ i.subtotal | rupees }}</span>
                              </div>
                            }
                            @if (!d.items.length) { <span class="muted">No line items on this order.</span> }
                          </div>
                          <div class="money">
                            <span>Subtotal</span><span class="amt">{{ d.subtotal | rupees }}</span>
                            <span>Delivery</span><span class="amt">{{ d.deliveryFee | rupees }}</span>
                            @if (d.surgeSurcharge > 0) { <span>Surge</span><span class="amt">{{ d.surgeSurcharge | rupees }}</span> }
                            @if (d.depositTotal > 0) { <span>Container deposit</span><span class="amt">{{ d.depositTotal | rupees }}</span> }
                            @if (d.discount > 0) { <span>Discount</span><span class="amt">−{{ d.discount | rupees }}</span> }
                            <span class="total">Total</span><span class="amt total">{{ d.totalAmount | rupees }}</span>
                          </div>
                        }
                      </div>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <div class="row-flex gap-12 mt-16" style="font-size:12.5px;color:var(--ink-600);">
        <button type="button" class="btn btn--ghost btn--sm" (click)="prev()" [disabled]="page() === 0">‹ Previous</button>
        <span>
          Showing {{ rows().length }} of {{ all().length }} order{{ all().length === 1 ? '' : 's' }} on this page
          @if (query().trim() || vendorFilter()) { · filtered }
        </span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="next()" [disabled]="all().length < pageSize">Next ›</button>
      </div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busyId() !== null"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class OrdersComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private route = inject(ActivatedRoute);
  private toasts = inject(ToastService);

  pipeline = PIPELINE;
  readonly pageSize = 100;

  view = signal<View>('attention');
  /** Free-text find: order number or customer name. Both are on every row. */
  query = signal('');
  /** Vendor id, `__none` for unrouted, or '' for every vendor. */
  vendorFilter = signal('');
  page = signal(0);
  loading = signal(true);
  /** A failed *load*: the board has nothing to show. */
  error = signal<string | null>(null);
  /**
   * A failed *action*: the board is fine, the thing you just pressed is not.
   *
   * These used to share one slot, so a refused cancellation replaced the whole
   * 27-row board with "Couldn't load the order board" — which was untrue, and
   * cost the operator the list they were working.
   */
  actionError = signal<string | null>(null);
  all = signal<AdminOrder[]>([]);

  /** Failure clusters folded open by the operator. */
  readonly expandedIncidents = signal<ReadonlySet<string>>(new Set());
  /** Clusters set aside for this session. Never written to the backend. */
  readonly dismissedIncidents = signal<ReadonlySet<string>>(new Set());

  expandedId = signal<string | null>(null);
  detail = signal<AdminOrder | null>(null);
  busyId = signal<string | null>(null);
  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() {
    // Deep-linked from the overview's "Reroute / cancel" row.
    const requested = this.route.snapshot.queryParamMap.get('view');
    if (requested) this.view.set(requested as View);
    this.reload();
  }

  setView(v: View) { this.view.set(v); this.expandedId.set(null); }

  label(v: string) { return enumLabel(v); }
  dur(ms: number) { return formatDuration(ms); }
  terminal(o: AdminOrder) { return TERMINAL_ORDER_STATUSES.has(o.status); }

  /** Whether the backend will accept a cancel from this order's current stage. */
  canCancel(o: AdminOrder) { return CANCELLABLE.has(o.status); }
  cancelBlocked(status: string) { return cancelBlockedReason(status); }

  // A party the payload could not name still shows its id — it is the only
  // handle for a support ticket — but never dressed up as a name.
  unnamedCustomer(id: string) { return `unnamed customer · ${id.slice(0, 8)}`; }
  unnamedVendor(id: string) { return `unnamed vendor · ${id.slice(0, 8)}`; }
  unnamedDriver(id: string) { return `unnamed driver · ${id.slice(0, 8)}`; }

  /**
   * The basket used to print the product UUID, because this path returns the id
   * in `productName`. The backend now sends a real name; a value that still
   * looks like a UUID is labelled as unresolved rather than shown as a product.
   */
  productName(item: { productName: string; productId: string }): string {
    const name = (item.productName ?? '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
    if (!name || isUuid) return `unnamed product · ${(item.productId ?? name).slice(0, 8)}`;
    return name;
  }

  /** `KEEP` / `TRANSFER_AND_RETURN` said in words. */
  containerNote(mode: string): string {
    if (mode === 'KEEP') return 'customer keeps the container';
    if (mode === 'TRANSFER_AND_RETURN') return 'container returns with the driver';
    return enumLabel(mode).toLowerCase();
  }

  /** Six-segment progress track: 1 = reached, 2 = ended badly, 0 = not yet. */
  trackFor(o: AdminOrder): number[] {
    const happy = ['PLACED', 'VENDOR_ASSIGNED', 'VENDOR_ACCEPTED', 'PREPARING', 'DISPATCHED', 'DELIVERED'];
    const bad = o.status === 'FAILED' || o.status === 'CANCELLED' || o.status === 'VENDOR_REJECTED';
    const reachedIdx = happy.indexOf(o.status === 'ARRIVING' ? 'DISPATCHED' : o.status);
    return happy.map((_, i) => {
      if (bad && i === 0) return 2;
      return reachedIdx >= 0 && i <= reachedIdx ? 1 : 0;
    });
  }

  private decorate(o: AdminOrder, now: number): OrderRow {
    const overdueMs = msUntil(o.deliverBy, now);
    const stuck = isStuck(o, now);
    const unrouted = isUnrouted(o);
    const lastChange = o.history?.length ? o.history[o.history.length - 1].changedAt : null;
    const stalledMs = lastChange ? msSince(lastChange, now) : null;

    let reason: string;
    let severity: Severity;
    if (o.status === 'FAILED') { reason = 'Failed — never delivered'; severity = 'crit'; }
    else if (unrouted && !this.terminal(o)) { reason = 'Routing found no vendor'; severity = 'crit'; }
    else if (stuck) { reason = 'Past the promised delivery window'; severity = 'crit'; }
    else if (o.status === 'CANCELLED') { reason = 'Cancelled'; severity = 'idle'; }
    else if (o.status === 'DELIVERED') {
      reason = o.deliveredAt ? `Delivered ${new Date(o.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Delivered';
      severity = 'ok';
    }
    else if (overdueMs !== null && overdueMs < 30 * 60_000) { reason = 'Window closes shortly'; severity = 'warn'; }
    else { reason = 'On track'; severity = 'ok'; }

    return { order: o, overdueMs, stuck, unrouted, severity, stalledMs, reason };
  }

  readonly decorated = computed<OrderRow[]>(() => {
    const now = this.clock.now();
    return this.all().map(o => this.decorate(o, now));
  });

  readonly counts = computed(() => {
    const rows = this.decorated();
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.order.status] = (byStatus[r.order.status] ?? 0) + 1;
    const stuck = rows.filter(r => r.stuck).length;
    const unrouted = rows.filter(r => r.unrouted && !this.terminal(r.order)).length;
    const failed = rows.filter(r => r.order.status === 'FAILED').length;
    return {
      all: rows.length,
      live: rows.filter(r => !this.terminal(r.order)).length,
      attention: rows.filter(r => this.needsAction(r)).length,
      stuck, unrouted, failed, byStatus
    };
  });

  private needsAction(r: OrderRow): boolean {
    return r.order.status === 'FAILED' || r.stuck || (r.unrouted && !this.terminal(r.order));
  }

  /**
   * Vendors to filter by, taken from the rows on screen.
   *
   * The old control was a free-text "Vendor UUID" box: no UUID is displayed
   * anywhere in the portal, and typing the vendor's name blanked the screen with
   * "Parameter 'vendorId' has invalid type". A select built from the names
   * actually present cannot be typed wrong and needs nothing the operator has
   * not already seen.
   */
  readonly vendorOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const o of this.all()) {
      if (o.vendorId && !seen.has(o.vendorId)) {
        seen.set(o.vendorId, o.vendorName ?? `unnamed vendor · ${o.vendorId.slice(0, 8)}`);
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly unroutedCount = computed(() => this.all().filter(o => !o.vendorId).length);

  /**
   * Failed orders clustered into incidents.
   *
   * 24 of 27 "needs action" rows were FAILED inside one three-minute window —
   * one routing incident wearing 24 hats. Failed is terminal, so none of them
   * has an action on it; leaving them loose buries the two or three orders that
   * can still be rescued. Orders whose failures land within ten minutes of each
   * other are one cluster.
   */
  readonly incidents = computed<Incident[]>(() => {
    const failed = this.decorated()
      .filter(r => r.order.status === 'FAILED')
      .map(row => ({ row, at: this.failedAt(row.order) }))
      .filter(x => Number.isFinite(x.at))
      .sort((a, b) => a.at - b.at);

    const groups: { at: number; row: OrderRow }[][] = [];
    let group: { at: number; row: OrderRow }[] = [];
    let lastAt = -Infinity;
    for (const item of failed) {
      if (group.length && item.at - lastAt > INCIDENT_WINDOW_MS) {
        groups.push(group);
        group = [];
      }
      group.push(item);
      lastAt = item.at;
    }
    if (group.length) groups.push(group);

    // A single failure is just a failed order — only a run of them is an incident.
    return groups
      .filter(g => g.length >= INCIDENT_MIN_SIZE)
      .map(g => {
        const orders = g.map(x => x.row.order);
        const spanMs = g[g.length - 1].at - g[0].at;
        const vendors = new Set(orders.map(o => o.vendorName ?? (o.vendorId ? `unnamed vendor · ${o.vendorId.slice(0, 8)}` : 'no vendor attached')));
        return {
          id: new Date(g[0].at).toISOString(),
          orders,
          firstAt: new Date(g[0].at).toISOString(),
          spanLabel: spanMs < 60_000 ? 'under a minute' : formatDuration(spanMs),
          vendorLabel: vendors.size === 1 ? `All against ${[...vendors][0]}.` : `Across ${vendors.size} vendors.`
        };
      })
      .sort((a, b) => b.orders.length - a.orders.length);
  });

  /** Ids of failed orders currently folded away inside a cluster. */
  private hiddenOrderIds = computed<ReadonlySet<string>>(() => {
    const expanded = this.expandedIncidents();
    const dismissed = this.dismissedIncidents();
    const hidden = new Set<string>();
    for (const inc of this.incidents()) {
      if (dismissed.has(inc.id) || !expanded.has(inc.id)) {
        for (const o of inc.orders) hidden.add(o.id);
      }
    }
    return hidden;
  });

  readonly dismissedCount = computed(() =>
    this.incidents()
      .filter(inc => this.dismissedIncidents().has(inc.id))
      .reduce((n, inc) => n + inc.orders.length, 0));

  toggleIncident(id: string) {
    this.expandedIncidents.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  dismissIncident(id: string) {
    this.dismissedIncidents.update(set => new Set(set).add(id));
    this.expandedIncidents.update(set => { const n = new Set(set); n.delete(id); return n; });
  }

  restoreIncidents() { this.dismissedIncidents.set(new Set()); }

  /** When this order actually failed, preferring its own history over placement. */
  private failedAt(o: AdminOrder): number {
    const last = o.history?.length ? o.history[o.history.length - 1].changedAt : null;
    return Date.parse(last ?? o.placedAt);
  }

  readonly rows = computed<OrderRow[]>(() => {
    const v = this.view();
    const rows = this.decorated();
    const base =
      v === 'attention' ? rows.filter(r => this.needsAction(r))
      : v === 'live'    ? rows.filter(r => !this.terminal(r.order))
      : v === 'all'     ? rows
      : rows.filter(r => r.order.status === v);

    // Clusters only fold rows away on the triage view — every other view is a
    // deliberate look at a status, and hiding rows there would be a lie.
    const folded = v === 'attention' ? this.hiddenOrderIds() : new Set<string>();

    const q = this.query().trim().toLowerCase();
    const vendor = this.vendorFilter();

    const filtered = base.filter(r => {
      if (folded.has(r.order.id)) return false;
      if (vendor === '__none' && r.order.vendorId) return false;
      if (vendor && vendor !== '__none' && r.order.vendorId !== vendor) return false;
      if (!q) return true;
      return r.order.orderNumber.toLowerCase().includes(q)
        || (r.order.customerName ?? '').toLowerCase().includes(q)
        || (r.order.vendorName ?? '').toLowerCase().includes(q);
    });

    // Worst first, then longest overdue, then newest.
    const rank: Record<Severity, number> = { crit: 0, warn: 1, ok: 2, idle: 3 };
    return [...filtered].sort((a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.overdueMs ?? 0) - (b.overdueMs ?? 0) ||
      Date.parse(b.order.placedAt) - Date.parse(a.order.placedAt));
  });

  readonly filtering = computed(() => !!this.query().trim() || !!this.vendorFilter());

  readonly emptyTitle = computed(() => {
    if (this.filtering()) return 'Nothing matches that search';
    if (this.view() === 'attention') return 'Nothing is stranded';
    if (this.view() === 'live') return 'No orders in flight';
    return 'No orders in this stage';
  });

  readonly emptyDetail = computed(() => {
    if (this.filtering()) {
      return 'Search covers the order number and the customer and vendor names on this page. Clear the box, or widen the stage filter above.';
    }
    if (this.view() === 'attention') {
      return 'Every open order has a vendor attached and is still inside the window the customer was promised.';
    }
    if (this.view() === 'live') return 'Every order on file has reached a terminal state.';
    return 'No order currently sits at this stage.';
  });

  reload() {
    this.loading.set(true);
    this.error.set(null);
    // Status, vendor and text filtering all happen client-side on the fetched
    // page, so every chip keeps a live count and the search box can match a
    // customer name — which the list endpoint cannot filter on.
    this.api.get<AdminOrder[]>('/admin/orders', { page: this.page(), size: this.pageSize }).subscribe({
      next: data => { this.all.set(Array.isArray(data) ? data : []); this.loading.set(false); this.clock.sync(); },
      error: e => {
        this.error.set(describeError(e, 'the order board'));
        this.all.set([]);
        this.loading.set(false);
      }
    });
  }

  toggle(o: AdminOrder) {
    if (this.expandedId() === o.id) { this.expandedId.set(null); return; }
    this.expandedId.set(o.id);
    this.detail.set(null);
    this.api.get<AdminOrder>(`/admin/orders/${o.id}`).subscribe({
      next: d => this.detail.set(d),
      error: () => this.detail.set({ ...o, items: [], history: [] })
    });
  }

  prev() { if (this.page() > 0) { this.page.update(p => p - 1); this.reload(); } }
  next() { this.page.update(p => p + 1); this.reload(); }

  // --- rescue actions ------------------------------------------------------

  askReroute(o: AdminOrder) {
    this.confirm.set({
      title: 'Re-run routing',
      message: `Broadcasts ${o.orderNumber} to the next eligible vendor in its service area.`,
      confirmLabel: 'Reroute order',
      tone: 'primary',
      consequence: o.vendorId
        ? 'The currently assigned vendor loses this order and a fresh broadcast goes out.'
        : 'The customer is not charged again — this only re-runs vendor matching.'
    });
    this.pending = () => this.reroute(o);
  }

  askCancel(o: AdminOrder) {
    this.confirm.set({
      title: 'Cancel order',
      message: `${o.orderNumber} — ${formatRupees(o.totalAmount)}, currently ${enumLabel(o.status).toLowerCase()}.`,
      confirmLabel: 'Cancel order',
      tone: 'danger',
      reason: {
        label: 'Reason',
        placeholder: 'Shown to the customer and written to the audit log.',
        required: true,
        initial: ''
      },
      consequence: 'Cancellation is final — the order cannot be reopened, and any container deposit follows the refund path.',
      // Two buttons both starting with "Cancel" made the safe choice read as
      // the destructive one. The dismiss button says what it preserves.
      cancelLabel: 'Keep order'
    });
    this.pending = () => this.cancel(o);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.lastReason = result.reason;
    this.confirm.set(null);
    this.pending = null;
    run?.(result);
  }

  private lastReason = '';

  private reroute(o: AdminOrder) {
    this.busyId.set(o.id);
    this.actionError.set(null);
    this.api.post<AdminOrder>(`/admin/orders/${o.id}/reroute`, {}).subscribe({
      next: updated => {
        this.busyId.set(null);
        this.toasts.success(
          `${o.orderNumber} rebroadcast`,
          updated?.vendorName
            ? `Now with ${updated.vendorName}. The customer was not charged again.`
            : 'Looking for the next eligible vendor in its service area. The customer was not charged again.'
        );
        this.reload();
      },
      // The board loaded fine — only the reroute failed, so the list stays.
      error: e => { this.actionError.set(describeActionError(e, 'rerouting this order')); this.busyId.set(null); }
    });
  }

  private cancel(o: AdminOrder) {
    this.busyId.set(o.id);
    this.actionError.set(null);
    this.api.post<AdminOrder>(`/admin/orders/${o.id}/cancel`, { reason: this.lastReason }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toasts.success(
          `${o.orderNumber} cancelled`,
          `${formatRupees(o.totalAmount)} order closed. The reason you gave is on the customer's record and in the audit log.`
        );
        this.reload();
      },
      error: e => { this.actionError.set(describeActionError(e, 'cancelling this order')); this.busyId.set(null); }
    });
  }
}
