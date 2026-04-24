# Neerly Admin Portal

Angular 18 web app for platform administrators.

## Quick start

```bash
npm install
npm start              # http://localhost:4200
```

Login flow (stubbed in Session 1):
1. Email + password → Firebase email/password SDK (to be wired).
2. TOTP 6-digit code → `POST /api/v1/auth/admin/totp-verify`.
3. Lands on dashboard shell.

## Design tokens

Imported from `neerly-mobile/design-reference/design.css` via `src/styles/_tokens.scss`.
Admin accent = purple `#7B2CBF`. Keep role chips for vendor/customer/driver contexts when showing their data.

## Roles

Every admin has `ADMIN_L1`, `ADMIN_L2`, or `ADMIN_SUPER`. JWT carries the active role. TOTP required to switch between admin sub-roles.

Route guards:
- `authGuard` — any authenticated admin.
- `totpGuard` — fresh 2FA (reserved for dangerous ops like refund approvals).
