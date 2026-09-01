import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient, Page } from '../../core/api/api-client';
import type {
  ApproveVendorRequest, ReinstateVendorRequest, RejectVendorRequest,
  SuspendVendorRequest, VendorResponse, VendorStatus
} from './vendor.model';

@Injectable({ providedIn: 'root' })
export class VendorService {
  private api = inject(ApiClient);

  list(status: VendorStatus = 'PENDING_VERIFICATION', page = 0, size = 20): Observable<Page<VendorResponse>> {
    return this.api.get('/admin/vendors', { status, page, size });
  }

  get(id: string): Observable<VendorResponse> {
    return this.api.get(`/admin/vendors/${id}`);
  }

  approve(id: string, body: ApproveVendorRequest = {}): Observable<VendorResponse> {
    return this.api.post(`/admin/vendors/${id}/approve`, body);
  }

  reject(id: string, body: RejectVendorRequest): Observable<VendorResponse> {
    return this.api.post(`/admin/vendors/${id}/reject`, body);
  }

  suspend(id: string, body: SuspendVendorRequest): Observable<VendorResponse> {
    return this.api.post(`/admin/vendors/${id}/suspend`, body);
  }

  /** Puts a suspended vendor back into routing. The way out of a suspension. */
  reinstate(id: string, body: ReinstateVendorRequest): Observable<VendorResponse> {
    return this.api.post(`/admin/vendors/${id}/reinstate`, body);
  }
}
