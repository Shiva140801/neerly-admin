import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../core/api/api-client';
import { TokenStore } from '../../core/auth/token.store';
import { atLeast } from '../../core/auth/roles';
import { describeActionError, describeError } from '../../shared/api-error';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { WhenPipe } from '../../shared/ui/format.pipe';
import { ToastService } from '../../shared/ui/toast.service';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';

/** Mirror of backend `SettingView` (GET /admin/config). */
export interface Setting {
  key: string;
  category: string;
  label: string;
  description: string;
  type: 'DECIMAL' | 'INTEGER' | 'TIME' | 'BOOLEAN' | 'TEXT';
  unit: string | null;
  min: number | null;
  max: number | null;
  public: boolean;
  defaultValue: string;
  value: string;
  overridden: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface SettingChange {
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  changedBy: string | null;
  changedAt: string;
}

/**
 * Config — the business values that used to need a deploy: fees, delivery bands,
 * minimum order, cut-offs, windows, driver pay, refund and support promises.
 *
 * These move money for every customer at once, so the screen is built around
 * "what is it now, what was it, who changed it and why". Only a super-admin can
 * change a value; L2 can read. A change needs a reason and is recorded in the
 * setting's history and the audit log. Values marked "App" are shown to customers
 * through the app config, so they change what the app says on its next launch.
 */
@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .cats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .row-label { font-weight: 700; color: var(--ink-900); }
    .row-desc { font-size: 12.5px; color: var(--ink-600); line-height: 1.5; margin-top: 2px; max-width: 520px; }
    .val { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ink-900); white-space: nowrap; }
    .unit { font-size: 12px; font-weight: 600; color: var(--ink-500); margin-left: 4px; }
    .def { font-size: 12px; color: var(--ink-500); }
    .edit { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
    .edit input { width: 96px; }
    .hist { background: var(--ink-50); }
    .hist td { font-size: 12.5px; }
    .tag { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
           padding: 2px 7px; border-radius: var(--r-pill); background: var(--ink-100); color: var(--ink-700); }
    .tag.changed { background: var(--warn-soft); color: var(--warn-ink); }
  `],
  template: `
    <app-page-header
      title="Config" accent="levers"
      subtitle="Business values that apply to every order at once. Changes take effect within 30 seconds; values tagged App reach the customer app on its next launch.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    @if (!canEdit()) {
      <div class="lede">You can read these values. Only a super-admin can change them.</div>
    }

    <div class="cats">
      <button type="button" class="chip" [class.active]="category() === null" (click)="category.set(null)">
        All <span class="count">{{ settings().length }}</span>
      </button>
      @for (c of categories(); track c.name) {
        <button type="button" class="chip" [class.active]="category() === c.name" (click)="category.set(c.name)">
          {{ c.name }}
          @if (c.changed > 0) { <span class="count count--warn">{{ c.changed }} changed</span> }
        </button>
      }
    </div>

    <div class="panel">
      @if (loading() || error() || visible().length === 0) {
        <app-data-state what="settings" [loading]="loading()" [error]="error()"
                        emptyTitle="No settings in this group" (retry)="reload()" />
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Now</th>
                <th>Default</th>
                <th>Last change</th>
                <th class="right"></th>
              </tr>
            </thead>
            <tbody>
              @for (s of visible(); track s.key) {
                <tr>
                  <td>
                    <div class="row-label">{{ s.label }}
                      <span class="tag">{{ s.category }}</span>
                      @if (s.public) { <span class="tag" title="Shown to customers via the app config">App</span> }
                    </div>
                    <div class="row-desc">{{ s.description }}</div>
                    @if (s.min !== null || s.max !== null) {
                      <div class="def">Allowed {{ s.min ?? '—' }}–{{ s.max ?? '—' }}{{ s.unit ? ' ' + s.unit : '' }}</div>
                    }
                  </td>
                  <td>
                    <span class="val">{{ shownFor(s, s.value) }}</span><span class="unit">{{ s.unit }}</span>
                    @if (s.overridden) { <div><span class="tag changed">Changed</span></div> }
                  </td>
                  <td class="def">{{ shownFor(s, s.defaultValue) }} {{ s.unit }}</td>
                  <td class="def">{{ s.updatedAt ? (s.updatedAt | when) : '—' }}</td>
                  <td class="right">
                    @if (editing() === s.key) {
                      <span class="edit">
                        <input [attr.aria-label]="'New value for ' + s.label" [(ngModel)]="draft"
                               [attr.inputmode]="inputMode(s)"
                               [placeholder]="placeholder(s)" />
                        <button type="button" class="btn btn--primary btn--sm" (click)="askSave(s)" [disabled]="!draft.trim()">Save…</button>
                        <button type="button" class="btn btn--ghost btn--sm" (click)="editing.set(null)">Cancel</button>
                      </span>
                    } @else {
                      <span class="edit">
                        @if (canEdit()) {
                          @if (s.type === 'BOOLEAN') {
                            <button type="button" class="btn btn--ghost btn--sm" (click)="askToggle(s)">
                              {{ isOn(s.value) ? 'Turn off…' : 'Turn on…' }}</button>
                          } @else {
                            <button type="button" class="btn btn--ghost btn--sm" (click)="startEdit(s)">Change</button>
                          }
                          @if (s.overridden) {
                            <button type="button" class="btn btn--ghost btn--sm" (click)="askReset(s)">Use default</button>
                          }
                        }
                        <button type="button" class="btn btn--ghost btn--sm" (click)="toggleHistory(s)"
                                [attr.aria-expanded]="historyOf() === s.key">History</button>
                      </span>
                    }
                  </td>
                </tr>
                @if (historyOf() === s.key) {
                  <tr class="hist">
                    <td colspan="5">
                      @if (historyLoading()) { Loading history… }
                      @else if (history().length === 0) { Never changed — it has always been the default. }
                      @else {
                        <table class="data">
                          <tbody>
                            @for (h of history(); track h.changedAt) {
                              <tr>
                                <td>{{ h.changedAt | when }}</td>
                                <td>{{ h.oldValue ?? 'default' }} → <strong>{{ h.newValue ?? 'default' }}</strong></td>
                                <td>{{ h.reason ?? '—' }}</td>
                                <td class="mono">{{ h.changedBy?.slice(0, 8) ?? '—' }}</td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (actionError(); as e) {
      <div class="lede crit mt-16" role="alert">
        {{ e }}
        <button type="button" class="btn btn--ghost btn--sm" style="margin-left:10px;" (click)="actionError.set(null)">Dismiss</button>
      </div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busy()"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class ConfigComponent {
  private api = inject(ApiClient);
  private tokens = inject(TokenStore);
  private toasts = inject(ToastService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly settings = signal<Setting[]>([]);
  readonly category = signal<string | null>(null);
  readonly editing = signal<string | null>(null);
  readonly historyOf = signal<string | null>(null);
  readonly history = signal<SettingChange[]>([]);
  readonly historyLoading = signal(false);
  readonly confirm = signal<ConfirmRequest | null>(null);
  draft = '';
  private pending: ((r: ConfirmResult) => void) | null = null;

  readonly canEdit = computed(() => atLeast(this.tokens.identity().role, 'ADMIN_SUPER'));

  readonly categories = computed(() => {
    const out = new Map<string, number>();
    for (const s of this.settings()) out.set(s.category, (out.get(s.category) ?? 0) + (s.overridden ? 1 : 0));
    return [...out.entries()].map(([name, changed]) => ({ name, changed }));
  });

  readonly visible = computed(() => {
    const c = this.category();
    return c ? this.settings().filter(s => s.category === c) : this.settings();
  });

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<Setting[]>('/admin/config').subscribe({
      next: rows => { this.settings.set(rows ?? []); this.loading.set(false); },
      error: e => { this.error.set(describeError(e, 'settings')); this.loading.set(false); }
    });
  }

  startEdit(s: Setting) {
    this.draft = s.value;
    this.editing.set(s.key);
  }

  toggleHistory(s: Setting) {
    if (this.historyOf() === s.key) { this.historyOf.set(null); return; }
    this.historyOf.set(s.key);
    this.historyLoading.set(true);
    this.history.set([]);
    this.api.get<SettingChange[]>(`/admin/config/${s.key}/history`).subscribe({
      next: rows => { this.history.set(rows ?? []); this.historyLoading.set(false); },
      error: () => { this.history.set([]); this.historyLoading.set(false); }
    });
  }

  /** Numbers get the number pad; times and free text (e.g. the support phone) get letters. */
  inputMode(s: Setting): string {
    if (s.type === 'TEXT') return s.key.endsWith('phone') ? 'tel' : 'text';
    return s.type === 'TIME' ? 'text' : 'decimal';
  }

  placeholder(s: Setting): string {
    if (s.type === 'TIME') return 'HH:mm';
    if (s.type === 'TEXT') return s.key.endsWith('phone') ? '+91 40 1234 5678' : (s.value || 'Text');
    return s.value;
  }

  /** An empty TEXT value means "not set" (e.g. no support phone → the app hides the call button). */
  shown(v: string | null | undefined): string {
    return v === null || v === undefined || v === '' ? 'Not set' : v;
  }

  isOn(v: string | null | undefined): boolean { return (v ?? '').toLowerCase() === 'true'; }

  /** BOOLEAN settings read On/Off; everything else as stored ("Not set" when empty). */
  shownFor(s: Setting, v: string | null | undefined): string {
    if (s.type === 'BOOLEAN') return v === null || v === undefined || v === '' ? 'Not set' : this.isOn(v) ? 'On' : 'Off';
    return this.shown(v);
  }

  /** A switch has one possible change — flip it, with the same reason-required confirm. */
  askToggle(s: Setting) {
    this.draft = this.isOn(s.value) ? 'false' : 'true';
    this.askSave(s);
  }

  askSave(s: Setting) {
    const value = this.draft.trim();
    this.confirm.set({
      title: `Change ${s.label}`,
      message: `${s.label}: ${this.shownFor(s, s.value)} → ${this.shownFor(s, value)}${s.unit ? ' ' + s.unit : ''}.`,
      consequence: s.public
        ? 'Applies to every order within 30 seconds, and the customer app shows the new value on its next launch.'
        : 'Applies to every order within 30 seconds.',
      confirmLabel: 'Change it',
      tone: 'primary',
      reason: { label: 'Why', placeholder: 'This goes in the history and the audit log.', required: true }
    });
    this.pending = r => this.save(s, value, r.reason);
  }

  askReset(s: Setting) {
    this.confirm.set({
      title: `Reset ${s.label}`,
      message: `${s.label} goes back to the default, ${this.shownFor(s, s.defaultValue)}${s.unit ? ' ' + s.unit : ''} (now ${this.shownFor(s, s.value)}).`,
      confirmLabel: 'Use default',
      tone: 'primary',
      reason: { label: 'Why', placeholder: 'Recorded in the history.', required: true }
    });
    this.pending = r => this.reset(s, r.reason);
  }

  runConfirmed(result: ConfirmResult) {
    const run = this.pending;
    this.pending = null;
    run?.(result);
  }

  private save(s: Setting, value: string, reason: string) {
    this.busy.set(true);
    this.actionError.set(null);
    this.api.put<Setting>(`/admin/config/${s.key}`, { value, reason }).subscribe({
      next: updated => this.applied(updated, `${s.label} is now ${this.shownFor(s, updated.value)}${s.unit ? ' ' + s.unit : ''}`),
      error: e => this.failed(e, `changing ${s.label}`)
    });
  }

  private reset(s: Setting, reason: string) {
    this.busy.set(true);
    this.api.delete<Setting>(`/admin/config/${s.key}?reason=${encodeURIComponent(reason)}`).subscribe({
      next: updated => this.applied(updated, `${s.label} is back to the default, ${this.shownFor(s, updated.value)}${s.unit ? ' ' + s.unit : ''}`),
      error: e => this.failed(e, `resetting ${s.label}`)
    });
  }

  private applied(updated: Setting, message: string) {
    this.settings.update(all => all.map(x => x.key === updated.key ? updated : x));
    this.busy.set(false);
    this.confirm.set(null);
    this.editing.set(null);
    if (this.historyOf() === updated.key) this.historyOf.set(null);
    this.toasts.success(message, 'Recorded in the setting history and the audit log.');
  }

  private failed(e: unknown, attempt: string) {
    this.busy.set(false);
    this.confirm.set(null);
    // The server explains the range ("must be at most 28 %"); show it as-is.
    this.actionError.set(describeActionError(e, attempt));
  }
}
