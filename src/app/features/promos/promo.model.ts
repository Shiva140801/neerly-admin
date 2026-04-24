export type DiscountType = 'FLAT' | 'PERCENT';
export type PromoEligibility = 'ALL' | 'FIRST_ORDER' | 'REFERRAL' | 'SPECIFIC_CUSTOMER';

export interface Promo {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  eligibility: PromoEligibility;
  validFrom: string;
  validUntil: string;
  maxRedemptions: number | null;
  maxPerCustomer: number;
  currentRedemptions: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreatePromoRequest {
  code: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount?: number;
  minOrderValue?: number;
  eligibility: PromoEligibility;
  specificCustomerId?: string;
  validFrom: string;
  validUntil: string;
  maxRedemptions?: number;
  maxPerCustomer?: number;
}
