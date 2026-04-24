import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ModerateReviewRequest, Review } from './review.model';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private api = inject(ApiClient);

  // There's no admin list endpoint for moderation — admin uses the vendor public feed
  // and moderation actions target individual review IDs. In practice admin pulls
  // flagged rows via /admin/reviews/flagged (future) or vendor feed.
  listForVendor(vendorId: string, page = 0, size = 20): Observable<Review[]> {
    return this.api.get(`/public/vendors/${vendorId}/reviews`, { page, size });
  }

  moderate(id: string, body: ModerateReviewRequest): Observable<Review> {
    return this.api.patch(`/admin/reviews/${id}/moderate`, body);
  }
}
