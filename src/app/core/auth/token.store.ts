import { Injectable, computed, signal } from '@angular/core';

const ACCESS = 'neerly.admin.access';
const REFRESH = 'neerly.admin.refresh';
const EXPIRES = 'neerly.admin.access.expires';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** The claims the admin portal reads off its own access token. */
export interface AdminIdentity {
  /** `sub` — the admin's user id, used to scope the audit log to themselves. */
  userId: string | null;
  /** `role` — the active role the token was minted for, e.g. ADMIN_SUPER. */
  role: string | null;
}

/**
 * Reads the identity claims out of a JWT without verifying it.
 *
 * Safe here because the token is only being used to label the UI and to
 * pre-fill an audit filter — every authorisation decision is still made
 * server-side against the signature. Returns nulls rather than throwing on a
 * malformed token so a stale localStorage entry cannot break the shell.
 */
export function readIdentity(token: string | null): AdminIdentity {
  if (!token) return { userId: null, role: null };
  try {
    const [, payload] = token.split('.');
    if (!payload) return { userId: null, role: null };
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { sub?: string; role?: string };
    return { userId: claims.sub ?? null, role: claims.role ?? null };
  } catch {
    return { userId: null, role: null };
  }
}

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private accessSig = signal<string | null>(localStorage.getItem(ACCESS));
  private refreshSig = signal<string | null>(localStorage.getItem(REFRESH));
  private expiresSig = signal<number>(Number(localStorage.getItem(EXPIRES) ?? 0));

  readonly access = this.accessSig.asReadonly();
  readonly isAuthenticated = () => !!this.accessSig() && Date.now() < this.expiresSig();

  /** Who the current token says we are — drives the sidebar identity and audit self-review. */
  readonly identity = computed<AdminIdentity>(() => readIdentity(this.accessSig()));

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
