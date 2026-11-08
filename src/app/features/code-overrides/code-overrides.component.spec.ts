import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { CodeOverridesComponent } from './code-overrides.component';

describe('CodeOverridesComponent', () => {
  function make() {
    const get = jasmine.createSpy('get').and.returnValue(of([
      { vendorId: 'v2', vendorName: 'Pure Drops', overrides: 1, flagged: false },
      { vendorId: 'v1', vendorName: 'Sri Ganesh Water Supply', overrides: 4, flagged: true }
    ]));
    TestBed.configureTestingModule({ imports: [CodeOverridesComponent], providers: [{ provide: ApiClient, useValue: { get } }] });
    const f = TestBed.createComponent(CodeOverridesComponent);
    f.detectChanges();
    return { f, c: f.componentInstance, get };
  }

  it('asks for the last 7 days and puts flagged shops first', () => {
    const { c, get } = make();
    expect(get).toHaveBeenCalledWith('/admin/orders/code-overrides', { days: 7 });
    expect(c.sorted()[0].vendorName).toBe('Sri Ganesh Water Supply');
    expect(c.flaggedCount()).toBe(1);
  });

  it('highlights a flagged row and says how many shops need a call', () => {
    const { f } = make();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('tr.row-crit').length).toBe(1);
    expect(el.textContent).toContain('1 shop is flagged');
  });

  it('switching the window refetches', () => {
    const { c, get } = make();
    c.days.set(30); c.reload();
    expect(get).toHaveBeenCalledWith('/admin/orders/code-overrides', { days: 30 });
  });
});
