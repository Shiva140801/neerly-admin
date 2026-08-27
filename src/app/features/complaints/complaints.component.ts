import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ComplaintService } from './complaint.service';
import type { Complaint, ComplaintPriority, ResolutionAction } from './complaint.model';
import { describeError } from '../../shared/api-error';
import { ClockService } from '../../shared/ui/clock.service';
import { DataStateComponent } from '../../shared/ui/data-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ConfirmDialogComponent, ConfirmRequest, ConfirmResult
} from '../../shared/ui/confirm-dialog.component';
import {
  MS_HOUR, Severity, SlaState, formatDuration, humanize, msSince, slaState
} from '../../shared/ui/urgency';

type Band = 'breached' | 'soon' | 'today' | 'later' | 'done';

interface Triaged extends Complaint {
  sla: SlaState;
  band: Band;
  ageMs: number | null;
  /** True while nobody has replied to the customer — PRD §13.6.1, 4h target. */
  awaitingFirstResponse: boolean;
}

const BAND_META: Record<Band, { label: string; blurb: string; severity: Severity }> = {
  breached: { label: 'Breached', blurb: 'Past the resolution deadline. Every one of these is a refund you will pay anyway — resolve, do not defend.', severity: 'crit' },
  soon:     { label: 'Under 4h', blurb: 'Inside the final four hours. These breach today unless you touch them.', severity: 'warn' },
  today:    { label: 'Due today', blurb: 'Deadline lands before midnight.', severity: 'warn' },
  later:    { label: 'Later', blurb: 'Comfortably inside SLA. Batch these.', severity: 'ok' },
  done:     { label: 'Resolved', blurb: 'Resolved and waiting to be closed out.', severity: 'ok' }
};

const BAND_ORDER: Band[] = ['breached', 'soon', 'today', 'later', 'done'];

/**
 * Dispute desk.
 *
 * The SLA is the product here: PRD §13.6.1 commits to a first response inside
 * four business hours and a routine resolution inside 24. The old screen showed
 * `slaDeadline` as a raw timestamp in insertion order, which means the admin had
 * to do date arithmetic on every row to find out what was on fire. This version
 * makes remaining time the sort key and the visual: tickets are bucketed by how
 * close they are to breach, the countdown ticks, and the queue opens on the
 * worst band that still has anything in it.
 */
