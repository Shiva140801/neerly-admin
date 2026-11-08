import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';
import { describeActionError } from '../../shared/api-error';
import { SosAlert, SosWatchService } from '../../shared/sos-watch.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import { ClockService } from '../../shared/ui/clock.service';
import { formatRelative, msSince } from '../../shared/ui/urgency';
import { ConfirmDialogComponent, ConfirmRequest, ConfirmResult } from '../../shared/ui/confirm-dialog.component';

/**
 * Driver SOS desk. A driver held the SOS button: the shop owner and every admin were told.
 * Call the driver, send help if needed, then resolve with what happened — the note is the
 * record. Refreshes every 15 seconds; the last-location age says whether the phone is
 * still sending.
 */
@Component({
  selector: 'app-sos',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .sos-card { border-left: 4px solid var(--err-ink); }
    .age-stale { color: var(--err-ink); font-weight: 700; }
  `],
  template: `
    <app-page-header title="Driver" accent="SOS"
      subtitle="A driver asked for help. Call them first, then resolve with what happened. Updates every 15 seconds.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="watch.refresh()">Refresh now</button>
    </app-page-header>

    <div class="panel">
      @if (watch.loading() || watch.error() || watch.open().length === 0) {
        <app-data-state what="SOS alerts" [loading]="watch.loading()" [error]="watch.error()"
          emptyTitle="No driver needs help right now" [clear]="true" (retry)="watch.refresh()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Raised</th><th>Driver</th><th>Shop</th><th>Order</th><th>Where</th><th>What they said</th><th class="right"></th></tr></thead>
            <tbody>
              @for (a of watch.open(); track a.id) {
                <tr class="sos-card">
                  <td><strong>{{ ago(a.raisedAt) }}</strong><div class="sub-cell">{{ a.raisedAt | when }}</div></td>
                  <td>{{ a.driverName ?? a.driverId.slice(0, 8) }}
                    @if (a.driverPhone) { <br><a [href]="'tel:' + a.driverPhone">{{ a.driverPhone }}</a> }</td>
                  <td>{{ a.vendorName ?? (a.vendorId?.slice(0, 8) ?? '—') }}</td>
                  <td class="mono">{{ a.orderNumber ?? (a.orderId?.slice(0, 8) ?? '—') }}</td>
                  <td>
                    <a [href]="mapsUrl(a)" target="_blank" rel="noopener">Open in Maps ↗</a>
                    <div class="sub-cell" [class.age-stale]="stale(a)">
                      last location {{ ago(a.lastLocationAt) }}{{ stale(a) ? ' — phone may be off' : '' }}
                    </div>
                  </td>
                  <td>{{ a.note || '—' }}</td>
                  <td class="right">
                    <button type="button" class="btn btn--ok btn--sm" (click)="askResolve(a)" [disabled]="busy()">Resolve…</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
    @if (actionError(); as e) { <div class="lede crit mt-16" role="alert">{{ e }}</div> }
    <app-confirm-dialog [request]="confirm()" [busy]="busy()" (confirmed)="run($event)" (cancelled)="confirm.set(null)" />
  `
})
export class SosComponent {
  readonly watch = inject(SosWatchService);
  private api = inject(ApiClient);
  private toasts = inject(ToastService);
  private clock = inject(ClockService);

  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  constructor() { this.watch.start(); }

  mapsUrl(a: SosAlert) { return `https://www.google.com/maps?q=${a.lat},${a.lng}`; }
  ago(iso: string) { const ms = msSince(iso, this.clock.now()); return ms === null ? '—' : formatRelative(ms); }
  /** No location for 2 minutes while the alert is open — the phone may be off or out of signal. */
  stale(a: SosAlert) { return (msSince(a.lastLocationAt, this.clock.now()) ?? 0) > 2 * 60_000; }

  askResolve(a: SosAlert) {
    this.confirm.set({
      title: 'Resolve SOS',
      message: `${a.driverName ?? 'Driver ' + a.driverId.slice(0, 8)} — raised ${this.ago(a.raisedAt)}.`,
      consequence: 'Only resolve once you have spoken to the driver or help has reached them. The note goes in the audit log.',
      confirmLabel: 'Resolve', tone: 'ok',
      reason: { label: 'What happened', placeholder: 'e.g. Called — minor fall, driver is fine, shop picked up the load', required: true }
    });
    this.pending = r => this.resolve(a, r.reason);
  }

  run(r: ConfirmResult) { const p = this.pending; this.pending = null; p?.(r); }

  private resolve(a: SosAlert, note: string) {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.post<SosAlert>(`/admin/sos/${a.id}/resolve`, { note }).subscribe({
      next: () => {
        this.busy.set(false); this.confirm.set(null);
        this.watch.removeLocally(a.id); this.watch.refresh();
        this.toasts.success('SOS resolved', 'Recorded with your note.');
      },
      error: e => { this.busy.set(false); this.confirm.set(null); this.actionError.set(describeActionError(e, 'resolving this SOS')); }
    });
  }
}
