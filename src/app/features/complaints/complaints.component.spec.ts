import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ComplaintsComponent } from './complaints.component';
import { ComplaintService } from './complaint.service';
import type { Complaint } from './complaint.model';

describe('ComplaintsComponent', () => {
  let fixture: ComponentFixture<ComplaintsComponent>;
  let component: ComplaintsComponent;
  let service: jasmine.SpyObj<ComplaintService>;

  const sample: Complaint = {
    id: 'c-1',
    customerId: 'cust-1',
    vendorId: 'vendor-1',
    orderId: 'ord-1',
    category: 'LATE_DELIVERY',
    subject: 'Arrived 2 hours late',
    description: 'Slot 10-11am, came at 1pm',
    evidencePhotos: [],
    status: 'OPEN',
    priority: 'NORMAL',
    assignedTo: null,
    resolutionNotes: null,
    resolutionAction: null,
    awardedAmount: null,
    slaDeadline: '2026-04-25T10:00:00Z',
    slaBreached: false,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    filedAt: '2026-04-24T10:00:00Z',
    messages: []
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<ComplaintService>('ComplaintService', [
      'list', 'get', 'triage', 'start', 'resolve', 'close', 'appendMessage'
    ]);
    service.list.and.returnValue(of([sample]));
    service.get.and.returnValue(of(sample));
    service.triage.and.returnValue(of({ ...sample, status: 'TRIAGED', priority: 'HIGH' }));
    service.resolve.and.returnValue(of({ ...sample, status: 'RESOLVED' }));

    await TestBed.configureTestingModule({
      imports: [ComplaintsComponent],
      providers: [
        { provide: ComplaintService, useValue: service },
        // The desk resolves party names through DirectoryService, which talks to
        // the API; the tests stub the transport rather than the service so the
        // component wires up exactly as it does at runtime.
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ComplaintsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads open complaints into the queue', () => {
    expect(service.list).toHaveBeenCalled();
    expect(component.items().length).toBe(1);
    expect(component.items()[0].subject).toBe('Arrived 2 hours late');
  });

  it('selecting a complaint fetches its detail', () => {
    component.select(sample);
    expect(service.get).toHaveBeenCalledWith('c-1');
    expect(component.selected()?.id).toBe('c-1');
  });

  it('triage as HIGH posts to the backend', () => {
    component.selected.set(sample);
    component.triage('HIGH');
    expect(service.triage).toHaveBeenCalledWith('c-1', { priority: 'HIGH' });
  });

  it('submitResolve passes the whole form body', () => {
    component.selected.set(sample);
    component.resolveAction = 'WALLET_CREDIT';
    component.resolveAmount = 50;
    component.resolveNotes = 'Compensated';
    component.submitResolve();
    expect(service.resolve).toHaveBeenCalledWith('c-1', jasmine.objectContaining({
      action: 'WALLET_CREDIT',
      awardedAmount: 50,
      notes: 'Compensated'
    }));
  });
});