@Component({
  selector: 'app-complaints',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, DataStateComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .layout { display: grid; grid-template-columns: minmax(340px, 400px) minmax(0, 1fr); gap: 20px; align-items: start; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }

    .queue { max-height: calc(100vh - 210px); overflow-y: auto; }

    .band-head {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: center; gap: 8px;
      padding: 9px 16px;
      background: var(--ink-50);
      border-bottom: 1px solid var(--ink-200);
      font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      color: var(--ink-600);
    }
    .band-head .n { margin-left: auto; font-variant-numeric: tabular-nums; }
    .band-head.crit { background: var(--err-soft); color: var(--err-ink); border-bottom-color: color-mix(in srgb, var(--err) 24%, transparent); }
    .band-head.warn { background: var(--warn-soft); color: var(--warn-ink); border-bottom-color: color-mix(in srgb, var(--warn) 26%, transparent); }

    .ticket {
      display: block; width: 100%; text-align: left;
      padding: 12px 16px; border: 0; border-bottom: 1px solid var(--ink-100);
      background: var(--paper); cursor: pointer; font: inherit;
      border-left: 3px solid transparent;
    }
    .ticket:hover { background: var(--ink-50); }
    .ticket.selected { background: var(--admn-softer); border-left-color: var(--admn); }
    .ticket.crit { border-left-color: var(--err); }
    .ticket.warn { border-left-color: var(--warn); }

    .t-top { display: flex; align-items: baseline; gap: 8px; }
    .t-subject { font-size: 13.5px; font-weight: 650; color: var(--ink-900); flex: 1; line-height: 1.35; }
    .t-clock {
      font-size: 12px; font-weight: 750; white-space: nowrap;
      font-variant-numeric: tabular-nums; color: var(--ink-500);
    }
    .t-clock.crit { color: var(--err); }
    .t-clock.warn { color: var(--warn); }
    .t-clock.ok   { color: var(--ok); }
    .t-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
    .t-age { font-size: 11.5px; color: var(--ink-500); }

    /* --- Detail --- */
    .detail-head { padding: 20px 22px 16px; border-bottom: 1px solid var(--ink-100); }
    .detail-head h2 {
      font-family: var(--font-serif); font-weight: 400; font-size: 25px;
      letter-spacing: -0.01em; color: var(--ink-900); margin: 0 0 8px; line-height: 1.2;
    }

    .sla-strip {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 22px; border-bottom: 1px solid var(--ink-100);
    }
    .sla-strip.crit { background: var(--err-soft); }
    .sla-strip.warn { background: var(--warn-soft); }
    .sla-strip.ok   { background: var(--ok-soft); }
    .sla-big {
      font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1;
    }
    .sla-strip.crit .sla-big, .sla-strip.crit .sla-sub { color: var(--err-ink); }
    .sla-strip.warn .sla-big, .sla-strip.warn .sla-sub { color: var(--warn-ink); }
    .sla-strip.ok   .sla-big, .sla-strip.ok   .sla-sub { color: var(--ok-ink); }
    .sla-sub { font-size: 12px; font-weight: 600; }
    .sla-meter {
      margin-left: auto; width: 120px; height: 5px; border-radius: var(--r-pill);
      background: color-mix(in srgb, var(--ink-900) 10%, transparent); overflow: hidden;
    }
    .sla-meter i { display: block; height: 100%; background: currentColor; }

    .desc {
      margin: 18px 22px; padding: 14px 16px;
      background: var(--ink-50); border-radius: var(--r-md);
      font-size: 13.5px; line-height: 1.6; color: var(--ink-800); white-space: pre-wrap;
    }

    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--ink-100); margin: 0 22px; border-radius: var(--r-sm); overflow: hidden; }
    .fact { background: var(--paper); padding: 10px 13px; }
    .fact .k { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-500); }
    .fact .v { font-size: 13px; color: var(--ink-900); font-weight: 600; margin-top: 3px; word-break: break-all; }

    .thread { margin: 20px 22px 0; }
    .msg { padding: 11px 14px; border-radius: var(--r-md); margin-bottom: 8px; background: var(--ink-50); }
    .msg.internal { background: var(--admn-softer); border: 1px dashed color-mix(in srgb, var(--admn) 34%, transparent); }
    .msg .who { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-500); }
    .msg .text { font-size: 13px; color: var(--ink-800); margin-top: 4px; line-height: 1.55; }

    .actions {
      display: flex; gap: 8px; flex-wrap: wrap;
      margin: 20px 22px 22px; padding-top: 18px; border-top: 1px solid var(--ink-100);
    }
    .resolve-form { margin: 0 22px 22px; padding: 16px; background: var(--ink-50); border-radius: var(--r-md); }
    .resolve-grid { display: grid; grid-template-columns: 1fr 160px; gap: 12px; }
  `],
  template: `
    <app-page-header
      title="Dispute" accent="desk"
      subtitle="First response inside 4 business hours, resolution inside 24. Sorted by time left, not by when it arrived.">
      <button type="button" class="btn btn--ghost btn--sm" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </app-page-header>

    @if (loading() || error() || items().length === 0) {
      <div class="panel">
        <app-data-state
          what="the dispute queue"
          [loading]="loading()" [error]="error()"
          emptyTitle="No open disputes"
          emptyDetail="Nothing is waiting on a decision. When a customer files, it lands here with its 24-hour clock already running."
          [clear]="true"
          (retry)="reload()" />
      </div>
    } @else {
      <div class="layout">
        <div class="panel queue">
          @for (band of visibleBands(); track band) {
            <div class="band-head"
                 [class.crit]="meta(band).severity === 'crit'"
                 [class.warn]="meta(band).severity === 'warn'">
              <span>{{ meta(band).label }}</span>
              <span class="n">{{ grouped()[band].length }}</span>
            </div>
            @for (t of grouped()[band]; track t.id) {
              <button type="button" class="ticket"
                      [class.selected]="selected()?.id === t.id"
                      [class.crit]="t.sla.severity === 'crit'"
                      [class.warn]="t.sla.severity === 'warn'"
                      (click)="select(t)">
                <span class="t-top">
                  <span class="t-subject">{{ t.subject }}</span>
                  <span class="t-clock" [class.crit]="t.sla.severity === 'crit'"
                        [class.warn]="t.sla.severity === 'warn'"
                        [class.ok]="t.sla.severity === 'ok'">{{ t.sla.label }}</span>
                </span>
                <span class="t-meta">
                  <span class="pill" [class.pill--crit]="t.priority === 'URGENT'"
                        [class.pill--warn]="t.priority === 'HIGH'"
                        [class.pill--mute]="t.priority === 'NORMAL' || t.priority === 'LOW'">{{ t.priority }}</span>
                  <span class="pill pill--outline">{{ label(t.category) }}</span>
                  @if (t.awaitingFirstResponse) {
                    <span class="pill pill--warn">No reply yet</span>
                  }
                  <span class="t-age">{{ t.ageMs !== null ? 'filed ' + age(t.ageMs) + ' ago' : '' }}</span>
                </span>
              </button>
            }
          }
        </div>

        @if (selected(); as s) {
          <div class="panel">
            <div class="detail-head">
              <h2>{{ s.subject }}</h2>
              <div class="row-flex gap-6" style="flex-wrap: wrap;">
                <span class="pill pill--brand">{{ label(s.status) }}</span>
                <span class="pill" [class.pill--crit]="s.priority === 'URGENT'"
                      [class.pill--warn]="s.priority === 'HIGH'"
                      [class.pill--mute]="s.priority === 'NORMAL' || s.priority === 'LOW'">{{ s.priority }}</span>
                <span class="pill pill--outline">{{ label(s.category) }}</span>
              </div>
            </div>

            <div class="sla-strip"
                 [class.crit]="detailSla().severity === 'crit'"
                 [class.warn]="detailSla().severity === 'warn'"
                 [class.ok]="detailSla().severity === 'ok'">
              <div>
                <div class="sla-big">{{ detailSla().label }}</div>
                <div class="sla-sub">
                  Resolution SLA · due {{ s.slaDeadline | date:'d MMM, HH:mm' }}
                  @if (s.firstResponseAt) { · first reply {{ s.firstResponseAt | date:'d MMM, HH:mm' }} }
                  @else { · no reply sent yet }
                </div>
              </div>
              <div class="sla-meter"><i [style.width.%]="slaPercent()"></i></div>
            </div>

            <div class="desc">{{ s.description }}</div>

            <div class="facts">
              <div class="fact"><div class="k">Filed</div><div class="v">{{ s.filedAt | date:'d MMM y, HH:mm' }}</div></div>
              <div class="fact"><div class="k">Customer</div><div class="v mono">{{ short(s.customerId) }}</div></div>
              <div class="fact"><div class="k">Vendor</div><div class="v mono">{{ s.vendorId ? short(s.vendorId) : 'unassigned' }}</div></div>
              <div class="fact"><div class="k">Order</div><div class="v mono">{{ s.orderId ? short(s.orderId) : 'not order-linked' }}</div></div>
              @if (s.evidencePhotos.length) {
                <div class="fact"><div class="k">Evidence</div><div class="v">{{ s.evidencePhotos.length }} photo{{ s.evidencePhotos.length === 1 ? '' : 's' }} attached</div></div>
              }
              @if (s.resolutionAction) {
                <div class="fact"><div class="k">Verdict</div><div class="v">{{ label(s.resolutionAction) }} · ₹{{ s.awardedAmount ?? 0 }}</div></div>
              }
            </div>

            @if (s.messages?.length) {
              <div class="thread">
                <div class="text-label" style="margin-bottom: 8px;">Thread</div>
                @for (m of s.messages; track m.id) {
                  <div class="msg" [class.internal]="m.isInternal">
                    <div class="who">{{ m.authorRole }}{{ m.isInternal ? ' · internal note' : '' }} · {{ m.createdAt | date:'d MMM, HH:mm' }}</div>
                    <div class="text">{{ m.message }}</div>
                  </div>
                }
              </div>
            }

            <div class="actions">
              @if (s.status === 'OPEN') {
                <button type="button" class="btn btn--ghost btn--sm" (click)="askTriage('HIGH')">Triage HIGH</button>
                <button type="button" class="btn btn--ghost btn--sm" (click)="askTriage('URGENT')">Triage URGENT</button>
              }
              @if (s.status === 'OPEN' || s.status === 'TRIAGED') {
                <button type="button" class="btn btn--primary btn--sm" (click)="askStart()">Start work</button>
              }
              @if (s.status === 'OPEN' || s.status === 'TRIAGED' || s.status === 'IN_PROGRESS') {
                <button type="button" class="btn btn--ok btn--sm" (click)="showResolveForm.set(!showResolveForm())">
                  {{ showResolveForm() ? 'Hide verdict form' : 'Resolve' }}
                </button>
              }
              @if (s.status === 'RESOLVED') {
                <button type="button" class="btn btn--primary btn--sm" (click)="askClose()">Close ticket</button>
              }
              @if (actionError(); as e) { <span class="pill pill--crit">{{ e }}</span> }
            </div>

            @if (showResolveForm()) {
              <div class="resolve-form">
                <div class="text-label" style="margin-bottom: 10px;">Verdict</div>
                <div class="resolve-grid">
                  <div>
                    <label class="field-label" for="cx-action">Resolution action</label>
                    <select id="cx-action" class="input" [(ngModel)]="resolveAction">
                      <option value="REFUND">Refund to source</option>
                      <option value="WALLET_CREDIT">Wallet credit</option>
                      <option value="REPLACEMENT">Replacement delivery</option>
                      <option value="VENDOR_PENALTY">Vendor penalty</option>
                      <option value="NO_ACTION">No action</option>
                    </select>
                  </div>
                  <div>
                    <label class="field-label" for="cx-amt">Awarded ₹</label>
                    <input id="cx-amt" class="input num" type="number" step="0.01" min="0" [(ngModel)]="resolveAmount" />
                  </div>
                </div>
                <label class="field-label mt-12" for="cx-notes">Notes to both parties</label>
                <textarea id="cx-notes" class="input" [(ngModel)]="resolveNotes"
                          placeholder="What you decided and why. Both the customer and the vendor see this."></textarea>
                <div class="mt-12">
                  <button type="button" class="btn btn--ok btn--sm" (click)="askResolve()">Review verdict…</button>
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="panel">
            <app-data-state
              emptyTitle="Pick a ticket"
              emptyDetail="The queue is ordered by time remaining. Start at the top — the ones above the fold are the ones that breach first." />
          </div>
        }
      </div>
    }

    <app-confirm-dialog [request]="confirm()" [busy]="busy()"
                        (confirmed)="runConfirmed($event)" (cancelled)="confirm.set(null)" />
  `
})
export class ComplaintsComponent {
  private service = inject(ComplaintService);
  private clock = inject(ClockService);

  loading = signal(true);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  items = signal<Complaint[]>([]);
  selected = signal<Complaint | null>(null);
  showResolveForm = signal(false);
  busy = signal(false);

  confirm = signal<ConfirmRequest | null>(null);
  private pending: ((r: ConfirmResult) => void) | null = null;

  resolveAction: ResolutionAction = 'WALLET_CREDIT';
  resolveAmount: number | null = null;
  resolveNotes = '';

  constructor() { this.reload(); }

  // --- derived view model -------------------------------------------------

  private triaged = computed<Triaged[]>(() => {
    const now = this.clock.now();
    return this.items().map(c => {
      const sla = slaState(c.slaDeadline, now, c.slaBreached);
      const open = c.status === 'OPEN' || c.status === 'TRIAGED' || c.status === 'IN_PROGRESS';
      let band: Band;
      if (!open) band = 'done';
      else if (sla.breached) band = 'breached';
      else if ((sla.remainingMs ?? Infinity) <= 4 * MS_HOUR) band = 'soon';
      else if ((sla.remainingMs ?? Infinity) <= 24 * MS_HOUR) band = 'today';
      else band = 'later';
      return {
        ...c,
        sla,
        band,
        ageMs: msSince(c.filedAt, now),
        awaitingFirstResponse: open && !c.firstResponseAt
      };
    });
  });

  readonly grouped = computed<Record<Band, Triaged[]>>(() => {
    const out: Record<Band, Triaged[]> = { breached: [], soon: [], today: [], later: [], done: [] };
    for (const t of this.triaged()) out[t.band].push(t);
    for (const band of BAND_ORDER) {
      out[band].sort((a, b) => (a.sla.remainingMs ?? Infinity) - (b.sla.remainingMs ?? Infinity));
    }
    return out;
  });

  readonly visibleBands = computed(() => BAND_ORDER.filter(b => this.grouped()[b].length > 0));

  readonly detailSla = computed<SlaState>(() => {
    const s = this.selected();
    return s ? slaState(s.slaDeadline, this.clock.now(), s.slaBreached)
             : { severity: 'idle', remainingMs: null, breached: false, label: '' };
  });

  /** Portion of the SLA window already burnt, for the meter. */
  readonly slaPercent = computed(() => {
    const s = this.selected();
    if (!s) return 0;
    const filed = Date.parse(s.filedAt);
    const due = Date.parse(s.slaDeadline);
    if (!Number.isFinite(filed) || !Number.isFinite(due) || due <= filed) return 100;
    const burnt = (this.clock.now() - filed) / (due - filed);
    return Math.max(0, Math.min(100, Math.round(burnt * 100)));
  });

  meta(band: Band) { return BAND_META[band]; }
  label(v: string) { return humanize(v); }
  age(ms: number) { return formatDuration(ms); }
  short(id: string) { return id.slice(0, 8); }

  // --- data ---------------------------------------------------------------

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(0, 100).subscribe({
      next: rows => {
        const list = Array.isArray(rows) ? rows : [];
        this.items.set(list);
        this.loading.set(false);
        this.clock.sync();
        const sel = this.selected();
        if (sel) {
          const fresh = list.find(r => r.id === sel.id);
          if (fresh) this.selected.set({ ...fresh, messages: sel.messages });
        }
      },
      error: e => {
        this.error.set(describeError(e, 'the dispute queue'));
        this.items.set([]);
        this.loading.set(false);
      }
    });
  }

  select(c: Complaint) {
    this.actionError.set(null);
    this.showResolveForm.set(false);
    this.selected.set(c);
    this.service.get(c.id).subscribe({
      next: full => this.selected.set(full),
      error: e => this.actionError.set(describeError(e, 'this ticket'))
    });
  }

  // --- mutations (every one goes through the confirm gate) -----------------

  askTriage(priority: ComplaintPriority) {
    const s = this.selected();
    if (!s) return;
    this.ask({
      title: `Triage as ${priority}`,
      message: `"${s.subject}" moves to ${priority} priority. This does not change the SLA deadline — it changes what you work first.`,
      confirmLabel: `Set ${priority}`,
      tone: 'primary'
    }, () => this.triage(priority));
  }

  askStart() {
    const s = this.selected();
    if (!s) return;
    this.ask({
      title: 'Start work',
      message: `Marks "${s.subject}" in progress and stamps your first response against the 4-hour target.`,
      confirmLabel: 'Start work',
      tone: 'primary'
    }, () => this.start());
  }

  askResolve() {
    const s = this.selected();
    if (!s) return;
    const amount = this.resolveAmount ?? 0;
    this.ask({
      title: 'Publish verdict',
      message: `${humanize(this.resolveAction)}${amount > 0 ? ` of ₹${amount}` : ''} on "${s.subject}".`,
      confirmLabel: 'Resolve ticket',
      tone: 'ok',
      consequence: 'Both the customer and the vendor are notified, and the decision is written to the append-only audit log.'
    }, () => this.submitResolve());
  }

  askClose() {
    const s = this.selected();
    if (!s) return;
    this.ask({
      title: 'Close ticket',
      message: `"${s.subject}" is closed for good. Closed tickets cannot be reopened by the customer.`,
      confirmLabel: 'Close ticket',
      tone: 'primary'
    }, () => this.close());
  }

  private ask(request: ConfirmRequest, run: () => void) {
    this.pending = () => run();
    this.confirm.set(request);
  }

  runConfirmed(_result: ConfirmResult) {
    const run = this.pending;
    this.confirm.set(null);
    this.pending = null;
    run?.(_result);
  }

  // The four calls below stay public and keep their original signatures — the
  // component spec drives them directly.
  triage(priority: ComplaintPriority) {
    const s = this.selected();
    if (!s) return;
    this.busy.set(true);
    this.service.triage(s.id, { priority }).subscribe({
      next: updated => { this.selected.set({ ...updated, messages: s.messages }); this.busy.set(false); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'this ticket')); this.busy.set(false); }
    });
  }

  start() {
    const s = this.selected();
    if (!s) return;
    this.busy.set(true);
    this.service.start(s.id).subscribe({
      next: updated => { this.selected.set(updated); this.busy.set(false); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'this ticket')); this.busy.set(false); }
    });
  }

  submitResolve() {
    const s = this.selected();
    if (!s) return;
    this.busy.set(true);
    this.service.resolve(s.id, {
      action: this.resolveAction,
      notes: this.resolveNotes || undefined,
      awardedAmount: this.resolveAmount ?? undefined
    }).subscribe({
      next: updated => {
        this.selected.set(updated);
        this.showResolveForm.set(false);
        this.busy.set(false);
        this.reload();
      },
      error: e => { this.actionError.set(describeError(e, 'this ticket')); this.busy.set(false); }
    });
  }

  close() {
    const s = this.selected();
    if (!s) return;
    this.busy.set(true);
    this.service.close(s.id).subscribe({
      next: updated => { this.selected.set(updated); this.busy.set(false); this.reload(); },
      error: e => { this.actionError.set(describeError(e, 'this ticket')); this.busy.set(false); }
    });
  }
}
