import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { TokenStore } from '../../core/auth/token.store';
import { ConfigComponent, Setting } from './config.component';

const fee: Setting = {
  key: 'delivery.fee_near', category: 'Delivery fee', label: 'Fee — near', description: 'd',
  type: 'DECIMAL', unit: '₹', min: 0, max: 500, public: true,
  defaultValue: '25', value: '25', overridden: false, updatedBy: null, updatedAt: null
};

function setup(role: string, api: Partial<ApiClient>) {
  TestBed.configureTestingModule({
    imports: [ConfigComponent],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: TokenStore, useValue: { identity: () => ({ userId: 'u1', role }) } }
    ]
  });
  const fixture: ComponentFixture<ConfigComponent> = TestBed.createComponent(ConfigComponent);
  fixture.detectChanges();
  return fixture;
}

const phone: Setting = {
  key: 'support.phone', category: 'Support', label: 'Support phone', description: 'd',
  type: 'TEXT', unit: null, min: null, max: null, public: true,
  defaultValue: '', value: '', overridden: false, updatedBy: null, updatedAt: null
};

describe('ConfigComponent', () => {
  it('lists settings and groups them by category', () => {
    const f = setup('ADMIN_SUPER', { get: (() => of([fee])) as any });
    expect(f.componentInstance.settings().length).toBe(1);
    expect(f.componentInstance.categories()).toEqual([{ name: 'Delivery fee', changed: 0 }]);
  });

  it('only a super-admin can change values', () => {
    expect(setup('ADMIN_L2', { get: (() => of([fee])) as any }).componentInstance.canEdit()).toBeFalse();
    TestBed.resetTestingModule();
    expect(setup('ADMIN_SUPER', { get: (() => of([fee])) as any }).componentInstance.canEdit()).toBeTrue();
  });

  it('a change needs a reason and sends value + reason', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ ...fee, value: '30', overridden: true }));
    const f = setup('ADMIN_SUPER', { get: (() => of([fee])) as any, put } as any);
    const c = f.componentInstance;
    c.startEdit(fee);
    c.draft = '30';
    c.askSave(fee);
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.runConfirmed({ reason: 'fuel went up', amount: null });
    expect(put).toHaveBeenCalledWith('/admin/config/delivery.fee_near', { value: '30', reason: 'fuel went up' });
    expect(c.settings()[0].value).toBe('30');
    expect(c.editing()).toBeNull();
  });

  it("shows the server's range message when a value is refused", () => {
    const put = jasmine.createSpy('put').and.returnValue(throwError(() => ({
      status: 422, error: { error: { code: 'SETTING_INVALID', message: 'Fee — near must be at most 500 ₹' } }
    })));
    const f = setup('ADMIN_SUPER', { get: (() => of([fee])) as any, put } as any);
    const c = f.componentInstance;
    c.draft = '900';
    c.askSave(fee);
    c.runConfirmed({ reason: 'x', amount: null });
    expect(c.actionError()).toContain('500');
  });

  it('a TEXT setting gets a text keypad, reads "Not set" when empty, and saves as typed', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ ...phone, value: '+914012345678', overridden: true }));
    const f = setup('ADMIN_SUPER', { get: (() => of([phone])) as any, put } as any);
    const c = f.componentInstance;
    expect(c.inputMode(phone)).toBe('tel');
    expect(c.inputMode(fee)).toBe('decimal');
    expect(c.shown(phone.value)).toBe('Not set');
    c.startEdit(phone);
    c.draft = ' +914012345678 ';
    c.askSave(phone);
    c.runConfirmed({ reason: 'new helpline', amount: null });
    expect(put).toHaveBeenCalledWith('/admin/config/support.phone', { value: '+914012345678', reason: 'new helpline' });
    expect(c.settings()[0].value).toBe('+914012345678');
  });

  it("shows the server's message when a TEXT value is refused", () => {
    const put = jasmine.createSpy('put').and.returnValue(throwError(() => ({
      status: 422, error: { error: { code: 'SETTING_INVALID', message: 'Support phone must be a phone number' } }
    })));
    const f = setup('ADMIN_SUPER', { get: (() => of([phone])) as any, put } as any);
    const c = f.componentInstance;
    c.draft = 'call us';
    c.askSave(phone);
    c.runConfirmed({ reason: 'x', amount: null });
    expect(c.actionError()).toContain('phone number');
  });

  it('a BOOLEAN setting reads On/Off and flips with a reason', () => {
    const photo: Setting = { key: 'delivery.photo_required', category: 'Drivers', label: 'Door photo required', description: 'd',
      type: 'BOOLEAN', unit: null, min: null, max: null, public: false,
      defaultValue: 'true', value: 'true', overridden: false, updatedBy: null, updatedAt: null };
    const put = jasmine.createSpy('put').and.returnValue(of({ ...photo, value: 'false', overridden: true }));
    const f = setup('ADMIN_SUPER', { get: (() => of([photo])) as any, put } as any);
    const c = f.componentInstance;
    expect(c.shownFor(photo, photo.value)).toBe('On');
    expect((f.nativeElement as HTMLElement).textContent).toContain('Turn off');
    c.askToggle(photo);
    expect(c.confirm()?.message).toContain('On → Off');
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.runConfirmed({ reason: 'no S3 in staging', amount: null });
    expect(put).toHaveBeenCalledWith('/admin/config/delivery.photo_required', { value: 'false', reason: 'no S3 in staging' });
    expect(c.shownFor(photo, c.settings()[0].value)).toBe('Off');
  });
});
