import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { CreatePromoRequest, Promo } from './promo.model';

@Injectable({ providedIn: 'root' })
export class PromoService {
  private api = inject(ApiClient);

  list(page = 0, size = 50): Observable<Promo[]> {
    return this.api.get('/admin/promos', { page, size });
  }

  create(body: CreatePromoRequest): Observable<Promo> {
    return this.api.post('/admin/promos', body);
  }

  deactivate(id: string): Observable<Promo> {
    return this.api.post(`/admin/promos/${id}/deactivate`);
  }
}
