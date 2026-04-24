import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { CreateSurgeRequest, SurgeTrigger } from './surge.model';

@Injectable({ providedIn: 'root' })
export class SurgeService {
  private api = inject(ApiClient);

  list(city: string, page = 0, size = 20): Observable<SurgeTrigger[]> {
    return this.api.get('/admin/surge', { city, page, size });
  }

  create(body: CreateSurgeRequest): Observable<SurgeTrigger> {
    return this.api.post('/admin/surge', body);
  }

  cancel(id: string): Observable<SurgeTrigger> {
    return this.api.post(`/admin/surge/${id}/cancel`);
  }
}
