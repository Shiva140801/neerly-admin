import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ParamMap } from '@angular/router';
import { ApiClient } from '../../core/api/api-client';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { formatDuration, humanize, msSince } from '../../shared/ui/urgency';

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

/**
 * Append-only audit log.
 *
 * The table has an INSERT-only DB trigger, so this surface is deliberately
 * read-only — its whole value is being able to reconstruct "who did what to
 * this vendor / this order" after the fact, which is what the FSSAI and
 * consumer-forum obligations in PRD §6.3 actually require.
 *
 * Filters are pre-filled from the query string, so every screen that mutates
 * something can deep-link here scoped to the entity it just touched.
 */
@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .filters {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
      gap: 10px; align-items: end; margin-bottom: 18px;
    }
    @media (max-width: 1000px) { .filters { grid-template-columns: repeat(2, 1fr); } }

    .when { font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--ink-800); white-space: nowrap; }
    .ago { font-size: 11.5px; color: var(--ink-500); margin-top: 2px; }
    .action { font-weight: 700; color: var(--admn-dark); font-size: 12.5px; }
    pre {
      margin: 0; font-family: var(--font-mono); font-size: 11px; color: var(--ink-600);
      white-space: pre-wrap; word-break: break-word; max-width: 40ch;
    }
    .scoped {
      padding: 10px 14px; border-radius: var(--r-md); background: var(--admn-softer);
      color: var(--admn-dark); font-size: 12.5px; font-weight: 650; margin-bottom: 14px;
      display: flex; align-items: center; gap: 10px;
    }
  `],
  template: `
    <app-page-header
      title="Audit" accent="log"
      subtitle="Append-only. Every admin decision lands here with the actor, the target and the request id that produced it." />

    @if (scopeLabel(); as s) {
      <div class="scoped">
        <span>Scoped to {{ s }}</span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="clearFilters()">Clear scope</button>
      </div>
    }

    <div class="filters">
      <div>
        <label class="field-label" for="au-actor">Actor id</label>
        <input id="au-actor" class="input mono" [(ngModel)]="actorId" placeholder="UUID" />
      </div>
      <div>
        <label class="field-label" for="au-action">Action</label>
        <input id="au-action" class="input" [(ngModel)]="action" placeholder="ADMIN_LOGIN, COMPLAINT_RESOLVE…" />
      </div>
      <div>
        <label class="field-label" for="au-type">Target type</label>
        <input id="au-type" class="input" [(ngModel)]="targetType" placeholder="VENDOR, ORDER…" />
      </div>
      <div>
        <label class="field-label" for="au-target">Target id</label>
        <input id="au-target" class="input mono" [(ngModel)]="targetId" placeholder="UUID" />
      </div>
      <button type="button" class="btn btn--primary" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Searching…' : 'Search' }}
      </button>
    </div>

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the audit log"
          [loading]="loading()" [error]="error()"
          emptyTitle="No entries match"
          emptyDetail="The log only accepts a single filter dimension at a time — target type + id beats actor, which beats action. Try clearing the others."
          (retry)="reload()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th><th>Request</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td>
                  <div class="when">{{ r.timestamp | date:'d MMM y, HH:mm:ss' }}</div>
                  <div class="ago">{{ ago(r.timestamp) }}</div>
                </td>
                <td>
                  <div class="mono" style="font-size:12px;">{{ (r.actorId ?? '—').slice(0, 8) }}</div>
                  @if (r.actorRole) { <div class="sub-cell">{{ r.actorRole }}</div> }
                </td>
                <td><span class="action">{{ r.action }}</span></td>
                <td>
                  @if (r.targetEntityType) {
                    <div>{{ label(r.targetEntityType) }}</div>
                    <div class="sub-cell mono">{{ (r.targetEntityId ?? '').slice(0, 8) }}</div>
                  } @else { <span class="muted">—</span> }
                </td>
                <td>
                  @if (r.details) { <pre>{{ r.details | json }}</pre> }
                  @else { <span class="muted">—</span> }
                </td>
                <td>
                  <div class="mono" style="font-size:11px;color:var(--ink-500);">{{ r.requestId ? r.requestId.slice(0, 8) : '—' }}</div>
                  @if (r.ipAddress) { <div class="sub-cell mono">{{ r.ipAddress }}</div> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="text-meta mt-16">Showing the most recent {{ rows().length }} entries. Narrow with a filter to go further back.</p>
    }
  `
})
export class AuditComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private route = inject(ActivatedRoute);

  loading = signal(true);
  error = signal<string | null>(null);
  rows = signal<AuditRow[]>([]);

  actorId = '';
  action = '';
  targetType = '';
  targetId = '';

  private params = signal<ParamMap | null>(null);

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    this.params.set(q);
    if (q) {
      this.actorId = q.get('actorId') ?? '';
      this.action = q.get('action') ?? '';
      this.targetType = q.get('targetEntityType') ?? '';
      this.targetId = q.get('targetEntityId') ?? '';
    }
    this.reload();
  }

  readonly scopeLabel = computed(() => {
    const q = this.params();
    if (!q) return null;
    const type = q.get('targetEntityType');
    const id = q.get('targetEntityId');
    if (type && id) return `${humanize(type)} ${id.slice(0, 8)}`;
    const actor = q.get('actorId');
    if (actor) return `actor ${actor.slice(0, 8)}`;
    return null;
  });

  label(v: string) { return humanize(v); }
  ago(iso: string) {
    const ms = msSince(iso, this.clock.now());
    return ms === null ? '' : `${formatDuration(ms)} ago`;
  }

  clearFilters() {
    this.params.set(null);
    this.actorId = '';
    this.action = '';
    this.targetType = '';
    this.targetId = '';
    this.reload();
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    const params: Record<string, string> = { page: '0', size: '100' };
    if (this.actorId.trim())    params['actorId'] = this.actorId.trim();
    if (this.action.trim())     params['action'] = this.action.trim();
    if (this.targetType.trim()) params['targetEntityType'] = this.targetType.trim();
    if (this.targetId.trim())   params['targetEntityId'] = this.targetId.trim();
    this.api.get<AuditRow[]>('/admin/audit', params).subscribe({
      next: rows => { this.rows.set(Array.isArray(rows) ? rows : []); this.loading.set(false); this.clock.sync(); },
      error: e => {
        this.error.set(describeError(e, 'the audit log'));
        this.rows.set([]);
        this.loading.set(false);
      }
    });
  }
}
