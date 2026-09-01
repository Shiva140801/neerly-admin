export type VendorStatus =
  | 'PENDING_VERIFICATION' | 'APPLIED' | 'PARTNER_ENGAGED' | 'FSSAI_FILING'
  | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING' | 'OFFBOARDED' | 'TIER_3_REJECTED';

export type VendorTier = 'TIER_1' | 'TIER_2' | 'TIER_3_SUSPENDED' | 'TIER_3_REJECTED';

export interface VendorResponse {
  id: string;
  ownerId: string;
  businessName: string;
  proprietorName: string;
  businessType: 'PROPRIETOR' | 'PARTNERSHIP' | 'PRIVATE_LTD' | 'LLP';
  categories: string[];
  tier: VendorTier;
  status: VendorStatus;
  businessCity: string;
  businessPincode: string;
  fssaiNumber: string | null;
  fssaiExpiresAt: string | null;
  avgRating: number | null;
  totalOrders: number;
  joinedAt: string;
  approvedAt: string | null;
  servicedPincodes: string[];
  /** How to reach the vendor. Null until the backend can resolve the owner. */
  ownerName: string | null;
  ownerPhone: string | null;
}

export interface ApproveVendorRequest {
  commissionRateOverride?: number;
}

export interface RejectVendorRequest {
  reason: string;
}

export interface SuspendVendorRequest {
  reason: string;
  untilIso?: string;
}

/** Suspension is not a one-way door: `POST /admin/vendors/{id}/reinstate` undoes it. */
export interface ReinstateVendorRequest {
  reason: string;
}
