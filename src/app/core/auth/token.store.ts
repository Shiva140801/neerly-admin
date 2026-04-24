import { Injectable, signal } from '@angular/core';

const ACCESS = 'neerly.admin.access';
const REFRESH = 'neerly.admin.refresh';
const EXPIRES = 'neerly.admin.access.expires';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private accessSig = signal<string | null>(localStorage.getItem(ACCESS));
  private refreshSig = signal<string | null>(localStorage.getItem(REFRESH));
  private expiresSig = signal<number>(Number(localStorage.getItem(EXPIRES) ?? 0));

  readonly access = this.accessSig.asReadonly();
  readonly isAuthenticated = () => !!this.accessSig() && Date.now() < this.expiresSig();

  save(t: StoredTokens) {
    localStorage.setItem(ACCESS, t.accessToken);
    localStorage.setItem(REFRESH, t.refreshToken);
    localStorage.setItem(EXPIRES, String(t.expiresAt));
    this.accessSig.set(t.accessToken);
    this.refreshSig.set(t.refreshToken);
    this.expiresSig.set(t.expiresAt);
  }

  refreshToken(): string | null { return this.refreshSig(); }

  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    localStorage.removeItem(EXPIRES);
    this.accessSig.set(null);
    this.refreshSig.set(null);
    this.expiresSig.set(0);
  }
}
