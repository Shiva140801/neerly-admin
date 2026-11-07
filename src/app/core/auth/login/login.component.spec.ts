import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService, ExchangeResponse, TotpChallenge } from '../auth.service';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let navigateSpy: jasmine.Spy;
  let auth: jasmine.SpyObj<AuthService>;

  const sampleChallenge: TotpChallenge = {
    totpChallengeId: 'abcd-1234',
    expiresAt: '2026-04-24T18:00:00Z'
  };

  const sampleExchange: ExchangeResponse = {
    accessToken: 'a.b.c', refreshToken: 'refresh-opaque',
    accessExpiresAt: '2026-04-24T18:15:00Z',
    refreshExpiresAt: '2026-05-01T18:00:00Z',
    activeRole: 'ADMIN_L1',
    user: { id: 'u1', displayName: 'Admin', email: 'a@n.in', phoneMask: '****' },
    grantedRoles: ['ADMIN_L1']
  };

  beforeEach(async () => {
    navigateSpy = jasmine.createSpy('navigate');
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['devLogin', 'startLogin', 'verifyTotp']);
    // These specs cover the production path: the local-only dev endpoint isn't
    // registered (404), so the component falls back to the two-step login.
    auth.devLogin.and.returnValue(throwError(() => ({ status: 404 })));
    auth.startLogin.and.returnValue(of(sampleChallenge));
    auth.verifyTotp.and.returnValue(of(sampleExchange));

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: Router, useValue: { navigate: navigateSpy } },
        { provide: AuthService, useValue: auth }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts in CREDENTIALS step', () => {
    expect(component.step()).toBe('CREDENTIALS');
    expect(component.loading()).toBeFalse();
  });

  it('submitCredentials advances to TOTP on backend 200', () => {
    component.email.set('admin@neerly.in');
    component.password.set('secret');
    component.submitCredentials();
    expect(auth.startLogin).toHaveBeenCalledWith('admin@neerly.in', 'secret', jasmine.any(String));
    expect(component.step()).toBe('TOTP');
    expect(component.loading()).toBeFalse();
  });

  it('submitCredentials surfaces backend error envelope', () => {
    auth.startLogin.and.returnValue(throwError(() => ({
      error: { error: { code: 'AUTH_FIREBASE_VERIFY_FAILED', message: 'Bad creds' } }
    })));
    component.email.set('admin@neerly.in');
    component.password.set('wrong');
    component.submitCredentials();
    expect(component.step()).toBe('CREDENTIALS');
    expect(component.error()).toBe('Bad creds');
  });

  it('submitCredentials signs straight in through the dev endpoint when it exists', () => {
    auth.devLogin.and.returnValue(of(sampleExchange));
    component.email.set('dev-admin@neerly.in');
    component.password.set('neerly-dev-admin');
    component.submitCredentials();
    expect(auth.startLogin).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('submitTotp navigates to /dashboard on success', () => {
    component.step.set('TOTP');
    component.totpCode.set('123456');
    (component as any).challengeId.set('abcd-1234');
    component.submitTotp();
    expect(auth.verifyTotp).toHaveBeenCalledWith('abcd-1234', '123456');
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('submitTotp drops back to CREDENTIALS when challenge expired', () => {
    auth.verifyTotp.and.returnValue(throwError(() => ({
      error: { error: { code: 'AUTH_ADMIN_CHALLENGE_EXPIRED', message: 'expired' } }
    })));
    component.step.set('TOTP');
    component.totpCode.set('123456');
    (component as any).challengeId.set('abcd-1234');
    component.submitTotp();
    expect(component.step()).toBe('CREDENTIALS');
  });

  it('renders brand, email/password inputs, sign-in button', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1.brand')?.textContent).toContain('Admin');
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect(host.querySelector('button.primary')?.textContent).toContain('Sign in');
  });

  it('disables sign-in until email + password are filled', () => {
    const btn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
    component.email.set('admin@neerly.in');
    component.password.set('secret');
    fixture.detectChanges();
    expect(btn.disabled).toBeFalse();
  });
});
