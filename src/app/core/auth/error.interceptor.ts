import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
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

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const tokens = inject(TokenStore);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const envelope = err.error as NeerlyErrorEnvelope | undefined;
      const code = envelope?.error?.code;

      if (err.status === 401 && code !== 'AUTH_REFRESH_REUSE_DETECTED') {
        // TODO: implement silent refresh + retry (next slice)
      }

      if (code === 'AUTH_REFRESH_REUSE_DETECTED' || code === 'AUTH_ADMIN_FROZEN') {
        tokens.clear();
        router.navigate(['/login'], { queryParams: { reason: code } });
      }

      return throwError(() => err);
    })
  );
};
