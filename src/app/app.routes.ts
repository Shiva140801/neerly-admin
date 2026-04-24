import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

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
      { path: 'pricing', loadComponent: () => import('./features/pricing/price-bands.component').then(m => m.PriceBandsComponent) },
      { path: 'disputes', loadComponent: () => import('./features/complaints/complaints.component').then(m => m.ComplaintsComponent) },
      { path: 'surge', loadComponent: () => import('./features/surge/surge.component').then(m => m.SurgeComponent) },
      { path: 'promos', loadComponent: () => import('./features/promos/promos.component').then(m => m.PromosComponent) },
      { path: 'refunds', loadComponent: () => import('./features/refunds/refunds.component').then(m => m.RefundsComponent) },
      { path: 'claims', loadComponent: () => import('./features/claims/claims.component').then(m => m.ClaimsComponent) },
      { path: 'compliance', loadComponent: () => import('./features/compliance/compliance.component').then(m => m.ComplianceComponent) },
      { path: 'reviews', loadComponent: () => import('./features/reviews/reviews.component').then(m => m.ReviewsComponent) },
      { path: 'notifications', loadComponent: () => import('./features/notifications/notifications.component').then(m => m.NotificationsComponent) },
      { path: 'payouts', loadComponent: () => import('./features/payouts/payouts.component').then(m => m.PayoutsComponent) },
      { path: 'orders', loadComponent: () => import('./features/orders/orders.component').then(m => m.OrdersComponent) },
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
