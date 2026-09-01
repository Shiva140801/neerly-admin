import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiClient, Page } from '../../core/api/api-client';
import { describeError } from '../../shared/api-error';
import { label as enumLabel } from '../../shared/labels';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { formatDuration, msSince } from '../../shared/ui/urgency';

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

/** Filter state, held in one object so a query-param change can replace it wholesale. */
interface Filters {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { actorId: '', action: '', targetType: '', targetId: '', from: '', to: '' };

/**
 * Append-only audit log.
 *
 * The table has an INSERT-only DB trigger, so this surface is deliberately
 * read-only — its whole value is being able to reconstruct "who did what to
 * this vendor / this order" after the fact, which is what the FSSAI and
 * consumer-forum obligations in PRD §6.3 actually require.
 *
 * Filters track the query string *reactively*. They used to be read once in the
 * constructor, which works on a cold load and silently does nothing on an
 * in-place navigation — so the sidebar's "Review my own actions" link, and every
 * screen's deep link into an entity's history, appeared to do nothing at all
 * whenever the audit screen was already open. Six screens point here as their
 * safety net.
 */
@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .filters {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px; align-items: end; margin-bottom: 14px;
    }
    @media (max-width: 900px) { .filters { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) { .filters { grid-template-columns: 1fr; } }
    .filter-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }

