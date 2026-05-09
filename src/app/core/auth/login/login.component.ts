import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';

/**
 * Admin login — three steps:
 *   1. Email + password (Firebase Web SDK → ID token, then POST /auth/admin/login)
 *   2. TOTP challenge → POST /auth/admin/totp-verify → persist JWT
 *   3. Navigate to /dashboard
 *
 * Firebase Web SDK wiring lives in `core/auth/firebase-client.ts` — in dev the
 * backend accepts a bypass when `firebase.enabled=false` so the end-to-end
 * flow can be exercised without Firebase infra.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--canvas); }
    .wrap { max-width: 420px; margin: 0 auto; padding: 72px 24px 48px; }
    .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--admn);
            display: grid; place-items: center; color: #fff; font-size: 24px; font-weight: 700; margin-bottom: 32px; }
    h1.brand { font-family: var(--font-serif); font-weight: 400; font-size: 40px; line-height: 1.05;
               letter-spacing: -0.01em; color: var(--ink-900); margin: 0 0 8px; }
    h1.brand em { color: var(--admn); font-style: italic; }
    .sub { color: var(--ink-600); font-size: 14px; margin-bottom: 32px; }
    label { font-size: 12px; color: var(--ink-600); font-weight: 600; display: block; margin-bottom: 6px; margin-top: 16px; }
    input { width: 100%; padding: 14px; border: 1px solid var(--ink-200); border-radius: var(--r-md);
            background: var(--ink-50); font: inherit; font-size: 15px; color: var(--ink-900); outline: none; }
    input:focus { border-color: var(--admn); background: #fff; box-shadow: 0 0 0 4px var(--admn-softer); }
    button.primary { width: 100%; background: var(--admn); color: #fff; border: 0; border-radius: var(--r-pill);
                     padding: 14px 18px; font-size: 15px; font-weight: 600; margin-top: 28px; cursor: pointer; }
    button.primary:disabled { opacity: .45; cursor: not-allowed; }
    .err { color: var(--err); font-size: 13px; margin-top: 12px; }
    .footer { margin-top: 36px; font-size: 11px; color: var(--ink-400); text-align: center; line-height: 1.5; }
  `],
  template: `
    <div class="wrap">
      <div class="logo">N</div>
      <h1 class="brand">Admin, <em>signed in.</em></h1>
      <p class="sub">Platform operations · restricted access</p>

      @if (step() === 'CREDENTIALS') {
        <label>Email</label>
        <input type="email" [(ngModel)]="email" placeholder="admin@neerly.in" autocomplete="username"/>
        <label>Password</label>
        <input type="password" [(ngModel)]="password" autocomplete="current-password"/>
        <button class="primary" [disabled]="!email() || !password() || loading()" (click)="submitCredentials()">
          {{ loading() ? 'Signing in…' : 'Sign in' }}
        </button>
        @if (error()) { <div class="err">{{ error() }}</div> }
      } @else if (step() === 'TOTP') {
        <label>Verification code</label>
        <input inputmode="numeric" maxlength="6" [(ngModel)]="totpCode" placeholder="6-digit code"/>
        <button class="primary" [disabled]="totpCode().length !== 6 || loading()" (click)="submitTotp()">
          {{ loading() ? 'Verifying…' : 'Verify' }}
        </button>
        @if (error()) { <div class="err">{{ error() }}</div> }
      }

      <div class="footer">
        Neerly · Water, sorted. &nbsp;·&nbsp; access logged for audit
      </div>
    </div>
  `
})
export class LoginComponent {
  private router = inject(Router);
  private auth = inject(AuthService);

  email = signal('');
  password = signal('');
  totpCode = signal('');
  step = signal<'CREDENTIALS' | 'TOTP'>('CREDENTIALS');
  loading = signal(false);
  error = signal<string | null>(null);
  private challengeId = signal<string | null>(null);
  private deviceId = signal<string>(this.loadDeviceId());

  submitCredentials() {
    this.loading.set(true);
    this.error.set(null);

    // V1 dev path: hit the local-only /auth/admin/dev-login endpoint, which
    // bypasses Firebase + TOTP and returns the JWT pair directly. Backend
    // gates this three ways (profile, enabled flag, password) so it can't
    // leak to prod. See docs/DEV_ADMIN.md.
    //
    // When the real Firebase Web SDK lands, swap this for:
    //   firebase.auth().signInWithEmailAndPassword(email, password)
    //     .then(cred => cred.user.getIdToken())
    //     .then(idToken => this.auth.startLogin(email, idToken, deviceId))
    this.auth.devLogin(this.email(), this.password(), this.deviceId()).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        // If the dev endpoint isn't registered (prod build / wrong profile),
        // fall back to the real two-step flow.
        if (err?.status === 403 || err?.status === 404) {
          this.fallbackToFirebase();
        } else {
          this.error.set(this.humanize(err) ?? 'Sign in failed');
          this.loading.set(false);
        }
      }
    });
  }

  /** Old two-step flow — kept for prod where dev-login is disabled. */
  private fallbackToFirebase() {
    const firebaseIdToken = this.password();
    this.auth.startLogin(this.email(), firebaseIdToken, this.deviceId()).subscribe({
      next: (challenge) => {
        this.challengeId.set(challenge.totpChallengeId);
        this.step.set('TOTP');
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.humanize(err) ?? 'Sign in failed');
        this.loading.set(false);
      }
    });
  }

  submitTotp() {
    const id = this.challengeId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.verifyTotp(id, this.totpCode()).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.error.set(this.humanize(err) ?? 'Verification failed');
        this.loading.set(false);
        if (err?.error?.error?.code === 'AUTH_ADMIN_CHALLENGE_EXPIRED') {
          // Drop back to credentials; reuse of the expired challenge id is pointless.
          this.step.set('CREDENTIALS');
        }
      }
    });
  }

  private humanize(err: any): string | null {
    return err?.error?.error?.message ?? err?.message ?? null;
  }

  private loadDeviceId(): string {
    const key = 'neerly.admin.deviceId';
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'portal-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(key, id);
    }
    return id;
  }
}
