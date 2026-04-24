import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { PriceBandResponse, UpsertPriceBandRequest } from './price-band.model';

@Injectable({ providedIn: 'root' })
export class PricingService {
  private api = inject(ApiClient);

  list(): Observable<PriceBandResponse[]> {
    return this.api.get('/admin/price-bands');
  }

  upsert(body: UpsertPriceBandRequest): Observable<PriceBandResponse> {
    return this.api.post('/admin/price-bands', body);
  }
}
