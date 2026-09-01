import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { VendorQueueComponent } from './vendor-queue.component';
import { VendorService } from './vendor.service';
import type { VendorResponse, VendorStatus } from './vendor.model';

describe('VendorQueueComponent', () => {
  let fixture: ComponentFixture<VendorQueueComponent>;
  let component: VendorQueueComponent;
  let service: jasmine.SpyObj<VendorService>;

  const sampleVendor: VendorResponse = {
    id: 'v-1',
    ownerId: 'u-1',
    businessName: 'Sri Ganesh Water Supply',
    proprietorName: 'Ramesh',
    businessType: 'PROPRIETOR',
    categories: ['WATER_SUPPLIER'],
    tier: 'TIER_1',
    status: 'PENDING_VERIFICATION',
    businessCity: 'Hyderabad',
    businessPincode: '500032',
    fssaiNumber: '12345678901234',
    fssaiExpiresAt: '2027-04-22',
    avgRating: null,
    totalOrders: 0,
    joinedAt: '2026-04-22T10:00:00Z',
    approvedAt: null,
    servicedPincodes: ['500032', '500081'],
    ownerName: 'Ramesh Kumar',
    ownerPhone: '+919999900001',
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<VendorService>('VendorService', ['list', 'get', 'approve', 'reject', 'suspend']);
    service.list.and.returnValue(of({
      content: [sampleVendor], page: 0, size: 20, totalElements: 1, totalPages: 1,
      hasNext: false, hasPrevious: false
    } as any));

    await TestBed.configureTestingModule({
      imports: [VendorQueueComponent],
      providers: [
        { provide: VendorService, useValue: service },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VendorQueueComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the queue with the pending vendor', () => {
    expect(service.list).toHaveBeenCalledWith('PENDING_VERIFICATION');
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Sri Ganesh Water Supply');
    // The tier pill reads in English; the raw enum stays on the title attribute.
    expect(host.textContent).toContain('Tier 1');
    expect(host.querySelector('[title="TIER_1"]')).not.toBeNull();
    expect(host.textContent).toContain('500032');
  });

  it('renders all status filter chips', () => {
    const chips = fixture.nativeElement.querySelectorAll('.chip');
    expect(chips.length).toBeGreaterThanOrEqual(5);
    const texts = Array.from(chips).map((c: any) => c.textContent?.trim());
    expect(texts).toContain(jasmine.stringMatching(/Pending Verification/i));
  });

  it('selects a different status and reloads', () => {
    service.list.and.returnValue(of({
      content: [], page: 0, size: 20, totalElements: 0, totalPages: 0,
      hasNext: false, hasPrevious: false
    } as any));

    component.selectedStatus.set('ACTIVE' as VendorStatus);
    component.reload();

    expect(service.list).toHaveBeenCalledWith('ACTIVE');
  });

  it('labelFor converts SNAKE_CASE to Title Case', () => {
    expect(component.labelFor('PENDING_VERIFICATION' as VendorStatus)).toContain('Pending');
    expect(component.labelFor('TIER_3_REJECTED' as VendorStatus)).toContain('Tier');
  });
});
