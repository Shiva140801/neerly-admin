import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ComplaintService } from './complaint.service';
import type { Complaint, ComplaintPriority, ResolutionAction } from './complaint.model';

@Component({
  selector: 'app-complaints',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .layout { display: grid; grid-template-columns: 420px 1fr; gap: 24px; }
    .queue { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    .queue-header { padding: 14px 16px; border-bottom: 1px solid var(--ink-100); font-size: 11px;
                    letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-500); font-weight: 600; }
    .row { padding: 14px 16px; border-bottom: 1px solid var(--ink-100); cursor: pointer; }
    .row:hover { background: var(--ink-50); }
    .row.selected { background: var(--admn-softer); }
    .subject { font-weight: 600; color: var(--ink-900); font-size: 14px; }
    .meta { font-size: 12px; color: var(--ink-500); margin-top: 4px; display: flex; gap: 10px; align-items: center; }
    .pill { padding: 3px 8px; border-radius: var(--r-pill); font-size: 10px; font-weight: 600; }
    .pill.open { background: var(--warn-soft); color: var(--warn); }
    .pill.triaged { background: var(--cust-soft); color: var(--cust-dark); }
    .pill.progress { background: var(--admn-soft); color: var(--admn-dark); }
    .pill.resolved { background: var(--ok-soft); color: var(--ok); }
    .pill.closed { background: var(--ink-100); color: var(--ink-700); }
    .pill.urgent { background: var(--err-soft); color: var(--err); }
    .pill.high { background: var(--warn-soft); color: var(--warn); }
    .sla-breach { color: var(--err); font-weight: 600; }
    .detail { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
              box-shadow: var(--shadow-1); padding: 32px; }
    .detail h2 { font-family: var(--font-serif); font-size: 24px; margin: 0 0 8px; color: var(--ink-900); font-weight: 400; }
    .kv { display: grid; grid-template-columns: 120px 1fr; gap: 10px 16px; margin-top: 20px; font-size: 14px; }
    .kv dt { color: var(--ink-500); font-weight: 500; }
    .kv dd { margin: 0; color: var(--ink-900); }
    .desc { background: var(--ink-50); padding: 16px; border-radius: var(--r-md); margin-top: 20px;
            font-size: 14px; line-height: 1.6; color: var(--ink-800); }
    .actions { display: flex; gap: 12px; margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--ink-100); }
    button { padding: 10px 18px; border: none; border-radius: var(--r-sm); font-size: 14px;
             font-weight: 600; cursor: pointer; }
    button.primary { background: var(--admn); color: var(--paper); }
    button.secondary { background: var(--paper); color: var(--admn); border: 1px solid var(--admn); }
    button.danger { background: var(--err-soft); color: var(--err); border: 1px solid var(--err); }
    .resolve-form { margin-top: 20px; padding: 16px; background: var(--ink-50); border-radius: var(--r-md); }
    .resolve-form label { display: block; margin: 8px 0 4px; font-size: 12px; color: var(--ink-700); font-weight: 600; }
    .resolve-form select, .resolve-form input, .resolve-form textarea {
      width: 100%; padding: 8px 10px; border: 1px solid var(--ink-200); border-radius: var(--r-sm);
      font-size: 14px; background: var(--paper);
    }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
  `],
  template: `
    <h1>Complaints <em>queue</em></h1>
    <div class="layout">
      <div class="queue">
        <div class="queue-header">Open tickets ({{ items().length }})</div>
        @if (loading()) { <div class="empty">Loading…</div> }
        @else if (items().length === 0) { <div class="empty">Queue clear 🎉</div> }
        @else {
          @for (c of items(); track c.id) {
            <div class="row" [class.selected]="selected()?.id === c.id" (click)="select(c)">
              <div class="subject">{{ c.subject }}</div>
              <div class="meta">
                <span class="pill"
                      [class.open]="c.status === 'OPEN'"
                      [class.triaged]="c.status === 'TRIAGED'"
                      [class.progress]="c.status === 'IN_PROGRESS'"
                      [class.resolved]="c.status === 'RESOLVED'"
                      [class.closed]="c.status === 'CLOSED' || c.status === 'WITHDRAWN'">
                  {{ c.status }}
                </span>
                <span class="pill"
                      [class.urgent]="c.priority === 'URGENT'"
                      [class.high]="c.priority === 'HIGH'">
                  {{ c.priority }}
                </span>
                <span>{{ c.category }}</span>
                @if (c.slaBreached) { <span class="sla-breach">· SLA BREACHED</span> }
              </div>
            </div>
          }
        }
      </div>

      @if (selected(); as s) {
        <div class="detail">
          <h2>{{ s.subject }}</h2>
          <div style="color: var(--ink-500); font-size: 13px;">
            Filed {{ s.filedAt | date:'medium' }} · SLA due {{ s.slaDeadline | date:'medium' }}
            @if (s.slaBreached) { <span class="sla-breach"> · BREACHED</span> }
          </div>

          <div class="desc">{{ s.description }}</div>

          <dl class="kv">
            <dt>Category</dt><dd>{{ s.category }}</dd>
            <dt>Status</dt><dd>{{ s.status }}</dd>
            <dt>Priority</dt><dd>{{ s.priority }}</dd>
            <dt>Customer</dt><dd>{{ s.customerId }}</dd>
            @if (s.vendorId) { <dt>Vendor</dt><dd>{{ s.vendorId }}</dd> }
            @if (s.orderId) { <dt>Order</dt><dd>{{ s.orderId }}</dd> }
            @if (s.resolutionAction) {
              <dt>Action</dt><dd>{{ s.resolutionAction }} · ₹{{ s.awardedAmount ?? 0 }}</dd>
            }
          </dl>

          <div class="actions">
            @if (s.status === 'OPEN') {
              <button class="secondary" (click)="triage('HIGH')">Triage as HIGH</button>
              <button class="secondary" (click)="triage('URGENT')">Triage as URGENT</button>
            }
            @if (s.status === 'OPEN' || s.status === 'TRIAGED') {
              <button class="primary" (click)="start()">Start work</button>
            }
            @if (s.status === 'IN_PROGRESS' || s.status === 'TRIAGED' || s.status === 'OPEN') {
              <button class="primary" (click)="showResolveForm.set(!showResolveForm())">Resolve</button>
            }
            @if (s.status === 'RESOLVED') {
              <button class="secondary" (click)="close()">Close ticket</button>
            }
          </div>

          @if (showResolveForm()) {
            <div class="resolve-form">
              <label>Action</label>
              <select [(ngModel)]="resolveAction">
                <option value="REFUND">Refund</option>
                <option value="WALLET_CREDIT">Wallet credit</option>
                <option value="REPLACEMENT">Replacement</option>
                <option value="VENDOR_PENALTY">Vendor penalty</option>
                <option value="NO_ACTION">No action</option>
              </select>
              <label>Awarded amount (₹)</label>
              <input type="number" step="0.01" [(ngModel)]="resolveAmount" />
              <label>Notes</label>
              <textarea rows="3" [(ngModel)]="resolveNotes"></textarea>
              <div style="margin-top: 12px;">
                <button class="primary" (click)="submitResolve()">Confirm resolve</button>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="detail empty">Select a ticket to inspect</div>
      }
    </div>
  `
})
export class ComplaintsComponent {
  private service = inject(ComplaintService);

  loading = signal(true);
  items = signal<Complaint[]>([]);
  selected = signal<Complaint | null>(null);
  showResolveForm = signal(false);

  resolveAction: ResolutionAction = 'WALLET_CREDIT';
  resolveAmount: number | null = null;
  resolveNotes = '';

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  select(c: Complaint) {
    this.service.get(c.id).subscribe(full => this.selected.set(full));
    this.showResolveForm.set(false);
  }

  triage(priority: ComplaintPriority) {
    const s = this.selected();
    if (!s) return;
    this.service.triage(s.id, { priority }).subscribe(updated => {
      this.selected.set({ ...updated, messages: s.messages });
      this.reload();
    });
  }

  start() {
    const s = this.selected();
    if (!s) return;
    this.service.start(s.id).subscribe(updated => { this.selected.set(updated); this.reload(); });
  }

  submitResolve() {
    const s = this.selected();
    if (!s) return;
    this.service.resolve(s.id, {
      action: this.resolveAction,
      notes: this.resolveNotes || undefined,
      awardedAmount: this.resolveAmount ?? undefined
    }).subscribe(updated => {
      this.selected.set(updated);
      this.showResolveForm.set(false);
      this.reload();
    });
  }

  close() {
    const s = this.selected();
    if (!s) return;
    this.service.close(s.id).subscribe(updated => { this.selected.set(updated); this.reload(); });
  }
}
