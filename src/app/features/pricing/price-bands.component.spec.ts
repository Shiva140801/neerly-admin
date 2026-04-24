import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PriceBandsComponent } from './price-bands.component';
import { PricingService } from './pricing.service';
import type { PriceBandResponse } from './price-band.model';

describe('PriceBandsComponent', () => {
  let fixture: ComponentFixture<PriceBandsComponent>;
  let component: PriceBandsComponent;
  let service: jasmine.SpyObj<PricingService>;

  const existingBand: PriceBandResponse = {
    id: 'b-1',
    categoryCode: 'JAR_20L_NORMAL',
    city: 'Hyderabad',
    minPrice: 70,
    maxPrice: 120,
    effectiveFrom: '2026-04-01T00:00:00Z',
    effectiveTo: null
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<PricingService>('PricingService', ['list', 'upsert']);
    service.list.and.returnValue(of([existingBand]));

    await TestBed.configureTestingModule({
      imports: [PriceBandsComponent],
      providers: [{ provide: PricingService, useValue: service }]
    }).compileComponents();

    fixture = TestBed.createComponent(PriceBandsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads active bands on init', () => {
    expect(service.list).toHaveBeenCalled();
    expect(component.bands()).toEqual([existingBand]);
  });

  it('renders existing band in table', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('JAR_20L_NORMAL');
    expect(host.textContent).toContain('Hyderabad');
    expect(host.textContent).toContain('₹70');
    expect(host.textContent).toContain('₹120');
  });

  it('valid() is false on empty form', () => {
    expect(component.valid()).toBeFalsy();
  });

  it('valid() is true with category + city + minPrice > 0 + maxPrice >= minPrice', () => {
    component.form.categoryCode = 'JAR_20L_COOL';
    component.form.city = 'Hyderabad';
    component.form.minPrice = 80;
    component.form.maxPrice = 130;
    expect(component.valid()).toBeTruthy();
  });

  it('valid() is false when maxPrice < minPrice', () => {
    component.form = { categoryCode: 'X', city: 'Y', minPrice: 200, maxPrice: 100 };
    expect(component.valid()).toBeFalsy();
  });

  it('save() calls upsert + clears form + reloads', () => {
    const newBand: PriceBandResponse = {
      id: 'b-2', categoryCode: 'JAR_20L_COOL', city: 'Hyderabad',
      minPrice: 80, maxPrice: 130, effectiveFrom: '2026-04-24T00:00:00Z', effectiveTo: null
    };
    service.upsert.and.returnValue(of(newBand));
    service.list.calls.reset();
    service.list.and.returnValue(of([existingBand, newBand]));

    component.form = { categoryCode: 'JAR_20L_COOL', city: 'Hyderabad', minPrice: 80, maxPrice: 130 };
    component.save();

    expect(service.upsert).toHaveBeenCalledWith({
      categoryCode: 'JAR_20L_COOL', city: 'Hyderabad', minPrice: 80, maxPrice: 130
    });
    // Form cleared after save
    expect(component.form).toEqual({ categoryCode: '', city: 'Hyderabad', minPrice: 0, maxPrice: 0 });
    expect(component.saving()).toBeFalse();
    expect(service.list).toHaveBeenCalled();     // reload kicked in
    expect(component.bands().length).toBe(2);
  });

  it('save() handles upsert error without clearing form', () => {
    service.upsert.and.returnValue(throwError(() => new Error('boom')));

    component.form = { categoryCode: 'JAR_20L_COOL', city: 'Hyderabad', minPrice: 80, maxPrice: 130 };
    component.save();

    expect(component.form.categoryCode).toBe('JAR_20L_COOL');  // unchanged
    expect(component.saving()).toBeFalse();
  });

  it('disables Save button when form invalid', () => {
    const btn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('shows empty-state message when no bands', () => {
    service.list.and.returnValue(of([]));
    component.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No bands set');
  });
});
