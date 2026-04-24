import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPageComponent } from '../../core/placeholder/placeholder-page.component';

/**
 * Admin orders dashboard. The backend ships the data (order events +
 * status history + payment rows) but we don't ship a bespoke grid in
 * V1 — the ops team uses the Vendors queue → vendor detail to spot-check
 * orders, and pulls ad-hoc SQL for reconciliation. Full admin orders
 * grid is tracked for V1.1.
 */
@Component({
  selector: 'app-orders-admin',
  standalone: true,
  imports: [PlaceholderPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-placeholder-page
      title="Orders"
      subtitle="Backend exposes order data via the vendor-scoped queue and per-order GET endpoints. A cross-vendor admin grid is scheduled for V1.1."
    />
  `
})
export class OrdersComponent {}
