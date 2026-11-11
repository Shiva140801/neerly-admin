import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { BankAccountRow, BankAccountsComponent } from './bank-accounts.component';

const a: BankAccountRow = {
  id: 'b1', vendorId: 'v1', shopName: 'Sri Ganesh Water Supply', accountHolderName: 'RAMESH K',
  accountNumberMasked: '•••• 9012', ifsc: 'HDFC0001234', bankName: 'HDFC', branchName: null,
  accountType: 'SAVINGS', chequeProofS3: null, addedAt: '2026-11-10T10:00:00Z',
  status: 'PENDING_VERIFICATION', rejectionReason: null
};

describe('BankAccountsComponent', () => {
  function make() {
    const get = jasmine.createSpy('get').and.returnValue(of([a]));
    const post = jasmine.createSpy('post').and.returnValue(of({ ...a, status: 'VERIFIED' }));
    TestBed.configureTestingModule({ imports: [BankAccountsComponent], providers: [{ provide: ApiClient, useValue: { get, post } }] });
    const f = TestBed.createComponent(BankAccountsComponent);
    f.detectChanges();
    return { c: f.componentInstance, get, post, el: f.nativeElement as HTMLElement };
  }

  it('loads the review queue and never shows a full account number', () => {
    const { c, get, el } = make();
    expect(get).toHaveBeenCalledWith('/admin/vendor-bank-accounts/pending', { page: 0, size: 100 });
    expect(c.rows().length).toBe(1);
    expect(el.textContent).toContain('•••• 9012');
    expect(el.textContent).toContain('No proof uploaded');
  });

  it('verify posts to the verify endpoint', () => {
    const { c, post } = make();
    c.askVerify(a);
    c.run({ reason: '', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/vendor-bank-accounts/b1/verify', {});
  });

  it('reject requires and sends the reason', () => {
    const { c, post } = make();
    c.askReject(a);
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.run({ reason: "Name doesn't match", amount: null });
    expect(post).toHaveBeenCalledWith('/admin/vendor-bank-accounts/b1/reject', { reason: "Name doesn't match" });
  });
});
