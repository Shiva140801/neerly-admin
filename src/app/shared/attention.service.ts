import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiClient, Page } from '../core/api/api-client';
import { describeError } from './api-error';
import { MS_DAY, MS_HOUR, daysUntilDate, expirySeverity, msSince, msUntil, waitSeverity } from './ui/urgency';
import type { VendorResponse } from '../features/vendors/vendor.model';
import type { Complaint } from '../features/complaints/complaint.model';
import type { SurgeTrigger } from '../features/surge/surge.model';
import type { Severity } from './ui/urgency';

/**
 * The single city Neerly operates in (PRD §2 — Hyderabad launch). Surge history
 * is scoped per city on the wire, so the overview has to name one to ask.
 */
export const HOME_CITY = 'Hyderabad';

/** Cross-vendor order row as `/admin/orders` actually returns it. */
export interface AdminOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  customerId: string;
  vendorId: string | null;
  driverId: string | null;
  /** Resolved display names — batch-joined server-side; null when unassigned or unresolvable. */
  customerName: string | null;
  vendorName: string | null;
  driverName: string | null;
  addressId: string;
  subtotal: number;
  deliveryFee: number;
  surgeSurcharge: number;
  depositTotal: number;
  taxes: number;
  discount: number;
  totalAmount: number;
  paymentMethod: string;
  surgeMultiplier: number;
  deliverBy: string;
  placedAt: string;
  deliveredAt: string | null;
  items: {
    id: string; productId: string; productName: string; quantity: number;
    unitPrice: number; subtotal: number; containerMode: string | null; depositAmount: number | null;
  }[];
  history: {
    fromStatus: string | null; toStatus: string; actorRole: string | null;
    reason: string | null; changedAt: string;
  }[];
}

export interface ComplianceDoc {
  id: string;
  docType: string;
  docNumber: string | null;
  s3Key: string;
  issuedDate: string | null;
  expiresDate: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  rejectionReason: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
  /** Owning vendor. Nullable: resolution is best-effort server-side. */
  vendorId: string | null;
  vendorName: string | null;
}

export interface AdminRefund {
  id: string;
  paymentId: string;
  orderId: string | null;
  customerId: string;
  /** Resolved display names, joined server-side. Nullable — see DamageClaim. */
  customerName?: string | null;
  vendorName?: string | null;
  /** The human order reference (`NEE-…`) when the backend can supply it. */
  orderNumber?: string | null;
  amount: number;
  reason: string;
  refundMode: 'ORIGINAL' | 'WALLET' | 'CASH';
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  razorpayRefundId: string | null;
  requestedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
}

export interface DamageClaim {
  id: string;
  vendorId: string;
  customerId: string;
  /**
   * Resolved display names, joined server-side. Nullable: a party the backend
   * could not name is shown as an unresolved id, never invented.
   */
  vendorName?: string | null;
  customerName?: string | null;
  depositId: string;
  returnId: string | null;
  claimAmount: number;
  awardedAmount: number | null;
  reason: string;
  evidencePhotos: string[];
  status: 'FILED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  adminVerdict: string | null;
  adminNote: string | null;
  filedAt: string;
  resolvedAt: string | null;
}

export interface AdminAnalyticsSummary {
  wapc: number;
  ordersToday: number;
  deliveredToday: number;
  grossRevenueToday: number;
  activeSubscriptions: number;
  activeVendors: number;
  openComplaints: number;
  slaBreachedComplaints: number;
  depositsHeld: number;
  depositsForfeitedThisWeek: number;
}

/**
 * One queue, counted once.
 *
 * The sidebar badge and the overview row used to compute their own numbers from
 * the same signals with different rules — "Compliance 1" next to "Licences
 * expiring — 0", "Disputes 1" next to "past SLA — 0" — in identical styling, so
 * the two surfaces contradicted each other about the same queue. Both now read
 * these, so a badge and a row can only ever show the same figure, and the label
 * says exactly what that figure counts.
 */
export interface QueueCount {
  key: QueueKey;
  /** What the number counts, said in full. Sidebar shortens it, nothing redefines it. */
  label: string;
  count: number;
  severity: Severity;
  loading: boolean;
  error: string | null;
}

export type QueueKey = 'disputes' | 'orders' | 'vendors' | 'compliance' | 'refunds' | 'claims';

/** A single fetch's three states, so each queue fails independently. */
export interface Slice<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

