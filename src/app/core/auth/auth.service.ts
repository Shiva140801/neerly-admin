import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { TokenStore } from './token.store';

/**
 * Calls the backend admin auth endpoints and persists the returned JWT +
 * refresh into TokenStore. The two-step flow is:
 *   1. startLogin(email, firebaseIdToken, deviceId) -> { totpChallengeId }
 *   2. verifyTotp(challengeId, code) -> persists tokens and returns the user
 *
 * firebaseIdToken is obtained client-side with the Firebase Web SDK after the
 * admin enters email+password. That SDK call isn't wired here — for dev we
 * can point at a mock Firebase emulator or stub the token server-side; for
 * prod the Web SDK is configured in environment.ts.
 */
export interface TotpChallenge {
  totpChallengeId: string;
  expiresAt: string;
}

export interface ExchangeResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  activeRole: string;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    phoneMask: string;
  };
  grantedRoles: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiClient);
  private tokens = inject(TokenStore);

  startLogin(email: string, firebaseIdToken: string, deviceId: string): Observable<TotpChallenge> {
    return this.api.post<TotpChallenge>('/auth/admin/login', {
      email,
      firebaseIdToken,
      deviceId
    });
  }

  verifyTotp(totpChallengeId: string, code: string): Observable<ExchangeResponse> {
    return this.api.post<ExchangeResponse>('/auth/admin/totp-verify', {
      totpChallengeId,
      code
    }).pipe(map((resp) => {
      this.tokens.save({
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken,
        expiresAt: Date.parse(resp.accessExpiresAt)
      });
      return resp;
    }));
  }

  logout(): Observable<void> {
    const refresh = this.tokens.refreshToken();
    this.tokens.clear();
    if (!refresh) return new Observable((s) => { s.next(); s.complete(); });
    return this.api.post<void>('/auth/logout', { refreshToken: refresh });
  }
}
