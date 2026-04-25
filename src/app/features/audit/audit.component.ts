import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';

interface AuditRow {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  ipAddress: string | null;
  requestId: string | null;
  details: Record<string, unknown> | null;
  timestamp: string;
}

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 32px; margin: 0 0 24px; color: var(--ink-900); }
    h1 em { color: var(--admn); font-style: italic; }
    .filters { display: flex; gap: 12px; margin-bottom: 24px; align-items: end; flex-wrap: wrap; }
    .filters label { display: block; font-size: 11px; color: var(--ink-500); text-transform: uppercase;
                     letter-spacing: .5px; font-weight: 600; margin-bottom: 4px; }
    .filters input { padding: 8px 10px; border: 1px solid var(--ink-200); border-radius: var(--r-sm);
                     font-size: 13px; background: var(--paper); min-width: 200px; }
    button.primary { padding: 8px 14px; background: var(--admn); color: #fff; border: 0;
                     border-radius: var(--r-sm); font-size: 13px; font-weight: 600; cursor: pointer; }
    .table { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
             box-shadow: var(--shadow-1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
         color: var(--ink-500); font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--ink-100); }
    td { padding: 12px 16px; font-size: 13px; color: var(--ink-800); border-bottom: 1px solid var(--ink-100);
         vertical-align: top; }
    .mono { font-family: var(--font-mono); font-size: 12px; color: var(--ink-500); }
    .action { font-weight: 600; color: var(--admn-dark); }
    .empty { padding: 48px; text-align: center; color: var(--ink-500); font-size: 14px; }
    pre { margin: 0; font-size: 11px; color: var(--ink-500); white-space: pre-wrap; word-break: break-word; }
  `],
  template: `
    <h1>Audit <em>log</em></h1>

    <div class="filters">
      <div>
        <label>Actor id</label>
        <input [(ngModel)]="actorId" placeholder="UUID" />
      </div>
      <div>
        <label>Action</label>
        <input [(ngModel)]="action" placeholder="USER_LOGIN, COMPLAINT_RESOLVE…" />
      </div>
      <div>
        <label>Target type</label>
        <input [(ngModel)]="targetType" placeholder="vendor, order…" />
      </div>
      <div>
        <label>Target id</label>
        <input [(ngModel)]="targetId" placeholder="UUID" />
      </div>
      <button class="primary" (click)="reload()">Filter</button>
    </div>

    @if (loading()) { <div class="empty">Loading…</div> }
    @else if (rows().length === 0) { <div class="empty">No audit entries match.</div> }
    @else {
      <div class="table">
        <table>
          <thead><tr>
            <th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th>
          </tr></thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td class="mono">{{ r.timestamp.replace('T', ' ').slice(0, 19) }}</td>
                <td>
                  <div class="mono">{{ (r.actorId ?? '—').slice(0, 8) }}</div>
                  <div style="color: var(--ink-500); font-size: 11px;">{{ r.actorRole ?? '' }}</div>
                </td>
                <td><span class="action">{{ r.action }}</span></td>
                <td>
                  @if (r.targetEntityType) {
                    <div>{{ r.targetEntityType }}</div>
                    <div class="mono">{{ (r.targetEntityId ?? '').slice(0, 8) }}</div>
                  } @else { — }
                </td>
                <td>
                  @if (r.details) {
                    <pre>{{ r.details | json }}</pre>
                  } @else { — }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `
})
export class AuditComponent {
  private api = inject(ApiClient);
  loading = signal(true);
  rows = signal<AuditRow[]>([]);

  actorId = '';
  action = '';
  targetType = '';
  targetId = '';

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    const params: Record<string, string> = { page: '0', size: '100' };
    if (this.actorId.trim())    params['actorId'] = this.actorId.trim();
    if (this.action.trim())     params['action'] = this.action.trim();
    if (this.targetType.trim()) params['targetEntityType'] = this.targetType.trim();
    if (this.targetId.trim())   params['targetEntityId'] = this.targetId.trim();
    this.api.get<AuditRow[]>('/admin/audit', params).subscribe({
      next: rows => { this.rows.set(Array.isArray(rows) ? rows : []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }
}
