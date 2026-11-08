import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { Withdrawal, WithdrawalsComponent } from './withdrawals.component';

const w: Withdrawal = {
  id: 'w1', userId: 'u1', amount: 230, upiId: 'shiva@okhdfc', status: 'REQUESTED',
  requestedAt: '2026-11-07T10:00:00Z', processedAt: null, utr: null, failureReason: null
};

describe('WithdrawalsComponent', () => {
  function make(post = jasmine.createSpy('post').and.returnValue(of({ ...w, status: 'PAID' }))) {
    const get = jasmine.createSpy('get').and.callFake((path: string) => path === '/admin/config'
      ? of([{ key: 'wallet.withdraw_hold_days', value: '3' }, { key: 'wallet.withdraw_daily_max', value: '5000' }])
      : of({ content: [w], page: 0, size: 100, totalElements: 1, totalPages: 1, hasNext: false }));
    TestBed.configureTestingModule({ imports: [WithdrawalsComponent], providers: [{ provide: ApiClient, useValue: { get, post } }] });
    const f = TestBed.createComponent(WithdrawalsComponent);
    f.detectChanges();
    return { c: f.componentInstance, get, post };
  }

  it('loads the waiting queue', () => {
    const { c, get } = make();
    expect(get).toHaveBeenCalledWith('/admin/wallet/withdrawals', { status: 'REQUESTED', page: 0, size: 100 });
    expect(c.rows().length).toBe(1);
  });

  it('shows the hold and daily limit the server enforces', () => {
    const { c } = make();
    expect(c.rules()).toEqual({ holdDays: '3', dailyMax: '5000' });
  });

  it('marking paid sends the UTR', () => {
    const { c, post } = make();
    c.askPaid(w);
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.run({ reason: '412345678901', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/wallet/withdrawals/w1/mark-paid', { utr: '412345678901' });
  });

  it('failing sends the reason (money returns to the wallet server-side)', () => {
    const { c, post } = make();
    c.askFail(w);
    c.run({ reason: 'UPI id not found', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/wallet/withdrawals/w1/fail', { reason: 'UPI id not found' });
  });
});
