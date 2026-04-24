import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPageComponent } from '../../core/placeholder/placeholder-page.component';

/**
 * Admin vendor payouts view. The weekly T+3 batch is driven server-side by
 * `PayoutService.runBatch()`; manual admin triggers + a status grid arrive
 * in V1.1 once we've wired Razorpay Payouts X in production.
 */
@Component({
  selector: 'app-payouts',
  standalone: true,
  imports: [PlaceholderPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-placeholder-page
      title="Payouts"
      subtitle="Weekly T+3 payouts run server-side via PayoutService. Manual trigger UI + status grid are scheduled for V1.1 post Razorpay Payouts X go-live."
    />
  `
})
export class PayoutsComponent {}
