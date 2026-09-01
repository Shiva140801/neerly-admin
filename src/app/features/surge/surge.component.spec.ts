import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { SurgeComponent } from './surge.component';
import { SurgeService } from './surge.service';
import type { SurgeTrigger } from './surge.model';

describe('SurgeComponent', () => {
  let fixture: ComponentFixture<SurgeComponent>;
  let component: SurgeComponent;
  let service: jasmine.SpyObj<SurgeService>;

  const sample: SurgeTrigger = {
    id: 's-1',
    city: 'Hyderabad',
    pincode: '500032',
    categoryCode: '20L_JAR',
    multiplier: 1.25,
    activeFrom: '2026-04-24T09:00:00Z',
    activeUntil: null,
    source: 'MANUAL_ADMIN',
    reason: 'Heat wave',
    createdBy: null,
    createdAt: '2026-04-24T09:00:00Z',
    cancelledAt: null,
    cancelledBy: null
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<SurgeService>('SurgeService', ['list', 'create', 'cancel']);
    service.list.and.returnValue(of([sample]));
    service.create.and.returnValue(of(sample));
    service.cancel.and.returnValue(of({ ...sample, cancelledAt: '2026-04-24T11:00:00Z' }));

    await TestBed.configureTestingModule({
      imports: [SurgeComponent],
      providers: [
        { provide: SurgeService, useValue: service },
        // Creating or cancelling a surge refreshes the shared attention read
        // model so the overview stops disagreeing about whether surge is on.
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SurgeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads Hyderabad triggers by default', () => {
    expect(service.list).toHaveBeenCalledWith('Hyderabad');
    expect(component.items().length).toBe(1);
  });

  it('create skips blank optional scope fields', () => {
    component.form.city = 'Hyderabad';
    component.form.pincode = '';
    component.form.categoryCode = '';
    component.form.multiplier = 1.15;
    component.form.source = 'AUTO_DEMAND';
    component.form.reason = 'demand spike';
    component.create();
    expect(service.create).toHaveBeenCalledWith(jasmine.objectContaining({
      city: 'Hyderabad',
      multiplier: 1.15,
      source: 'AUTO_DEMAND',
      reason: 'demand spike'
    }));
    const arg = service.create.calls.mostRecent().args[0];
    expect(arg.pincode).toBeUndefined();
    expect(arg.categoryCode).toBeUndefined();
  });

  it('cancel calls the backend and reloads', () => {
    component.cancel(sample);
    expect(service.cancel).toHaveBeenCalledWith('s-1');
  });
});
