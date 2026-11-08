import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Base URL is proxied via Angular dev-server in dev; same-origin in prod.
 * Adjust `API_ROOT` when deploying.
 */
export const API_ROOT = '/api/v1';

/** Canonical Neerly error envelope. */
export interface NeerlyErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
  timestamp: string;
}

/** Canonical page response wrapper matching backend `PageResponse<T>`. */
export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private http = inject(HttpClient);

  get<T>(path: string, params?: Record<string, string | number>): Observable<T> {
    return this.http.get<T>(`${API_ROOT}${path}`, {
      params: params ? new HttpParams({ fromObject: params as Record<string, string> }) : undefined
    });
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http.post<T>(`${API_ROOT}${path}`, body ?? {});
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(`${API_ROOT}${path}`, body ?? {});
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(`${API_ROOT}${path}`, body ?? {});
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${API_ROOT}${path}`);
  }
}
