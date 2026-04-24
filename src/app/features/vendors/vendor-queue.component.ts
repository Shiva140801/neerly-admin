import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VendorService } from './vendor.service';
import type { VendorResponse, VendorStatus } from './vendor.model';

@Component({
  selector: 'app-vendor-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .filters { display: flex; gap: 8px; margin-bottom: 24px; }
    .chip { padding: 8px 14px; border-radius: var(--r-pill); border: 1px solid var(--ink-200);
            background: var(--paper); font-size: 13px; font-weight: 500; color: var(--ink-700); cursor: pointer; }
    .chip.active { background: var(--admn-soft); color: var(--admn-dark); border-color: var(--admn); }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 16px; font-size: 14px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100); }
    tr:hover { background: var(--ink-50); }
    .pill { padding: 4px 10px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.pending { background: var(--warn-soft); color: var(--warn); }
    .pill.active { background: var(--ok-soft); color: var(--ok); }
    .pill.suspended { background: var(--err-soft); color: var(--err); }
    .pill.tier1 { background: var(--admn-soft); color: var(--admn-dark); }
    .pill.tier2 { background: var(--cust-soft); color: var(--cust-dark); }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <div class="header">
      <h1>Vendor <em>verifications</em></h1>
    </div>

    <div class="filters">
      @for (s of statuses; track s) {
        <button class="chip" [class.active]="selectedStatus() === s" (click)="selectedStatus.set(s); reload()">
          {{ labelFor(s) }}
        </button>
      }
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if ((vendors().content?.length ?? 0) === 0) {
      <div class="empty">No vendors in {{ labelFor(selectedStatus()) }}.</div>
    } @else {
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Tier</th>
              <th>Pincode</th>
              <th>FSSAI</th>
              <th>Submitted</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (v of vendors().content; track v.id) {
              <tr>
                <td>
                  <div style="font-weight: 600; color: var(--ink-900);">{{ v.businessName }}</div>
                  <div style="font-size: 12px; color: var(--ink-500);">{{ v.proprietorName }}</div>
                </td>
                <td>
                  <span class="pill" [class.tier1]="v.tier === 'TIER_1'" [class.tier2]="v.tier === 'TIER_2'">
                    {{ v.tier }}
                  </span>
                </td>
                <td>{{ v.businessPincode }}</td>
                <td>{{ v.fssaiNumber ?? '—' }}</td>
                <td>{{ v.joinedAt | date:'mediumDate' }}</td>
                <td>
                  <span class="pill"
                        [class.pending]="v.status === 'PENDING_VERIFICATION' || v.status === 'APPLIED'"
                        [class.active]="v.status === 'ACTIVE'"
                        [class.suspended]="v.status === 'SUSPENDED' || v.status === 'TIER_3_REJECTED'">
                    {{ v.status }}
                  </span>
                </td>
                <td>
                  <a [routerLink]="['/vendors', v.id]" style="color: var(--admn); font-weight: 600; text-decoration: none;">Review →</a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `
})
export class VendorQueueComponent {
  private service = inject(VendorService);

  statuses: VendorStatus[] = ['PENDING_VERIFICATION', 'APPLIED', 'ACTIVE', 'SUSPENDED', 'TIER_3_REJECTED'];
  selectedStatus = signal<VendorStatus>('PENDING_VERIFICATION');
  loading = signal(false);
  vendors = signal<{ content: VendorResponse[] }>({ content: [] });

  constructor() { this.reload(); }

  labelFor(s: VendorStatus): string {
    return s.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  reload() {
    this.loading.set(true);
    this.service.list(this.selectedStatus()).subscribe({
      next: (page) => { this.vendors.set(page); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
