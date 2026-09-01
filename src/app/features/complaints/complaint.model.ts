export type ComplaintCategory =
  | 'LATE_DELIVERY' | 'WRONG_PRODUCT' | 'DAMAGED_CONTAINER' | 'WATER_QUALITY'
  | 'DRIVER_BEHAVIOUR' | 'SHORT_QUANTITY' | 'OVERCHARGED' | 'OTHER';

export type ComplaintStatus =
  | 'OPEN' | 'TRIAGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'WITHDRAWN';

export type ComplaintPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type ResolutionAction =
  | 'REFUND' | 'WALLET_CREDIT' | 'REPLACEMENT' | 'VENDOR_PENALTY' | 'NO_ACTION';

export interface ComplaintMessage {
  id: string;
  authorId: string;
  authorRole: string;
  message: string;
  attachments: string[];
  isInternal: boolean;
  createdAt: string;
}

export interface Complaint {
  id: string;
  customerId: string;
  vendorId: string | null;
  orderId: string | null;
  /**
   * Resolved display details, joined server-side. All optional and nullable:
   * a ticket that names no vendor has no vendor name, and an unnamed party is
   * shown as an unresolved id rather than invented.
   */
  customerName?: string | null;
  customerPhone?: string | null;
  vendorName?: string | null;
  orderNumber?: string | null;
  category: ComplaintCategory;
  subject: string;
  description: string;
  evidencePhotos: string[];
  status: ComplaintStatus;
  priority: ComplaintPriority;
  assignedTo: string | null;
  resolutionNotes: string | null;
  resolutionAction: ResolutionAction | null;
  awardedAmount: number | null;
  slaDeadline: string;
  slaBreached: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  filedAt: string;
  messages?: ComplaintMessage[];
}

export interface TriageRequest {
  priority: ComplaintPriority;
  assignedTo?: string;
}

export interface ResolveRequest {
  action: ResolutionAction;
  notes?: string;
  awardedAmount?: number;
}