function idle<T>(seed: T): Slice<T> { return { data: seed, loading: true, error: null }; }

/**
 * An admin order counts as *stuck* when it is past the delivery deadline the
 * customer was promised and has not reached a terminal state. `deliverBy` and
 * `status` both come straight off the wire — nothing here is inferred from a
 * field the backend does not send.
 */
export function isStuck(o: AdminOrder, now: number): boolean {
  if (TERMINAL_ORDER_STATUSES.has(o.status)) return false;
  const remaining = msUntil(o.deliverBy, now);
  return remaining !== null && remaining < 0;
}

/** Placed but never routed to a vendor — the routing broadcast never landed. */
export function isUnrouted(o: AdminOrder): boolean {
  return !o.vendorId && (o.status === 'PLACED' || o.status === 'VENDOR_ASSIGNED' || o.status === 'VENDOR_REJECTED');
}

export const TERMINAL_ORDER_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'FAILED']);
export const OPEN_COMPLAINT_STATUSES = new Set(['OPEN', 'TRIAGED', 'IN_PROGRESS']);

/**
 * The shared "what needs me right now" read model.
 *
 * The overview and the sidebar badges both want the same six queues, and the
 * admin bounces between them all morning — so the fetches live here once and
 * both surfaces read the same signals. Every queue keeps its own loading/error
 * so an ADMIN_L1 session that is refused the L2-gated endpoints still gets a
 * working dashboard for everything else.
 */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  private api = inject(ApiClient);

  readonly summary = signal<Slice<AdminAnalyticsSummary | null>>(idle(null));
  readonly pendingVendors = signal<Slice<VendorResponse[]>>(idle([]));
  readonly activeVendors = signal<Slice<VendorResponse[]>>(idle([]));
  readonly complaints = signal<Slice<Complaint[]>>(idle([]));
  readonly orders = signal<Slice<AdminOrder[]>>(idle([]));
  readonly expiringDocs = signal<Slice<ComplianceDoc[]>>(idle([]));
  readonly refunds = signal<Slice<AdminRefund[]>>(idle([]));
  readonly claims = signal<Slice<DamageClaim[]>>(idle([]));
  readonly surge = signal<Slice<SurgeTrigger[]>>(idle([]));

  private lastLoaded = signal<number | null>(null);
  readonly loadedAt = this.lastLoaded.asReadonly();

  readonly anyLoading = computed(() =>
    this.summary().loading || this.pendingVendors().loading || this.complaints().loading ||
    this.orders().loading || this.expiringDocs().loading || this.refunds().loading ||
    this.claims().loading || this.activeVendors().loading || this.surge().loading
  );

  /** Open complaints already past their SLA deadline (server's own verdict wins). */
  breachedComplaints(now: number): Complaint[] {
    return this.complaints().data
      .filter(c => OPEN_COMPLAINT_STATUSES.has(c.status))
      .filter(c => c.slaBreached || (msUntil(c.slaDeadline, now) ?? 1) <= 0);
  }

  /** Open complaints inside the last four hours of their SLA — PRD §13.6.1. */
  atRiskComplaints(now: number): Complaint[] {
    return this.complaints().data
      .filter(c => OPEN_COMPLAINT_STATUSES.has(c.status) && !c.slaBreached)
      .filter(c => {
        const left = msUntil(c.slaDeadline, now);
        return left !== null && left > 0 && left <= 4 * MS_HOUR;
      });
  }

  stuckOrders(now: number): AdminOrder[] {
    return this.orders().data.filter(o => isStuck(o, now));
  }

  failedOrders(): AdminOrder[] {
    return this.orders().data.filter(o => o.status === 'FAILED');
  }

  /** Vendors waiting on a verification decision, longest wait first. */
  waitingVendors(now: number): VendorResponse[] {
    return [...this.pendingVendors().data]
      .sort((a, b) => (msSince(a.joinedAt, now) ?? 0) > (msSince(b.joinedAt, now) ?? 0) ? -1 : 1);
  }

  /** Longest unreviewed wait in the vendor queue, in ms. */
  longestVendorWait(now: number): number | null {
    const waits = this.pendingVendors().data
      .map(v => msSince(v.joinedAt, now))
      .filter((n): n is number => n !== null);
    return waits.length ? Math.max(...waits) : null;
  }

  /**
   * Live vendors whose FSSAI licence lapses inside `withinDays`. This is the
   * only place vendor identity and licence expiry meet: the compliance
   * documents endpoint returns no vendor reference at all, so the vendor's own
   * `fssaiExpiresAt` is the only field that can name who is about to be blocked.
   */
  fssaiWatch(now: number, withinDays = 30): { vendor: VendorResponse; days: number }[] {
    return this.activeVendors().data
      .map(v => ({ vendor: v, days: daysUntilDate(v.fssaiExpiresAt, now) }))
      .filter((r): r is { vendor: VendorResponse; days: number } => r.days !== null && r.days <= withinDays)
      .sort((a, b) => a.days - b.days);
  }

  /** Live vendors under the PRD §12.4 auto-review rating threshold. */
  ratingWatch(): VendorResponse[] {
    return this.activeVendors().data
      .filter(v => v.avgRating !== null && v.avgRating < 3.5)
      .sort((a, b) => (a.avgRating ?? 5) - (b.avgRating ?? 5));
  }

  refundsAwaiting(): AdminRefund[] { return this.refunds().data; }
  refundExposure(): number {
    return this.refunds().data.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  }

  claimsAwaiting(): DamageClaim[] {
    return this.claims().data.filter(c => c.status === 'FILED' || c.status === 'UNDER_REVIEW');
  }

  /** Open complaints, whatever their SLA state — what the Disputes queue holds. */
  openComplaints(): Complaint[] {
    return this.complaints().data.filter(c => OPEN_COMPLAINT_STATUSES.has(c.status));
  }

  /**
   * Orders the board's "Needs action" view holds: failed, past the promised
   * window, or never matched to a vendor. The board, the sidebar badge and the
   * overview row all call this, so the three can never disagree about how many
   * orders need someone.
   */
  ordersNeedingAction(now: number): AdminOrder[] {
    return this.orders().data.filter(o =>
      o.status === 'FAILED' || isStuck(o, now) || (isUnrouted(o) && !TERMINAL_ORDER_STATUSES.has(o.status)));
  }

  /** Uploaded documents lapsing inside `withinDays`, ignoring ones already reviewed away. */
  docsExpiring(now: number, withinDays = 30): ComplianceDoc[] {
    return this.expiringDocs().data.filter(d => {
      const days = daysUntilDate(d.expiresDate, now);
      return days !== null && days <= withinDays;
    });
  }

  /** Surge triggers running right now — the only honest answer to "is surge on". */
  liveSurge(now: number): SurgeTrigger[] {
    return this.surge().data.filter(t => {
      if (t.cancelledAt) return false;
      const started = (msUntil(t.activeFrom, now) ?? 0) <= 0;
      const ended = t.activeUntil !== null && (msUntil(t.activeUntil, now) ?? 1) <= 0;
      return started && !ended;
    });
  }

  /**
   * Every queue, counted once, most urgent first.
   *
   * `label` is the full sentence version — the sidebar renders its own short
   * nav names next to these counts, but never its own count.
   */
  queues(now: number): QueueCount[] {
    const breached = this.breachedComplaints(now).length;
    const atRisk = this.atRiskComplaints(now).length;
    const open = this.openComplaints().length;
    const needsAction = this.ordersNeedingAction(now).length;
    const waiting = this.pendingVendors().data.length;
    const fssai = this.fssaiWatch(now, 30).length;
    const docs = this.docsExpiring(now, 30).length;
    const refunds = this.refundsAwaiting().length;
    const claims = this.claimsAwaiting().length;

    return [
      {
        key: 'disputes',
        label: 'Disputes open',
        count: open,
        severity: breached > 0 ? 'crit' : atRisk > 0 ? 'warn' : open > 0 ? 'warn' : 'ok',
        loading: this.complaints().loading,
        error: this.complaints().error
      },
      {
        key: 'orders',
        label: 'Orders needing a rescue',
        count: needsAction,
        severity: needsAction > 0 ? 'crit' : 'ok',
        loading: this.orders().loading,
        error: this.orders().error
      },
      {
        key: 'vendors',
        label: 'Vendors waiting on verification',
        count: waiting,
        severity: waiting > 0 ? waitSeverity(this.longestVendorWait(now)) : 'ok',
        loading: this.pendingVendors().loading,
        error: this.pendingVendors().error
      },
      {
        key: 'compliance',
        label: 'Licences and documents lapsing in 30 days',
        count: fssai + docs,
        severity: fssai + docs > 0 ? expirySeverity(this.fssaiWatch(now, 30)[0]?.days ?? 30) : 'ok',
        loading: this.activeVendors().loading || this.expiringDocs().loading,
        error: this.activeVendors().error ?? this.expiringDocs().error
      },
      {
        key: 'refunds',
        label: 'Refunds awaiting approval',
        count: refunds,
        severity: refunds > 0 ? this.refundSeverity(now) : 'ok',
        loading: this.refunds().loading,
        error: this.refunds().error
      },
      {
        key: 'claims',
        label: 'Damage claims to arbitrate',
        count: claims,
        severity: claims > 0 ? 'warn' : 'ok',
        loading: this.claims().loading,
        error: this.claims().error
      }
    ];
  }

  /** A refund sitting past its 24h manual-review SLA (PRD §13.2) is critical. */
  private refundSeverity(now: number): Severity {
    const oldest = Math.max(0, ...this.refundsAwaiting()
      .map(r => now - Date.parse(r.requestedAt))
      .filter(n => Number.isFinite(n)));
    return oldest >= MS_DAY ? 'crit' : 'warn';
  }

  /**
   * Fetches only if the last load is older than `maxAgeMs`.
   *
   * The shell primes these queues once so the sidebar badges are populated
   * before the first click; the overview then reads the same signals instead of
   * firing all eight requests a second time on mount. The explicit Refresh
   * button still calls `refresh()` unconditionally.
   */
  refreshIfStale(maxAgeMs = 15_000) {
    const last = this.lastLoaded();
    if (last !== null && Date.now() - last < maxAgeMs) return;
    this.refresh();
  }

  /** Kicks off every queue fetch. Safe to call repeatedly; each slice resets itself. */
  refresh() {
    this.load(this.summary, this.api.get<AdminAnalyticsSummary>('/admin/analytics/summary'), null, 'the city summary');
    this.load(this.pendingVendors,
      this.api.get<Page<VendorResponse>>('/admin/vendors', { status: 'PENDING_VERIFICATION', page: 0, size: 100 }),
      [], 'the verification queue', r => r?.content ?? []);
    this.load(this.activeVendors,
      this.api.get<Page<VendorResponse>>('/admin/vendors', { status: 'ACTIVE', page: 0, size: 200 }),
      [], 'live vendors', r => r?.content ?? []);
    this.load(this.complaints,
      this.api.get<Complaint[]>('/admin/complaints', { page: 0, size: 100 }),
      [], 'the dispute queue', r => Array.isArray(r) ? r : []);
    this.load(this.orders,
      this.api.get<AdminOrder[]>('/admin/orders', { page: 0, size: 200 }),
      [], 'orders', r => Array.isArray(r) ? r : []);
    this.load(this.expiringDocs,
      this.api.get<ComplianceDoc[]>('/admin/compliance/expiring', { withinDays: 30 }),
      [], 'expiring documents', r => Array.isArray(r) ? r : []);
    this.load(this.refunds,
      this.api.get<Page<AdminRefund>>('/admin/refunds', { status: 'REQUESTED', page: 0, size: 100 }),
      [], 'the refund queue', r => r?.content ?? []);
    this.load(this.claims,
      this.api.get<Page<DamageClaim>>('/admin/claims', { page: 0, size: 100 }),
      [], 'damage claims', r => r?.content ?? []);
    // Whether surge is on is a fact about triggers, not about orders — see the
    // watchlist copy on the overview.
    this.load(this.surge,
      this.api.get<SurgeTrigger[]>('/admin/surge', { city: HOME_CITY, page: 0, size: 50 }),
      [], 'the surge state', r => Array.isArray(r) ? r : []);
    this.lastLoaded.set(Date.now());
  }

  private load<R, T>(
    target: WritableSignal<Slice<T>>,
    source: Observable<R>,
    seed: T,
    subject: string,
    project: (raw: R) => T = (raw) => raw as unknown as T
  ) {
    target.set({ data: seed, loading: true, error: null });
    source
      .pipe(
        map(raw => ({ ok: true as const, value: project(raw) })),
        catchError(err => of({ ok: false as const, message: describeError(err, subject) }))
      )
      .subscribe(result => {
        target.set(result.ok
          ? { data: result.value, loading: false, error: null }
          : { data: seed, loading: false, error: result.message });
      });
  }
}
