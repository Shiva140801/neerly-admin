export type TriggerSource = 'MANUAL_ADMIN' | 'AUTO_DEMAND' | 'AUTO_WEATHER' | 'AUTO_SCARCITY';

export interface SurgeTrigger {
  id: string;
  city: string;
  pincode: string | null;
  categoryCode: string | null;
  multiplier: number;
  activeFrom: string;
  activeUntil: string | null;
  source: TriggerSource;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export interface CreateSurgeRequest {
  city: string;
  pincode?: string;
  categoryCode?: string;
  multiplier: number;
  source?: TriggerSource;
  reason?: string;
  activeFrom?: string;
  activeUntil?: string;
}
