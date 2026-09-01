import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { VendorDetailComponent } from './vendor-detail.component';
import { VendorService } from './vendor.service';
import type { VendorResponse } from './vendor.model';

describe('VendorDetailComponent', () => {
  let fixture: ComponentFixture<VendorDetailComponent>;
  let component: VendorDetailComponent;
  let service: jasmine.SpyObj<VendorService>;

  const pendingVendor: VendorResponse = {
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

  const activeVendor: VendorResponse = {
    ...pendingVendor,
    status: 'ACTIVE',
    approvedAt: '2026-04-23T10:00:00Z'
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<VendorService>('VendorService', ['get', 'approve', 'reject', 'suspend']);

    await TestBed.configureTestingModule({
      imports: [VendorDetailComponent],
      providers: [
        { provide: VendorService, useValue: service },
        provideRouter([])
      ]
    }).compileComponents();
  });

  function create(vendor: VendorResponse = pendingVendor) {
    service.get.and.returnValue(of(vendor));
    fixture = TestBed.createComponent(VendorDetailComponent);
    component = fixture.componentInstance;
    component.id = 'v-1';
    fixture.detectChanges();
  }

  it('loads the vendor on init', () => {
    create();
    expect(service.get).toHaveBeenCalledWith('v-1');
    expect(component.vendor()).toEqual(pendingVendor);
  });

  it('renders vendor name + tier + status pills', () => {
    create();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Sri Ganesh Water Supply');
    // Pills read in English; the raw enum stays available on the title attribute
    // so an operator can still quote the wire value in a support ticket.
    const tier = host.querySelector('.pill.tier');
    const status = host.querySelector('.pill.status');
    expect(tier?.textContent).toContain('Tier 1');
    expect(tier?.getAttribute('title')).toBe('TIER_1');
    expect(status?.textContent).toContain('Awaiting verification');
    expect(status?.getAttribute('title')).toBe('PENDING_VERIFICATION');
  });

  it('renders business details from response', () => {
    create();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Ramesh');
    expect(host.textContent).toContain('Sole proprietor');
    expect(host.textContent).toContain('500032');
    expect(host.textContent).toContain('500081');
    expect(host.textContent).toContain('12345678901234');
  });

  it('shows Approve button for PENDING_VERIFICATION', () => {
    create();
    const btn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Approve');
  });

  it('clicking Approve calls service.approve and updates state', () => {
    service.approve.and.returnValue(of(activeVendor));
    create();
    // Approve puts a business in front of customers, so it goes through the
    // confirmation gate first — the click opens it, confirming runs the call.
    (fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.confirm()?.confirmLabel).toBe('Approve and go live');
    expect(service.approve).not.toHaveBeenCalled();

    // The screen re-reads the vendor afterwards: mutation responses carry the
    // new status but not the derived track record.
    service.get.and.returnValue(of(activeVendor));
    component.runConfirmed({ reason: '', amount: null });
    fixture.detectChanges();

    expect(service.approve).toHaveBeenCalledWith('v-1', {});
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(component.vendor()?.status).toBe('ACTIVE');
  });

  it('reject() is a no-op when reason is blank (guard logic)', () => {
    create();
    // Empty reason → no service call, no state change
    component.rejectReason = '';
    component.reject();
    expect(service.reject).not.toHaveBeenCalled();

    component.rejectReason = '   ';   // whitespace-only
    component.reject();
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('Reject calls service.reject with typed reason + clears field', () => {
    service.reject.and.returnValue(of({ ...pendingVendor, status: 'PENDING_VERIFICATION' }));
    create();

    component.rejectReason = 'Please resubmit clearer FSSAI photo';
    component.reject();

    expect(service.reject).toHaveBeenCalledWith('v-1', { reason: 'Please resubmit clearer FSSAI photo' });
    expect(component.rejectReason).toBe('');
  });

  it('Suspend button only shows for ACTIVE vendors', () => {
    create(activeVendor);
    const suspendBtn = fixture.nativeElement.querySelector('button.warn') as HTMLButtonElement;
    expect(suspendBtn).not.toBeNull();
    expect(suspendBtn.textContent).toContain('Suspend');
  });

  it('Suspend does not show for PENDING_VERIFICATION', () => {
    create(pendingVendor);
    const suspendBtn = fixture.nativeElement.querySelector('button.warn');
    expect(suspendBtn).toBeNull();
  });

  it('Suspend calls service.suspend with reason', () => {
    service.suspend.and.returnValue(of({ ...activeVendor, status: 'SUSPENDED' }));
    create(activeVendor);

    component.suspendReason = 'Three consecutive customer complaints';
    service.get.and.returnValue(of({ ...activeVendor, status: 'SUSPENDED' as const }));
    component.suspend();

    expect(service.suspend).toHaveBeenCalledWith('v-1', { reason: 'Three consecutive customer complaints' });
    expect(component.vendor()?.status).toBe('SUSPENDED');
    expect(component.suspendReason).toBe('');
  });

  it('empty rejectReason is a no-op (does not call service)', () => {
    create();
    component.rejectReason = '   ';
    component.reject();
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('busy flag gates buttons while approve in-flight', () => {
    service.approve.and.returnValue(of(activeVendor));
    create();

    component.busy.set(true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });
});
