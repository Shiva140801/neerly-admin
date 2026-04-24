import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PromosComponent } from './promos.component';
import { PromoService } from './promo.service';
import type { Promo } from './promo.model';

describe('PromosComponent', () => {
  let fixture: ComponentFixture<PromosComponent>;
  let component: PromosComponent;
  let service: jasmine.SpyObj<PromoService>;

  const sample: Promo = {
    id: 'p-1',
    code: 'NEERLY50',
    description: '₹50 off first order',
    discountType: 'FLAT',
    discountValue: 50,
    maxDiscount: null,
    minOrderValue: 100,
    eligibility: 'FIRST_ORDER',
    validFrom: '2026-04-01T00:00:00Z',
    validUntil: '2026-12-31T00:00:00Z',
    maxRedemptions: 1000,
    maxPerCustomer: 1,
    currentRedemptions: 42,
    isActive: true,
    createdAt: '2026-04-01T00:00:00Z'
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<PromoService>('PromoService', ['list', 'create', 'deactivate']);
    service.list.and.returnValue(of([sample]));
    service.create.and.returnValue(of(sample));
    service.deactivate.and.returnValue(of({ ...sample, isActive: false }));

    await TestBed.configureTestingModule({
      imports: [PromosComponent],
      providers: [{ provide: PromoService, useValue: service }]
    }).compileComponents();

    fixture = TestBed.createComponent(PromosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads the promo catalog', () => {
    expect(service.list).toHaveBeenCalled();
    expect(component.items()[0].code).toBe('NEERLY50');
  });

  it('create without valid dates is a no-op', () => {
    component.form.code = 'X';
    component.form.validFromLocal = '';
    component.form.validUntilLocal = '';
    component.create();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('create with complete form uppercases code and converts dates to ISO', () => {
    component.form.code = 'summer15';
    component.form.description = 'Summer PERCENT';
    component.form.discountType = 'PERCENT';
    component.form.discountValue = 15;
    component.form.maxDiscount = 40;
    component.form.minOrderValue = 200;
    component.form.eligibility = 'ALL';
    component.form.maxPerCustomer = 3;
    component.form.validFromLocal = '2026-05-01T00:00';
    component.form.validUntilLocal = '2026-05-31T23:59';
    component.create();
    expect(service.create).toHaveBeenCalled();
    const body = service.create.calls.mostRecent().args[0];
    expect(body.code).toBe('SUMMER15');
    expect(body.discountType).toBe('PERCENT');
    // We only assert the value is a proper ISO 8601 instant; exact timezone
    // translation depends on the host, which the test box can't pin down.
    expect(body.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(body.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('deactivate calls the retire endpoint', () => {
    component.deactivate(sample);
    expect(service.deactivate).toHaveBeenCalledWith('p-1');
  });
});
