import { Pipe, PipeTransform } from '@angular/core';
import { WhenStyle, formatCount, formatRupees, formatWhen } from './format';

/**
 * `{{ order.placedAt | when }}` → `23 Aug 2026, 13:41`
 * `{{ doc.expiresDate | when:'date' }}` → `17 Sep 2026`
 *
 * A pipe rather than a bare call so templates read the same as they did with
 * Angular's `date` pipe, but every screen resolves to the same format string.
 */
@Pipe({ name: 'when', standalone: true })
export class WhenPipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, style: WhenStyle = 'datetime'): string {
    return formatWhen(value, style);
  }
}

/** `{{ order.totalAmount | rupees }}` → `₹770` / `₹385.50`. */
@Pipe({ name: 'rupees', standalone: true })
export class RupeesPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatRupees(value);
  }
}

/** `{{ vendor.totalOrders | count }}` → `1,24,500`. */
@Pipe({ name: 'count', standalone: true })
export class CountPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatCount(value);
  }
}
