import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStore } from './token.store';

/** Admin levels, lowest first. The backend gates on the same three (`@PreAuthorize`). */
export type AdminRole = 'ADMIN_L1' | 'ADMIN_L2' | 'ADMIN_SUPER';
const RANK: Record<string, number> = { ADMIN_L1: 1, ADMIN_L2: 2, ADMIN_SUPER: 3 };

/** True when [role] is at least [min]. An unknown or missing role reaches nothing gated. */
export function atLeast(role: string | null | undefined, min: AdminRole): boolean {
  return (RANK[role ?? ''] ?? 0) >= RANK[min];
}

/**
 * Route guard for a minimum admin level, set as `data: { minRole: 'ADMIN_L2' }`. An L1
 * admin used to open an L2 screen and meet a wall of 403s; now the link isn't shown and a
 * typed URL lands on the dashboard.
 */
export const roleGuard: CanActivateFn = route => {
  const min = route.data?.['minRole'] as AdminRole | undefined;
  if (!min) return true;
  const role = inject(TokenStore).identity().role;
  return atLeast(role, min) ? true : inject(Router).createUrlTree(['/dashboard']);
};
