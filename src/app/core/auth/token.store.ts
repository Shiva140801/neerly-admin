import { Injectable, computed, signal } from '@angular/core';

const ACCESS = 'neerly.admin.access';
const REFRESH = 'neerly.admin.refresh';
const EXPIRES = 'neerly.admin.access.expires';
const DISPLAY_NAME = 'neerly.admin.displayName';

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
  private displayNameSig = signal<string | null>(localStorage.getItem(DISPLAY_NAME));

  /** The admin's own name, when the login response supplied one. */
  readonly displayName = this.displayNameSig.asReadonly();

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

  /**
   * The signed-in admin's own name.
   *
   * The JWT carries only `sub` and `role`, so the sidebar could show a role
   * where a person belongs — "Admin SUPER" tells you what you may do, never who
   * you are, and on a shared laptop that is the difference between an audit
   * trail you trust and one you do not. The login response does carry
   * `displayName`, so it is kept alongside the tokens and cleared with them.
   */
  saveProfile(displayName: string | null | undefined) {
    if (displayName) {
      localStorage.setItem(DISPLAY_NAME, displayName);
      this.displayNameSig.set(displayName);
    }
  }

  refreshToken(): string | null { return this.refreshSig(); }

  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    localStorage.removeItem(EXPIRES);
    localStorage.removeItem(DISPLAY_NAME);
    this.accessSig.set(null);
    this.refreshSig.set(null);
    this.expiresSig.set(0);
    this.displayNameSig.set(null);
  }
}
