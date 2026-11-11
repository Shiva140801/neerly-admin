import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { ProductReviewRow, ProductsReviewComponent } from './products-review.component';

const r: ProductReviewRow = {
  vendorName: 'Cool Ice Co', submittedAt: '2026-11-11T05:00:00Z',
  product: {
    id: 'p1', vendorId: 'v1', price: 40, dailyCapacity: 30, photoUrl: null, description: null,
    depositAmount: null, allowTransferAndReturn: false,
    template: { displayName: 'Ice cubes · 1 kg bag', sizeLabel: '1 kg', containerType: 'ICE_BAG' },
    custom: { category: 'ICE', kind: 'CUBES', unit: 'KG', size: 1, packaging: 'BAG', packCount: null, name: null }
  }
};

describe('ProductsReviewComponent', () => {
  function make() {
    const get = jasmine.createSpy('get').and.returnValue(of([r]));
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    TestBed.configureTestingModule({ imports: [ProductsReviewComponent], providers: [{ provide: ApiClient, useValue: { get, post } }] });
    const f = TestBed.createComponent(ProductsReviewComponent);
    f.detectChanges();
    return { c: f.componentInstance, get, post, el: f.nativeElement as HTMLElement };
  }

  it('lists custom products waiting, with what they are and how they are packed', () => {
    const { c, get, el } = make();
    expect(get).toHaveBeenCalledWith('/admin/catalog/products/pending');
    expect(c.rows().length).toBe(1);
    expect(el.textContent).toContain('Ice cubes · 1 kg bag');
    expect(el.textContent).toContain('Bag');
    expect(el.textContent).toContain('Cool Ice Co');
  });

  it('approve posts to the approve endpoint', () => {
    const { c, post } = make();
    c.askApprove(r);
    c.run({ reason: '', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/catalog/products/p1/approve', {});
  });

  it('reject requires and sends the reason', () => {
    const { c, post } = make();
    c.askReject(r);
    expect(c.confirm()?.reason?.required).toBeTrue();
    c.run({ reason: 'Say the size', amount: null });
    expect(post).toHaveBeenCalledWith('/admin/catalog/products/p1/reject', { reason: 'Say the size' });
  });
});
