import { TestBed } from '@angular/core/testing';
import { TokenStore } from './token.store';

describe('TokenStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [TokenStore] });
  });

  afterEach(() => localStorage.clear());

  it('is unauthenticated on fresh load', () => {
    const store = TestBed.inject(TokenStore);
    expect(store.isAuthenticated()).toBeFalse();
    expect(store.access()).toBeNull();
  });

  it('save() persists tokens to localStorage and signals', () => {
    const store = TestBed.inject(TokenStore);
    store.save({
      accessToken: 'access-xyz',
      refreshToken: 'refresh-abc',
      expiresAt: Date.now() + 60_000
    });
    expect(store.access()).toBe('access-xyz');
    expect(store.refreshToken()).toBe('refresh-abc');
    expect(store.isAuthenticated()).toBeTrue();
    expect(localStorage.getItem('neerly.admin.access')).toBe('access-xyz');
  });

  it('isAuthenticated() returns false when expired', () => {
    const store = TestBed.inject(TokenStore);
    store.save({
      accessToken: 'a', refreshToken: 'r',
      expiresAt: Date.now() - 1000   // already expired
    });
    expect(store.isAuthenticated()).toBeFalse();
  });

  it('clear() removes all tokens', () => {
    const store = TestBed.inject(TokenStore);
    store.save({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 });
    store.clear();
    expect(store.access()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.isAuthenticated()).toBeFalse();
    expect(localStorage.getItem('neerly.admin.access')).toBeNull();
  });

  it('survives page reload by re-hydrating from localStorage', () => {
    // First instance saves
    const first = TestBed.inject(TokenStore);
    first.save({ accessToken: 'persistent', refreshToken: 'r', expiresAt: Date.now() + 60_000 });

    // Simulate reload: fresh injector picks up from localStorage
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [TokenStore] });
    const second = TestBed.inject(TokenStore);
    expect(second.access()).toBe('persistent');
    expect(second.isAuthenticated()).toBeTrue();
  });
});
