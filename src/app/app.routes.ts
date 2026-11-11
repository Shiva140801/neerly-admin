import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/roles';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./core/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./core/layout/shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'vendors', loadChildren: () => import('./features/vendors/vendors.routes').then(m => m.VENDOR_ROUTES) },
      { path: 'pricing', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/pricing/price-bands.component').then(m => m.PriceBandsComponent) },
      { path: 'disputes', loadComponent: () => import('./features/complaints/complaints.component').then(m => m.ComplaintsComponent) },
      { path: 'surge', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/surge/surge.component').then(m => m.SurgeComponent) },
      { path: 'promos', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/promos/promos.component').then(m => m.PromosComponent) },
      { path: 'refunds', loadComponent: () => import('./features/refunds/refunds.component').then(m => m.RefundsComponent) },
      { path: 'claims', loadComponent: () => import('./features/claims/claims.component').then(m => m.ClaimsComponent) },
      { path: 'compliance', loadComponent: () => import('./features/compliance/compliance.component').then(m => m.ComplianceComponent) },
      { path: 'reviews', loadComponent: () => import('./features/reviews/reviews.component').then(m => m.ReviewsComponent) },
      { path: 'notifications', loadComponent: () => import('./features/notifications/notifications.component').then(m => m.NotificationsComponent) },
      { path: 'payouts', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/payouts/payouts.component').then(m => m.PayoutsComponent) },
      { path: 'sos', loadComponent: () => import('./features/sos/sos.component').then(m => m.SosComponent) },
      { path: 'driver-papers', loadComponent: () => import('./features/driver-docs/driver-docs.component').then(m => m.DriverDocsComponent) },
      { path: 'code-overrides', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/code-overrides/code-overrides.component').then(m => m.CodeOverridesComponent) },
      { path: 'orders', loadComponent: () => import('./features/orders/orders.component').then(m => m.OrdersComponent) },
      { path: 'analytics', loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent) },
      { path: 'bank-accounts', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/bank-accounts/bank-accounts.component').then(m => m.BankAccountsComponent) },
      { path: 'withdrawals', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/withdrawals/withdrawals.component').then(m => m.WithdrawalsComponent) },
      { path: 'config', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/config/config.component').then(m => m.ConfigComponent) },
      { path: 'audit', canActivate: [roleGuard], data: { minRole: 'ADMIN_L2' }, loadComponent: () => import('./features/audit/audit.component').then(m => m.AuditComponent) },
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
