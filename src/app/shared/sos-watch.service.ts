import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../core/api/api-client';
import { describeError } from './api-error';

/** Mirror of backend `SosResponse`. */
export interface SosAlert {
  id: string;
  driverId: string;
  vendorId: string | null;
  orderId: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vendorName?: string | null;
  orderNumber?: string | null;
  lat: number;
  lng: number;
  note: string | null;
  status: 'OPEN' | 'RESOLVED' | string;
  raisedAt: string;
  lastLocationAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

/**
 * Open driver SOS alerts, polled every 15 seconds for the whole signed-in session.
 *
 * Kept apart from AttentionService on purpose: an SOS is a person who may be hurt, not a
 * queue to triage. The sidebar badge and the SOS desk read this one list, so they can't
 * disagree, and the poll runs whichever screen the admin is on.
 */
@Injectable({ providedIn: 'root' })
export class SosWatchService {
  private api = inject(ApiClient);
  static readonly POLL_MS = 15_000;

  readonly open = signal<SosAlert[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly checkedAt = signal<number | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Idempotent: the shell calls it on entry; later calls only refresh. */
  start() {
    this.refresh();
    if (!this.timer) this.timer = setInterval(() => this.refresh(), SosWatchService.POLL_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  refresh() {
    this.api.get<SosAlert[]>('/admin/sos', { open: 'true', page: 0, size: 50 }).subscribe({
      next: rows => {
        this.open.set([...(rows ?? [])].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt)));
        this.loading.set(false); this.error.set(null); this.checkedAt.set(Date.now());
      },
      error: e => { this.error.set(describeError(e, 'SOS alerts')); this.loading.set(false); }
    });
  }

  /** Drop a resolved alert straight away; the next poll confirms. */
  removeLocally(id: string) { this.open.update(all => all.filter(a => a.id !== id)); }
}
