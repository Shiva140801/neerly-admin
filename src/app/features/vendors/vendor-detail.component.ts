import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { VendorService } from './vendor.service';
import type { VendorResponse } from './vendor.model';

@Component({
  selector: 'app-vendor-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 16px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
    .card { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
            padding: 20px; box-shadow: var(--shadow-1); margin-bottom: 16px; }
    .section-label { font-size: 11px; letter-spacing: 0.5px; color: var(--ink-500);
                     font-weight: 600; text-transform: uppercase; margin-bottom: 12px; }
    .row { display: flex; gap: 16px; margin-bottom: 12px; }
    .row-label { width: 180px; font-size: 13px; color: var(--ink-600); }
    .row-value { flex: 1; font-size: 14px; color: var(--ink-900); font-weight: 500; }
    .actions { display: flex; flex-direction: column; gap: 12px; }
    button.primary { background: var(--ok); color: #fff; border: 0; border-radius: var(--r-pill);
                     padding: 12px 18px; font-weight: 600; cursor: pointer; }
    button.danger { background: var(--err); color: #fff; border: 0; border-radius: var(--r-pill);
                    padding: 12px 18px; font-weight: 600; cursor: pointer; }
    button.warn { background: var(--warn); color: #fff; border: 0; border-radius: var(--r-pill);
                  padding: 12px 18px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    textarea { width: 100%; min-height: 80px; padding: 10px; border: 1px solid var(--ink-200);
               border-radius: var(--r-md); font: inherit; font-size: 14px; resize: vertical; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: var(--r-pill); font-size: 11px; font-weight: 600; }
    .pill.tier { background: var(--admn-soft); color: var(--admn-dark); }
    .pill.status { background: var(--warn-soft); color: var(--warn); }
  `],
  template: `
    @if (vendor(); as v) {
      <h1>{{ v.businessName }}</h1>
      <div style="margin-bottom: 24px;">
        <span class="pill tier">{{ v.tier }}</span>
        &nbsp;<span class="pill status">{{ v.status }}</span>
      </div>

      <div class="grid">
        <div>
          <div class="card">
            <div class="section-label">Business</div>
            <div class="row"><div class="row-label">Proprietor</div><div class="row-value">{{ v.proprietorName }}</div></div>
            <div class="row"><div class="row-label">Type</div><div class="row-value">{{ v.businessType }}</div></div>
            <div class="row"><div class="row-label">Categories</div><div class="row-value">{{ v.categories.join(', ') }}</div></div>
            <div class="row"><div class="row-label">City / Pincode</div><div class="row-value">{{ v.businessCity }} · {{ v.businessPincode }}</div></div>
            <div class="row"><div class="row-label">Serves pincodes</div><div class="row-value">{{ v.servicedPincodes.join(', ') }}</div></div>
          </div>

          <div class="card">
            <div class="section-label">Compliance</div>
            <div class="row"><div class="row-label">FSSAI number</div><div class="row-value">{{ v.fssaiNumber ?? '—' }}</div></div>
            <div class="row"><div class="row-label">FSSAI expires</div><div class="row-value">{{ v.fssaiExpiresAt ?? '—' }}</div></div>
            <div class="row"><div class="row-label">Joined</div><div class="row-value">{{ v.joinedAt | date:'medium' }}</div></div>
            @if (v.approvedAt) {
              <div class="row"><div class="row-label">Approved</div><div class="row-value">{{ v.approvedAt | date:'medium' }}</div></div>
            }
          </div>
        </div>

        <div>
          <div class="card">
            <div class="section-label">Actions</div>
            <div class="actions">
              @if (v.status === 'PENDING_VERIFICATION' || v.status === 'FSSAI_FILING') {
                <button class="primary" (click)="approve()" [disabled]="busy()">Approve vendor</button>
              }
              @if (v.status === 'PENDING_VERIFICATION' || v.status === 'APPLIED' || v.status === 'FSSAI_FILING') {
                <div>
                  <textarea [(ngModel)]="rejectReason" placeholder="Reason for rejection"></textarea>
                  <button class="danger" (click)="reject()" [disabled]="busy() || !rejectReason.trim()">Reject</button>
                </div>
              }
              @if (v.status === 'ACTIVE') {
                <div>
                  <textarea [(ngModel)]="suspendReason" placeholder="Reason for suspension"></textarea>
                  <button class="warn" (click)="suspend()" [disabled]="busy() || !suspendReason.trim()">Suspend</button>
                </div>
              }
            </div>
          </div>

          <div class="card">
            <div class="section-label">Stats</div>
            <div class="row"><div class="row-label">Total orders</div><div class="row-value">{{ v.totalOrders }}</div></div>
            <div class="row"><div class="row-label">Avg rating</div><div class="row-value">{{ v.avgRating ?? '—' }}</div></div>
          </div>
        </div>
      </div>
    } @else if (loading()) {
      <p>Loading…</p>
    }
  `
})
export class VendorDetailComponent implements OnInit {
  @Input({ required: true }) id!: string;

  private service = inject(VendorService);
  private router = inject(Router);

  vendor = signal<VendorResponse | null>(null);
  loading = signal(false);
  busy = signal(false);
  rejectReason = '';
  suspendReason = '';

  ngOnInit() {
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: v => { this.vendor.set(v); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  approve() {
    this.busy.set(true);
    this.service.approve(this.id, {}).subscribe({
      next: v => { this.vendor.set(v); this.busy.set(false); },
      error: () => this.busy.set(false)
    });
  }

  reject() {
    if (!this.rejectReason.trim()) return;
    this.busy.set(true);
    this.service.reject(this.id, { reason: this.rejectReason.trim() }).subscribe({
      next: v => { this.vendor.set(v); this.rejectReason = ''; this.busy.set(false); },
      error: () => this.busy.set(false)
    });
  }

  suspend() {
    if (!this.suspendReason.trim()) return;
    this.busy.set(true);
    this.service.suspend(this.id, { reason: this.suspendReason.trim() }).subscribe({
      next: v => { this.vendor.set(v); this.suspendReason = ''; this.busy.set(false); },
      error: () => this.busy.set(false)
    });
  }
}
