import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  Complaint, ComplaintMessage, ResolveRequest, TriageRequest
} from './complaint.model';

@Injectable({ providedIn: 'root' })
export class ComplaintService {
  private api = inject(ApiClient);

  list(page = 0, size = 20): Observable<Complaint[]> {
    return this.api.get('/admin/complaints', { page, size });
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
