import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, ReplaySubject, catchError, switchMap, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { TokenStore } from './token.store';

export interface NeerlyErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    timestamp: string;
  };
}

/** Shape of POST /auth/refresh — matches backend TokenPair. */
interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

/** Same key LoginComponent.loadDeviceId() writes. */
const DEVICE_ID_KEY = 'neerly.admin.deviceId';

/** Codes where re-login is the only way out — never attempt a refresh. */
const TERMINAL_AUTH_CODES = ['AUTH_REFRESH_REUSE_DETECTED', 'AUTH_ADMIN_FROZEN'];

/**
 * Single shared in-flight refresh. Module-level so concurrent 401s from
 * parallel requests coalesce into ONE POST /auth/refresh instead of a
 * stampede; late arrivals replay the fresh access token from the subject.
 */
let refreshInFlight: Observable<string> | null = null;

function refreshAccessToken(api: ApiClient, tokens: TokenStore): Observable<string> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = tokens.refreshToken();
  if (!refreshToken) return throwError(() => new Error('AUTH_NO_REFRESH_TOKEN'));

  const result = new ReplaySubject<string>(1);
  refreshInFlight = result.asObservable();

  api.post<RefreshResponse>('/auth/refresh', {
    refreshToken,
    deviceId: localStorage.getItem(DEVICE_ID_KEY)
  }).subscribe({
    next: resp => {
      tokens.save({
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken,
        expiresAt: Date.parse(resp.accessExpiresAt)
      });
      refreshInFlight = null;
      result.next(resp.accessToken);
      result.complete();
    },
    error: err => {
      refreshInFlight = null;
      result.error(err);
    }
  });

  return result.asObservable();
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const tokens = inject(TokenStore);
  const router = inject(Router);
  const api = inject(ApiClient);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const envelope = err.error as NeerlyErrorEnvelope | undefined;
      const code = envelope?.error?.code;

      // Terminal auth states: refreshing is pointless, force a clean re-login.
      if (code && TERMINAL_AUTH_CODES.includes(code)) {
        tokens.clear();
        router.navigate(['/login'], { queryParams: { reason: code } });
        return throwError(() => err);
      }

      // Expired/invalid access token on an API call: one silent refresh, then
      // retry the original request once with the new token. /auth/* endpoints
      // are excluded so a failing login/refresh/logout can never recurse.
      if (err.status === 401 && !req.url.includes('/auth/')) {
        return refreshAccessToken(api, tokens).pipe(
          catchError((refreshErr: unknown) => {
            // Refresh failed (or no refresh token): the session is dead.
            tokens.clear();
            const rCode = (refreshErr as HttpErrorResponse | undefined)?.error?.error?.code;
            if (rCode && TERMINAL_AUTH_CODES.includes(rCode)) {
              router.navigate(['/login'], { queryParams: { reason: rCode } });
            } else {
              router.navigate(['/login']);
            }
            return throwError(() => err); // surface the original 401
          }),
          // Errors rethrown above skip switchMap; only a fresh token lands here.
          switchMap(access =>
            next(req.clone({ setHeaders: { Authorization: `Bearer ${access}` } })))
        );
      }

      return throwError(() => err);
    })
  );
};
