import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { TokenStore } from './token.store';

describe('authGuard', () => {
  let tokens: TokenStore;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        TokenStore,
        { provide: Router, useValue: { createUrlTree: (commands: any[]) => ({ toString: () => commands.join('/') } as UrlTree) } }
      ]
    });
    tokens = TestBed.inject(TokenStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => localStorage.clear());

  function run() {
    return TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
  }

  it('allows the route when authenticated', () => {
    tokens.save({ accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 60_000 });
    expect(run()).toBe(true);
  });

  it('redirects to /login when unauthenticated', () => {
    const result = run();
    expect(result).not.toBe(true);
    expect(String(result)).toBe('/login');
  });

  it('redirects when token is expired', () => {
    tokens.save({ accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() - 1 });
    const result = run();
    expect(result).not.toBe(true);
  });
});
