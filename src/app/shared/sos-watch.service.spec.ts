import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClient } from '../core/api/api-client';
import { SosAlert, SosWatchService } from './sos-watch.service';

export const sosAlert = (id: string, raisedAt: string): SosAlert => ({
  id, driverId: 'd1234567-x', vendorId: 'v1234567-x', orderId: null, lat: 17.44, lng: 78.35, note: 'bike skid',
  status: 'OPEN', raisedAt, lastLocationAt: raisedAt, resolvedAt: null, resolutionNote: null
});

describe('SosWatchService', () => {
  function make(get: jasmine.Spy) {
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { get } }] });
    return TestBed.inject(SosWatchService);
  }

  it('asks only for open alerts and lists the oldest first', () => {
    const get = jasmine.createSpy('get').and.returnValue(of([sosAlert('b', '2026-11-07T12:10:00Z'), sosAlert('a', '2026-11-07T12:00:00Z')]));
    const s = make(get);
    s.refresh();
    expect(get).toHaveBeenCalledWith('/admin/sos', { open: 'true', page: 0, size: 50 });
    expect(s.open().map(a => a.id)).toEqual(['a', 'b']);
    expect(s.loading()).toBeFalse();
  });

  it('polls every 15 seconds once started, and stops on sign-out', fakeAsync(() => {
    const get = jasmine.createSpy('get').and.returnValue(of([]));
    const s = make(get);
    s.start(); s.start();                         // idempotent — one timer
    tick(SosWatchService.POLL_MS * 2);
    expect(get).toHaveBeenCalledTimes(4);         // 2 immediate refreshes + 2 polls
    s.stop();
    tick(SosWatchService.POLL_MS * 2);
    expect(get).toHaveBeenCalledTimes(4);
    discardPeriodicTasks();
  }));

  it('a failed check is an error, not "no SOS"', () => {
    const s = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    s.refresh();
    expect(s.error()).toBeTruthy();
  });
});
