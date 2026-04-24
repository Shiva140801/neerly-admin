# Neerly Admin Portal — Development Rules

> Claude reads this first.

## What this is
Angular 18 web app for Neerly platform administrators. Desktop-first, Plus Jakarta Sans, purple accent, PrimeNG components.

Design tokens and CSS reference live in `neerly-backend/docs/DESIGN_SYSTEM.md` and `neerly-mobile/design-reference/design.css`.

## Stack
- Angular 18 (standalone components, no NgModules)
- TypeScript strict mode
- PrimeNG 17+ (lara-light-indigo base, overridden to admin-purple)
- RxJS
- SCSS with design tokens
- Angular Router with guards
- HttpClient interceptors for JWT + X-Request-Id + error envelope

## Package layout
```
src/
├── app/
│   ├── app.component.ts           # Shell
│   ├── app.routes.ts              # Route table
│   ├── core/
│   │   ├── auth/                  # login, TOTP, token store, guards, interceptors
│   │   ├── api/                   # Generated/typed API clients
│   │   ├── layout/                # Sidebar, topbar, breadcrumbs
│   │   └── util/
│   ├── features/
│   │   ├── dashboard/
│   │   ├── vendors/               # queue, detail, suspend
│   │   ├── disputes/              # workflow, SLA tracker
│   │   ├── compliance/            # expiring licenses
│   │   ├── pricing/               # price bands editor
│   │   ├── promos/
│   │   ├── refunds/
│   │   ├── payouts/
│   │   ├── surge/
│   │   ├── analytics/
│   │   ├── audit/
│   │   ├── team/                  # admin invites
│   │   └── config/
│   └── shared/
└── styles/
    ├── _tokens.scss               # From neerly design system
    ├── _primeng-overrides.scss
    └── styles.scss
```

## Rules
- **Standalone components only.** No `NgModule`.
- **OnPush** change detection everywhere.
- **Signals** for component state; RxJS for streams from HttpClient.
- **Route-level code splitting** with `loadChildren` / `loadComponent`.
- `authGuard` on every route outside `/login` and `/accept-invite`.
- `totpGuard` on routes that require fresh 2FA (e.g., /refunds approve).
- Every HTTP call goes through `ApiClient` wrapper that:
  - Adds `Authorization: Bearer <access>`
  - Adds `X-Request-Id` (new UUID per request)
  - On 401, calls `/api/v1/auth/refresh`; on refresh failure → logout
  - Maps error envelope to typed `NeerlyError`
- No hard-coded colors in templates. Use tokens.
- All admin mutations render a confirmation dialog.
- Every admin action links to `/audit?actorId=me` for self-review.

## Running
```bash
npm install
npm start        # http://localhost:4200
```
