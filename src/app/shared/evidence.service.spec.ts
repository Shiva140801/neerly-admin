import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClient } from '../core/api/api-client';
import { EvidenceService } from './evidence.service';

describe('EvidenceService', () => {
  function make(post: jasmine.Spy) {
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { post } }] });
    return TestBed.inject(EvidenceService);
  }

  it('opens a database-stored photo through its signed link, once per key', () => {
    const url = 'http://localhost:8080/api/v1/media/order-proof/u1/door-photo-1a2b.jpg?t=abc';
    const post = jasmine.createSpy('post').and.returnValue(of({ url, expiresInSeconds: 900 }));
    const s = make(post);
    const key = 'order-proof/u1/door-photo-1a2b.jpg';
    expect(s.link(key)()).toEqual({ key, state: 'ready', url, reason: null });
    s.link(key);
    expect(post).toHaveBeenCalledOnceWith('/uploads/presign-read', { s3Key: key });
    expect(s.isImage(key)).toBeTrue();
  });

  it('says plainly when the app sent a key without the photo', () => {
    const s = make(jasmine.createSpy('post').and.returnValue(
      throwError(() => ({ status: 404, error: { error: { code: 'MEDIA_NOT_FOUND' } } }))));
    const v = s.link('order-proof/u1/missing.jpg')();
    expect(v.state).toBe('unavailable');
    expect(v.reason).toContain('never uploaded');
  });

  it('keeps the storage-not-configured wording for S3 mode', () => {
    const s = make(jasmine.createSpy('post').and.returnValue(
      throwError(() => ({ status: 503, error: { error: { code: 'UPLOAD_STORAGE_UNAVAILABLE' } } }))));
    expect(s.link('k')().reason).toContain('not configured');
  });
});
