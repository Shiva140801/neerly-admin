import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { AdminOrder, TERMINAL_ORDER_STATUSES, isStuck, isUnrouted } from '../../shared/attention.service';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import { Severity, formatDuration, humanize, msSince, msUntil } from '../../shared/ui/urgency';

/** Lifecycle stages, in the order the backend allows them to move. */
const PIPELINE: string[] = [
  'PLACED', 'VENDOR_ASSIGNED', 'VENDOR_ACCEPTED', 'VENDOR_REJECTED',
  'PREPARING', 'DISPATCHED', 'ARRIVING', 'DELIVERED', 'CANCELLED', 'FAILED'
];

type View = 'attention' | 'live' | 'all' | string;

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
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .toolbar .vendor-filter { width: 260px; }

    .lede {
      padding: 12px 16px; border-radius: var(--r-md); margin-bottom: 16px;
      font-size: 13px; line-height: 1.5; font-weight: 600;
    }
    .lede.crit { background: var(--err-soft); color: var(--err-ink); }
    .lede.ok   { background: var(--ok-soft);  color: var(--ok-ink); }

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
      <input class="input vendor-filter mono" type="text" placeholder="Vendor UUID filter…"
             [(ngModel)]="vendorIdInput" (change)="reload()" />
    </div>

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
          [clear]="view() === 'attention'"
          (retry)="reload()" />
      </div>
    } @else {
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
                    {{ r.order.customerName ?? short(r.order.customerId) }}
                    · {{ r.order.placedAt | date:'d MMM, HH:mm' }} · {{ r.order.paymentMethod }}
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
                    @else if (terminal(r.order)) { {{ r.order.deliverBy | date:'d MMM, HH:mm' }} }
                    @else { {{ dur(r.overdueMs) }} left }
                  </div>
                  <div class="why" [class.crit]="r.severity === 'crit'">{{ r.reason }}</div>
                </td>

                <td>
                  @if (r.order.vendorId) {
                    <div class="primary-cell">{{ r.order.vendorName ?? short(r.order.vendorId) }}</div>
                    <div class="sub-cell">
                      @if (r.order.driverId) { {{ r.order.driverName ?? short(r.order.driverId) }} driving }
                      @else { no driver yet }
                    </div>
                  } @else {
                    <span class="pill pill--crit">Unrouted</span>
                  }
                </td>

                <td class="right num">
                  ₹{{ r.order.totalAmount | number:'1.0-0' }}
                  @if (r.order.surgeMultiplier > 1) {
                    <div class="sub-cell">{{ r.order.surgeMultiplier | number:'1.2-2' }}× surge</div>
                  } @else if (r.order.depositTotal > 0) {
                    <div class="sub-cell">₹{{ r.order.depositTotal | number:'1.0-0' }} deposit</div>
                  }
                </td>

                <td class="right">
                  @if (!terminal(r.order)) {
                    <span class="row-actions">
                      <button type="button" class="btn btn--ghost btn--sm" (click)="askReroute(r.order)"
                              [disabled]="busyId() === r.order.id">Reroute</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askCancel(r.order)"
                              [disabled]="busyId() === r.order.id">Cancel</button>
                    </span>
                  } @else {
                    <span class="muted">closed</span>
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
                                  <span class="t">{{ h.changedAt | date:'d MMM, HH:mm' }}</span>
                                  <span class="s">{{ label(h.toStatus) }}</span>
                                  <span class="r">{{ h.actorRole ? '· by ' + h.actorRole : '' }}{{ h.reason ? ' · ' + h.reason : '' }}</span>
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
                                <span>{{ i.quantity }} × {{ i.productName }} <span class="muted">({{ i.containerMode }})</span></span>
                                <span class="num">₹{{ i.subtotal | number:'1.0-0' }}</span>
                              </div>
                            }
                            @if (!d.items.length) { <span class="muted">No line items on this order.</span> }
                          </div>
                          <div class="money">
                            <span>Subtotal</span><span class="amt">₹{{ d.subtotal | number:'1.2-2' }}</span>
                            <span>Delivery</span><span class="amt">₹{{ d.deliveryFee | number:'1.2-2' }}</span>
                            @if (d.surgeSurcharge > 0) { <span>Surge</span><span class="amt">₹{{ d.surgeSurcharge | number:'1.2-2' }}</span> }
                            @if (d.depositTotal > 0) { <span>Container deposit</span><span class="amt">₹{{ d.depositTotal | number:'1.2-2' }}</span> }
                            @if (d.discount > 0) { <span>Discount</span><span class="amt">−₹{{ d.discount | number:'1.2-2' }}</span> }
                            <span class="total">Total</span><span class="amt total">₹{{ d.totalAmount | number:'1.2-2' }}</span>
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
        <span>Page {{ page() + 1 }} · {{ rows().length }} shown of {{ all().length }} fetched</span>
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

  pipeline = PIPELINE;
  readonly pageSize = 100;

  view = signal<View>('attention');
  vendorIdInput = '';
  page = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);
  all = signal<AdminOrder[]>([]);

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

  label(v: string) { return humanize(v); }
  dur(ms: number) { return formatDuration(ms); }
  short(id: string) { return id.slice(0, 8); }
  terminal(o: AdminOrder) { return TERMINAL_ORDER_STATUSES.has(o.status); }

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

  readonly rows = computed<OrderRow[]>(() => {
    const v = this.view();
    const rows = this.decorated();
    const filtered =
      v === 'attention' ? rows.filter(r => this.needsAction(r))
      : v === 'live'    ? rows.filter(r => !this.terminal(r.order))
      : v === 'all'     ? rows
      : rows.filter(r => r.order.status === v);

    // Worst first, then longest overdue, then newest.
    const rank: Record<Severity, number> = { crit: 0, warn: 1, ok: 2, idle: 3 };
    return [...filtered].sort((a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.overdueMs ?? 0) - (b.overdueMs ?? 0) ||
      Date.parse(b.order.placedAt) - Date.parse(a.order.placedAt));
  });

  readonly emptyTitle = computed(() => {
    if (this.view() === 'attention') return 'Nothing is stranded';
    if (this.view() === 'live') return 'No orders in flight';
    return 'No orders match this filter';
  });

  readonly emptyDetail = computed(() => {
    if (this.view() === 'attention') {
      return 'Every open order has a vendor attached and is still inside the window the customer was promised.';
    }
    if (this.view() === 'live') return 'Every order on file has reached a terminal state.';
    return 'Try a wider filter, or clear the vendor UUID box.';
  });

  reload() {
    this.loading.set(true);
    this.error.set(null);
    const params: Record<string, string | number> = { page: this.page(), size: this.pageSize };
    const vendor = this.vendorIdInput.trim();
    if (vendor.length > 0) params['vendorId'] = vendor;
    // Status filtering happens client-side so the counts on every chip stay live.
    this.api.get<AdminOrder[]>('/admin/orders', params).subscribe({
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
      message: `${o.orderNumber} — ₹${Number(o.totalAmount).toFixed(2)}, currently ${humanize(o.status)}.`,
      confirmLabel: 'Cancel order',
      tone: 'danger',
      reason: {
        label: 'Reason',
        placeholder: 'Shown to the customer and written to the audit log.',
        required: true,
        initial: ''
      },
      consequence: 'Cancellation is final — the order cannot be reopened, and any container deposit follows the refund path.'
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
    this.api.post<AdminOrder>(`/admin/orders/${o.id}/reroute`, {}).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.error.set(describeError(e, 'the reroute')); this.busyId.set(null); }
    });
  }

  private cancel(o: AdminOrder) {
    this.busyId.set(o.id);
    this.api.post<AdminOrder>(`/admin/orders/${o.id}/cancel`, { reason: this.lastReason }).subscribe({
      next: () => { this.busyId.set(null); this.reload(); },
      error: e => { this.error.set(describeError(e, 'the cancellation')); this.busyId.set(null); }
    });
  }
}
