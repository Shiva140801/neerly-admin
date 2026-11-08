import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { SosWatchService } from '../../shared/sos-watch.service';
import { sosAlert } from '../../shared/sos-watch.service.spec';
import { SosComponent } from './sos.component';

describe('SosComponent', () => {
  function make(post = jasmine.createSpy('post').and.returnValue(of({}))) {
    const a = sosAlert('s1', new Date(Date.now() - 5 * 60_000).toISOString());
    const get = jasmine.createSpy('get').and.returnValue(of([a]));
    TestBed.configureTestingModule({ imports: [SosComponent], providers: [{ provide: ApiClient, useValue: { get, post } }] });
    const f = TestBed.createComponent(SosComponent);
    f.detectChanges();
    const watch = TestBed.inject(SosWatchService);
    return { f, c: f.componentInstance, post, watch, a };
  }

  afterEach(() => TestBed.inject(SosWatchService).stop());

  it('shows the open alert with a map link and the driver note', () => {
    const { f } = make();
    const text = (f.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('bike skid');
    const link = (f.nativeElement as HTMLElement).querySelector('a[href*="google.com/maps"]') as HTMLAnchorElement;
    expect(link.href).toContain('q=17.44,78.35');
  });

  it('flags a location older than 2 minutes as stale', () => {
    const { c, a } = make();
    expect(c.stale(a)).toBeTrue();
  });

  it('resolving needs a note and removes the alert', () => {
    const { c, post, watch, a } = make();
    (TestBed.inject(ApiClient).get as jasmine.Spy).and.returnValue(of([]));   // server no longer lists it
    c.askResolve(a);
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.run({ reason: 'Called — driver is fine', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/sos/s1/resolve', { note: 'Called — driver is fine' });
    expect(watch.open().find(x => x.id === 's1')).toBeUndefined();
  });
});
