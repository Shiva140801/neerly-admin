import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiClient, Page } from '../core/api/api-client';
import type { VendorResponse } from '../features/vendors/vendor.model';
import type { AdminOrder } from './attention.service';

export interface OrderRef {
  orderNumber: string;
  customerId: string;
  customerName: string | null;
  vendorId: string | null;
  vendorName: string | null;
}

/**
 * Names for the ids that arrive naked on the wire.
 *
 * Several payloads identify the two parties to a decision by UUID alone —
 * a refund names an `orderId` that cannot be reconciled with the `NEE-…` number
 * on the order board, a payout names a `vendorId`. Arbitrating between "vendor
 * a4b64aa2" and "customer 8c4cb9cf" is not a decision anyone can make.
 *
 * Where the payload itself carries a name (orders and compliance already do,
 * complaints and claims are gaining them) that name always wins — this service
 * is the fallback, and it resolves ids only against endpoints that exist:
 * `/admin/orders` for order numbers and customer names, `/admin/vendors` for
 * business names. Anything it cannot resolve stays a shortened id rather than
 * becoming a guess.
 */
@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private api = inject(ApiClient);

  private vendorNames = signal<Map<string, string>>(new Map());
  private orderRefs = signal<Map<string, OrderRef>>(new Map());
  private customerNames = signal<Map<string, string>>(new Map());
  private loadedAt: number | null = null;
  private inFlight = false;

  readonly ready = computed(() => this.orderRefs().size > 0 || this.vendorNames().size > 0);

  /**
   * Fetches the two lookup lists once per session (or after `maxAgeMs`).
   *
   * Cheap: both endpoints are already fetched by other screens, and the whole
   * Hyderabad book is a few dozen rows. Failures are swallowed on purpose — an
   * unresolvable name degrades a cell to a short id, it does not break a screen.
   */
  ensureLoaded(maxAgeMs = 120_000) {
    if (this.inFlight) return;
    if (this.loadedAt !== null && Date.now() - this.loadedAt < maxAgeMs) return;
    this.inFlight = true;

    // `/admin/vendors` returns nothing without a status, so the statuses that can
    // own a claim, a payout or an order are asked for explicitly.
    const vendorPage = (status: string) =>
      this.api.get<Page<VendorResponse>>('/admin/vendors', { status, page: 0, size: 200 })
        .pipe(map(p => p?.content ?? []), catchError(() => of([] as VendorResponse[])));

    forkJoin({
      active: vendorPage('ACTIVE'),
      suspended: vendorPage('SUSPENDED'),
      pending: vendorPage('PENDING_VERIFICATION'),
      orders: this.api.get<AdminOrder[]>('/admin/orders', { page: 0, size: 200 })
        .pipe(map(r => Array.isArray(r) ? r : []), catchError(() => of([] as AdminOrder[])))
    }).subscribe(({ active, suspended, pending, orders }) => {
      const vendors = new Map<string, string>();
      for (const v of [...active, ...suspended, ...pending]) vendors.set(v.id, v.businessName);

      const refs = new Map<string, OrderRef>();
      const customers = new Map<string, string>();
      for (const o of orders) {
        refs.set(o.id, {
          orderNumber: o.orderNumber,
          customerId: o.customerId,
          customerName: o.customerName ?? null,
          vendorId: o.vendorId,
          vendorName: o.vendorName ?? (o.vendorId ? vendors.get(o.vendorId) ?? null : null)
        });
        if (o.customerName) customers.set(o.customerId, o.customerName);
        if (o.vendorId && o.vendorName && !vendors.has(o.vendorId)) vendors.set(o.vendorId, o.vendorName);
      }

      this.vendorNames.set(vendors);
      this.orderRefs.set(refs);
      this.customerNames.set(customers);
      this.loadedAt = Date.now();
      this.inFlight = false;
    });
  }

  /** Every vendor the directory knows, by name — for pickers that must not take a UUID. */
  vendorOptions(): { id: string; name: string }[] {
    return [...this.vendorNames().entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  vendorName(id: string | null | undefined): string | null {
    return id ? this.vendorNames().get(id) ?? null : null;
  }

  customerName(id: string | null | undefined): string | null {
    return id ? this.customerNames().get(id) ?? null : null;
  }

  order(id: string | null | undefined): OrderRef | null {
    return id ? this.orderRefs().get(id) ?? null : null;
  }

  /** `NEE-26243-0002` when the order is known, otherwise null. */
  orderNumber(id: string | null | undefined): string | null {
    return this.order(id)?.orderNumber ?? null;
  }
}

/**
 * The one place the portal decides how to show a party it cannot name.
 *
 * A shortened UUID is still shown — it is the only handle the admin has for a
 * support ticket or a DB query — but it is prefixed so it never reads as a name,
 * and the caller's `kind` says who it is meant to be.
 */
export function unknownParty(kind: string, id: string | null | undefined): string {
  return id ? `unnamed ${kind} · ${id.slice(0, 8)}` : `no ${kind} on this record`;
}
