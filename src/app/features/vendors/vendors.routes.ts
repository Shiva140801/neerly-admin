import { Routes } from '@angular/router';

export const VENDOR_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./vendor-queue.component').then(m => m.VendorQueueComponent) },
  { path: ':id', loadComponent: () => import('./vendor-detail.component').then(m => m.VendorDetailComponent) }
];
