import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../core/api/api-client';
import { describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';

/** Mirror of backend `CodeOverrideWatchRow`. */
export interface CodeOverrideRow { vendorId: string; vendorName: string | null; overrides: number; flagged: boolean }

/**
 * Shops that confirmed deliveries without the customer's code after it locked. Each one
 * is audited and the customer is told, but a shop that does it often may be handing jars
 * over without the customer there — flagged shops (more than 3 in 7 days) need a call.
 */
@Component({
  selector: 'app-code-overrides',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, DataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`tr.row-crit td { background: var(--err-soft); }`],
  template: `
    <app-page-header title="Code" accent="overrides"
      subtitle="Deliveries a shop confirmed without the customer's code. More than 3 in 7 days is flagged.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    <div class="toolbar">
      <div class="chips">
        @for (d of windows; track d) {
          <button type="button" class="chip" [class.active]="days() === d" (click)="days.set(d); reload()">Last {{ d }} days</button>
        }
      </div>
    </div>

    <div class="panel">
      @if (loading() || error() || rows().length === 0) {
        <app-data-state what="code overrides" [loading]="loading()" [error]="error()"
          emptyTitle="No shop confirmed a delivery without the code" [clear]="true" (retry)="reload()" />
      } @else {
        @if (flaggedCount() > 0) {
          <div class="lede crit" role="status">{{ flaggedCount() }} {{ flaggedCount() === 1 ? 'shop is' : 'shops are' }} flagged — check with them.</div>
        }
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Shop</th><th class="num">Overrides</th><th>Status</th></tr></thead>
            <tbody>
              @for (r of sorted(); track r.vendorId) {
                <tr [class.row-crit]="r.flagged">
                  <td><strong>{{ r.vendorName ?? r.vendorId.slice(0, 8) }}</strong></td>
                  <td class="num">{{ r.overrides }}</td>
                  <td>
                    @if (r.flagged) { <span class="pill pill--crit">Flagged</span> }
                    @else { <span class="pill">Within limit</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `
})
export class CodeOverridesComponent {
  private api = inject(ApiClient);
  readonly windows = [7, 30] as const;
  readonly days = signal<number>(7);
  readonly rows = signal<CodeOverrideRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly sorted = computed(() => [...this.rows()].sort((a, b) =>
    Number(b.flagged) - Number(a.flagged) || b.overrides - a.overrides));
  readonly flaggedCount = computed(() => this.rows().filter(r => r.flagged).length);

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<CodeOverrideRow[]>('/admin/orders/code-overrides', { days: this.days() }).subscribe({
      next: rows => { this.rows.set(rows ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'code overrides')); this.loading.set(false); }
    });
  }
}
