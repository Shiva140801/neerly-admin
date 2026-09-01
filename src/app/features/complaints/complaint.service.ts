import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  Complaint, ComplaintMessage, ResolveRequest, TriageRequest
} from './complaint.model';

@Injectable({ providedIn: 'root' })
export class ComplaintService {
  private api = inject(ApiClient);

  /**
   * Open queue by default. Passing a decided status (RESOLVED, CLOSED) is what
   * makes a decision reachable again — a resolved ticket used to vanish from
   * every list, stranding the "Close ticket" step it still needed.
   */
  list(page = 0, size = 20, status?: string): Observable<Complaint[]> {
    return this.api.get('/admin/complaints', status ? { page, size, status } : { page, size });
  }

  get(id: string): Observable<Complaint> {
    return this.api.get(`/admin/complaints/${id}`);
  }

  triage(id: string, body: TriageRequest): Observable<Complaint> {
    return this.api.patch(`/admin/complaints/${id}/triage`, body);
  }

  start(id: string): Observable<Complaint> {
    return this.api.post(`/admin/complaints/${id}/start`);
  }

  resolve(id: string, body: ResolveRequest): Observable<Complaint> {
    return this.api.post(`/admin/complaints/${id}/resolve`, body);
  }

  close(id: string): Observable<Complaint> {
    return this.api.post(`/admin/complaints/${id}/close`);
  }

  appendMessage(id: string, message: string, isInternal = false): Observable<ComplaintMessage> {
    return this.api.post(`/admin/complaints/${id}/messages`, { message, isInternal });
  }
}
