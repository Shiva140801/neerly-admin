import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    h1 { font-family: var(--font-serif); font-weight: 400; font-size: 38px; line-height: 1.05; letter-spacing: -0.01em;
         color: var(--ink-900); margin: 0 0 6px; }
    h1 em { color: var(--admn); font-style: italic; }
    .sub { color: var(--ink-600); font-size: 14px; margin-bottom: 28px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .card { background: var(--paper); border: 1px solid var(--ink-200); border-radius: var(--r-md);
            padding: 16px; box-shadow: var(--shadow-1); }
    .kpi-label { font-size: 11px; letter-spacing: 0.5px; color: var(--ink-500); font-weight: 600; }
    .kpi-value { font-size: 28px; font-weight: 800; margin-top: 4px; color: var(--ink-900); }
    .kpi-delta { font-size: 12px; color: var(--ok); font-weight: 600; margin-top: 2px; }
    .kpi-delta.warn { color: var(--warn); }
    .kpi-delta.err  { color: var(--err); }
  `],
  template: `
    <h1>City <em>pulse</em></h1>
    <div class="sub">Overview · Hyderabad · Live</div>

    <div class="kpis">
      <div class="card">
        <div class="kpi-label">GMV TODAY</div>
        <div class="kpi-value">₹—</div>
        <div class="kpi-delta">Backend wiring in next session</div>
      </div>
      <div class="card">
        <div class="kpi-label">ACTIVE ORDERS</div>
        <div class="kpi-value">—</div>
        <div class="kpi-delta">—</div>
      </div>
      <div class="card">
        <div class="kpi-label">ONLINE VENDORS</div>
        <div class="kpi-value">—</div>
        <div class="kpi-delta">—</div>
      </div>
      <div class="card">
        <div class="kpi-label">DISPUTES OPEN</div>
        <div class="kpi-value">—</div>
        <div class="kpi-delta">—</div>
      </div>
    </div>
  `
})
export class DashboardComponent {}
