import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';
import { describeActionError, describeError } from '../../shared/api-error';
import { EvidenceService } from '../../shared/evidence.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import { ConfirmDialogComponent, ConfirmRequest, ConfirmResult } from '../../shared/ui/confirm-dialog.component';

/** Mirror of backend `AdminDriverDocumentRow` — the review queue only holds SUBMITTED papers. */
export interface DriverDocRow {
  id: string;
  driverId: string;
  driverName?: string | null;
  type: 'DRIVING_LICENSE' | 'VEHICLE_RC' | 'VEHICLE_INSURANCE' | 'AADHAAR' | 'POLICE_VERIFICATION' | string;
  docNumber: string | null;
  s3Key: string;
  expiresOn: string | null;
  uploadedAt: string;
}

export const DOC_LABEL: Record<string, string> = {
  DRIVING_LICENSE: 'Driving licence', VEHICLE_RC: 'Vehicle RC', VEHICLE_INSURANCE: 'Insurance',
  AADHAAR: 'Aadhaar', POLICE_VERIFICATION: 'Police check'
};

/**
 * Driver papers waiting for a look, oldest first. Open the file, compare the number, then
 * approve or reject — a rejection reason is shown to the driver, so write it for them.
 * The backend lists only papers still to review; there is no history filter yet.
 */
@Component({
  selector: 'app-driver-docs',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="Driver" accent="papers"
      subtitle="Licences, RC, insurance, Aadhaar and police checks waiting for a decision. Oldest first.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div class="chips">
        <button type="button" class="chip" [class.active]="type() === null" (click)="type.set(null)">All</button>
        @for (t of types(); track t) {
          <button type="button" class="chip" [class.active]="type() === t" (click)="type.set(t)">{{ label(t) }}</button>
        }
      </div>
    </div>

    <div class="panel">
      @if (loading() || error() || visible().length === 0) {
        <app-data-state what="driver papers" [loading]="loading()" [error]="error()"
          emptyTitle="No driver papers waiting" [clear]="true" (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Uploaded</th><th>Paper</th><th>Number</th><th>Expires</th><th>Driver</th><th>File</th><th class="right"></th></tr></thead>
            <tbody>
              @for (d of visible(); track d.id) {
                <tr>
                  <td>{{ d.uploadedAt | when }}</td>
                  <td><strong>{{ label(d.type) }}</strong></td>
                  <td class="mono">{{ d.docNumber ?? '—' }}</td>
                  <td>{{ d.expiresOn ?? '—' }}</td>
                  <td>{{ d.driverName ?? d.driverId.slice(0, 8) }}</td>
                  <td>
                    @let f = evidence.link(d.s3Key)();
                    @if (f.state === 'ready') { <a [href]="f.url" target="_blank" rel="noopener">Open file ↗</a> }
                    @else if (f.state === 'loading') { <span class="sub-cell">Getting link…</span> }
                    @else {
                      <span class="mono">{{ evidence.fileName(d.s3Key) }}</span>
                      <div class="sub-cell">{{ f.reason }}</div>
                    }
                  </td>
                  <td class="right">
                    <span class="row-flex gap-6" style="justify-content:flex-end;">
                      <button type="button" class="btn btn--ok btn--sm" (click)="askApprove(d)" [disabled]="busy()">Approve…</button>
                      <button type="button" class="btn btn--danger btn--sm" (click)="askReject(d)" [disabled]="busy()">Reject…</button>
                    </span>
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
export class DriverDocsComponent {
  private api = inject(ApiClient);
  private toasts = inject(ToastService);
  readonly evidence = inject(EvidenceService);

  readonly rows = signal<DriverDocRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly confirm = signal<ConfirmRequest | null>(null);
  readonly type = signal<string | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  readonly types = computed(() => [...new Set(this.rows().map(r => r.type))]);
  readonly visible = computed(() => { const t = this.type(); return t ? this.rows().filter(r => r.type === t) : this.rows(); });

  constructor() { this.reload(); }

  label(t: string) { return DOC_LABEL[t] ?? t; }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<DriverDocRow[]>('/admin/driver-documents', { page: 0, size: 100 }).subscribe({
      next: rows => { this.rows.set(rows ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'driver papers')); this.loading.set(false); }
    });
  }

  askApprove(d: DriverDocRow) {
    this.confirm.set({
      title: `Approve ${this.label(d.type)}`,
      message: `${d.driverName ?? 'Driver ' + d.driverId.slice(0, 8)}${d.docNumber ? ' · ' + d.docNumber : ''}.`,
      consequence: 'Only approve after opening the file and checking the number and name match.',
      confirmLabel: 'Approve', tone: 'ok'
    });
    this.pending = () => this.review(d, true, null, `${this.label(d.type)} approved`);
  }

  askReject(d: DriverDocRow) {
    this.confirm.set({
      title: `Reject ${this.label(d.type)}`,
      message: `${d.driverName ?? 'Driver ' + d.driverId.slice(0, 8)}.`,
      consequence: 'The driver sees your reason and is asked to upload it again.',
      confirmLabel: 'Reject', tone: 'danger',
      reason: { label: 'Reason the driver will see', placeholder: 'e.g. Photo is blurred — the number can’t be read', required: true }
    });
    this.pending = r => this.review(d, false, r.reason, `${this.label(d.type)} rejected`);
  }

  run(r: ConfirmResult) { const p = this.pending; this.pending = null; p?.(r); }

  private review(d: DriverDocRow, approve: boolean, reason: string | null, done: string) {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.post<void>(`/admin/driver-documents/${d.id}/review`, { approve, reason }).subscribe({
      next: () => {
        this.busy.set(false); this.confirm.set(null);
        this.rows.update(all => all.filter(x => x.id !== d.id));
        this.toasts.success(done);
      },
      error: e => { this.busy.set(false); this.confirm.set(null); this.actionError.set(describeActionError(e, 'reviewing this paper')); }
    });
  }
}
