export interface PriceBandResponse {
  id: string;
  categoryCode: string;
  city: string;
  minPrice: number;
  maxPrice: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface UpsertPriceBandRequest {
  categoryCode: string;
  city: string;
  minPrice: number;
  maxPrice: number;
  effectiveFrom?: string;
}
