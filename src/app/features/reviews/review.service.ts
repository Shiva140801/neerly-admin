import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ModerateReviewRequest, Review } from './review.model';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private api = inject(ApiClient);

  // Admin moderation queue — rows the spam detector flagged or anything still
  // PENDING_MODERATION, sorted by spam score descending.
  listFlagged(page = 0, size = 20): Observable<Review[]> {
    return this.api.get(`/admin/reviews/flagged`, { page, size });
  }

  // Per-vendor lookup — useful for spot-checks and the "view this vendor's
  // public feed" drawer.
  listForVendor(vendorId: string, page = 0, size = 20): Observable<Review[]> {
    return this.api.get(`/public/vendors/${vendorId}/reviews`, { page, size });
  }

  moderate(id: string, body: ModerateReviewRequest): Observable<Review> {
    return this.api.patch(`/admin/reviews/${id}/moderate`, body);
  }
}