    .when { font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--ink-800); white-space: nowrap; }
    .ago { font-size: 11.5px; color: var(--ink-500); margin-top: 2px; }
    .action { font-weight: 700; color: var(--admn-dark); font-size: 12.5px; }
    .detail-list { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: 11.5px; max-width: 40ch; }
    .detail-list dt { color: var(--ink-500); font-weight: 600; }
    .detail-list dd { margin: 0; color: var(--ink-700); word-break: break-word; }
    .scoped {
      padding: 10px 14px; border-radius: var(--r-md); background: var(--admn-softer);
      color: var(--admn-dark); font-size: 12.5px; font-weight: 650; margin-bottom: 14px;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .pager { display: flex; align-items: center; gap: 12px; font-size: 12.5px; color: var(--ink-600); }
  `],
  template: `
    <app-page-header
      title="Audit" accent="log"
      subtitle="Append-only, newest first. Every admin decision lands here with the actor, the target and the request id that produced it." />

    @if (scopeLabel(); as s) {
      <div class="scoped">
        <span>Scoped to {{ s }}</span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="clearFilters()">Clear scope</button>
      </div>
    }

    <div class="filters">
      <div>
        <label class="field-label" for="au-actor">Who did it</label>
        <input id="au-actor" class="input mono" [(ngModel)]="f.actorId" placeholder="Admin id" />
      </div>
      <div>
        <label class="field-label" for="au-action">What they did</label>
        <input id="au-action" class="input" [(ngModel)]="f.action" placeholder="ADMIN_LOGIN, COMPLAINT_RESOLVE…" />
      </div>
      <div>
        <label class="field-label" for="au-type">What it was done to</label>
        <input id="au-type" class="input" [(ngModel)]="f.targetType" placeholder="VENDOR, ORDER…" />
      </div>
      <div>
        <label class="field-label" for="au-target">Which one</label>
        <input id="au-target" class="input mono" [(ngModel)]="f.targetId" placeholder="Target id" />
      </div>
      <div>
        <label class="field-label" for="au-from">From</label>
        <input id="au-from" class="input" type="date" [(ngModel)]="f.from" />
      </div>
      <div>
        <label class="field-label" for="au-to">To</label>
        <input id="au-to" class="input" type="date" [(ngModel)]="f.to" />
      </div>
    </div>

    <div class="filter-actions">
      <button type="button" class="btn btn--primary" (click)="search()" [disabled]="loading()">
        {{ loading() ? 'Searching…' : 'Search' }}
      </button>
      <button type="button" class="btn btn--ghost" (click)="today()">Today</button>
      <button type="button" class="btn btn--ghost" (click)="lastDays(7)">Last 7 days</button>
      @if (anyFilter()) {
        <button type="button" class="btn btn--ghost" (click)="clearFilters()">Clear all</button>
      }
    </div>

    @if (loading() || error() || rows().length === 0) {
      <div class="panel">
        <app-data-state
          what="the audit log"
          [loading]="loading()" [error]="error()"
          emptyTitle="No entries match"
          emptyDetail="Nothing was recorded for this combination of who, what and when. Widen the date range, or clear a filter."
          (retry)="search()" />
      </div>
    } @else {
      <div class="panel table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>When</th><th>Who</th><th>Did what</th><th>To</th><th>Detail</th><th>Request</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td>
                  <div class="when">{{ r.timestamp | when }}</div>
                  <div class="ago">{{ ago(r.timestamp) }}</div>
                </td>
                <td>
                  @if (r.actorRole) { <div>{{ label(r.actorRole) }}</div> }
                  <div class="sub-cell mono">{{ r.actorId ? r.actorId.slice(0, 8) : 'system' }}</div>
                </td>
                <td><span class="action">{{ label(r.action) }}</span></td>
                <td>
                  @if (r.targetEntityType) {
                    <div>{{ label(r.targetEntityType) }}</div>
                    <div class="sub-cell mono">{{ (r.targetEntityId ?? '').slice(0, 8) }}</div>
                  } @else { <span class="muted">—</span> }
                </td>
                <td>
                  @if (detailPairs(r); as pairs) {
                    @if (pairs.length) {
                      <dl class="detail-list">
                        @for (p of pairs; track p.k) { <dt>{{ p.k }}</dt><dd>{{ p.v }}</dd> }
                      </dl>
                    } @else { <span class="muted">—</span> }
                  }
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

      <div class="pager mt-16">
        <button type="button" class="btn btn--ghost btn--sm" (click)="prev()" [disabled]="page() === 0 || loading()">‹ Newer</button>
        <span>
          @if (total() !== null) {
            Entries {{ page() * pageSize + 1 }}–{{ page() * pageSize + rows().length }} of {{ total() }}
          } @else {
            Page {{ page() + 1 }} · {{ rows().length }} entries
          }
        </span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="next()" [disabled]="!hasNext() || loading()">Older ›</button>
      </div>
    }
  `
})
export class AuditComponent {
  private api = inject(ApiClient);
  private clock = inject(ClockService);
  private route = inject(ActivatedRoute);

  readonly pageSize = 50;

  loading = signal(true);
  error = signal<string | null>(null);
  rows = signal<AuditRow[]>([]);
  page = signal(0);
  total = signal<number | null>(null);
  hasNext = signal(false);

  f: Filters = { ...EMPTY };

  private params = signal<ParamMap | null>(null);

  constructor() {
    // Reactive, not a one-shot snapshot: navigating here from a screen that is
    // already showing the audit log has to re-apply the new scope.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(q => {
      const scoped = q.keys.length > 0;
      this.params.set(scoped ? q : null);
      this.f = {
        actorId: q.get('actorId') ?? '',
        action: q.get('action') ?? '',
        targetType: q.get('targetEntityType') ?? '',
        targetId: q.get('targetEntityId') ?? '',
        from: q.get('from') ?? '',
        to: q.get('to') ?? ''
      };
      this.page.set(0);
      this.reload();
    });
  }

  label(v: string) { return enumLabel(v); }

  ago(iso: string) {
    const ms = msSince(iso, this.clock.now());
    return ms === null ? '' : `${formatDuration(ms)} ago`;
  }

  anyFilter(): boolean {
    return Object.values(this.f).some(v => v.trim().length > 0);
  }

  readonly scopeLabel = computed(() => {
    const q = this.params();
    if (!q) return null;
    const type = q.get('targetEntityType');
    const id = q.get('targetEntityId');
    if (type && id) return `${enumLabel(type)} ${id.slice(0, 8)}`;
    const actor = q.get('actorId');
    if (actor) return `everything done by admin ${actor.slice(0, 8)}`;
    return null;
  });

  /**
   * `details` as readable rows rather than a JSON blob. Keys are the backend's,
   * so they are shown as-is where no friendlier name exists — but the braces,
   * quotes and nesting that made the old `| json` column unreadable are gone.
   */
  detailPairs(r: AuditRow): { k: string; v: string }[] {
    if (!r.details) return [];
    return Object.entries(r.details).map(([k, v]) => ({
      k: k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
      v: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    }));
  }

  today() {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10);
    this.f.from = iso;
    this.f.to = iso;
    this.search();
  }

  lastDays(n: number) {
    const to = new Date();
    const from = new Date(to.getTime() - n * 86_400_000);
    this.f.from = from.toISOString().slice(0, 10);
    this.f.to = to.toISOString().slice(0, 10);
    this.search();
  }

  search() { this.page.set(0); this.reload(); }

  clearFilters() {
    this.params.set(null);
    this.f = { ...EMPTY };
    this.search();
  }

  prev() { if (this.page() > 0) { this.page.update(p => p - 1); this.reload(); } }
  next() { if (this.hasNext()) { this.page.update(p => p + 1); this.reload(); } }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    const params: Record<string, string> = { page: String(this.page()), size: String(this.pageSize) };
    if (this.f.actorId.trim())    params['actorId'] = this.f.actorId.trim();
    if (this.f.action.trim())     params['action'] = this.f.action.trim();
    if (this.f.targetType.trim()) params['targetEntityType'] = this.f.targetType.trim();
    if (this.f.targetId.trim())   params['targetEntityId'] = this.f.targetId.trim();
    // Whole days, inclusive: `to` is the end of the chosen date, not its midnight.
    if (this.f.from.trim())       params['from'] = `${this.f.from.trim()}T00:00:00Z`;
    if (this.f.to.trim())         params['to'] = `${this.f.to.trim()}T23:59:59Z`;

    this.api.get<Page<AuditRow> | AuditRow[]>('/admin/audit', params).subscribe({
      next: res => {
        // The endpoint returns a paged envelope; older builds returned a bare
        // list, so both shapes are accepted rather than blanking the screen.
        if (Array.isArray(res)) {
          this.rows.set(res);
          this.total.set(null);
          this.hasNext.set(res.length >= this.pageSize);
        } else {
          this.rows.set(res?.content ?? []);
          this.total.set(res?.totalElements ?? null);
          this.hasNext.set(res?.hasNext ?? false);
        }
        this.loading.set(false);
        this.clock.sync();
      },
      error: e => {
        this.error.set(describeError(e, 'the audit log'));
        this.rows.set([]);
        this.total.set(null);
        this.hasNext.set(false);
        this.loading.set(false);
      }
    });
  }
}
