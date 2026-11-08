import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { mergeMap } from 'rxjs/operators';
import { of, throwError, timer } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { DriverDocRow, DriverDocsComponent } from './driver-docs.component';

const lic: DriverDocRow = { id: 'doc1', driverId: 'd1234567-x', type: 'DRIVING_LICENSE', docNumber: 'TS0920210001234',
  s3Key: 'driver-docs/d1234567-x/licence.jpg', expiresOn: '2030-01-01', uploadedAt: '2026-11-07T10:00:00Z' };
const aad: DriverDocRow = { ...lic, id: 'doc2', type: 'AADHAAR', docNumber: 'XXXX-XXXX-9012', expiresOn: null };

describe('DriverDocsComponent', () => {
  function make(post = jasmine.createSpy('post').and.returnValue(of(null))) {
    const get = jasmine.createSpy('get').and.returnValue(of([lic, aad]));
    // Async like real HTTP — the link resolves after the first render.
    const presign = timer(0).pipe(mergeMap(() => throwError(() => ({ status: 503, error: { error: { code: 'UPLOAD_STORAGE_UNAVAILABLE' } } }))));
    const postAll = jasmine.createSpy('post').and.callFake((path: string, body: unknown) =>
      path === '/uploads/presign-read' ? presign : post(path, body));
    TestBed.configureTestingModule({ imports: [DriverDocsComponent], providers: [{ provide: ApiClient, useValue: { get, post: postAll } }] });
    const f = TestBed.createComponent(DriverDocsComponent);
    f.detectChanges();
    return { f, c: f.componentInstance, get, post };
  }

  it('loads the review queue and filters by paper type', () => {
    const { c, get } = make();
    expect(get).toHaveBeenCalledWith('/admin/driver-documents', { page: 0, size: 100 });
    expect(c.types()).toEqual(['DRIVING_LICENSE', 'AADHAAR']);
    c.type.set('AADHAAR');
    expect(c.visible().map(d => d.id)).toEqual(['doc2']);
  });

  it('says honestly when the file cannot be opened here', fakeAsync(() => {
    const { f } = make();
    tick(); f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Object storage is not configured');
  }));

  it('approve sends approve=true; reject needs a reason the driver sees', () => {
    const { c, post } = make();
    c.askApprove(lic);
    c.run({ reason: '', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/driver-documents/doc1/review', { approve: true, reason: null });
    c.askReject(aad);
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.run({ reason: 'Blurred photo', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/driver-documents/doc2/review', { approve: false, reason: 'Blurred photo' });
    expect(c.rows().length).toBe(0);
  });
});
