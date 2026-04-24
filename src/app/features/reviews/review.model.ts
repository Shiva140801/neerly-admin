export type ReviewStatus = 'VISIBLE' | 'PENDING_MODERATION' | 'HIDDEN_SPAM' | 'HIDDEN_ABUSE' | 'DELETED';

export interface Review {
  id: string;
  customerId: string;
  vendorId: string;
  orderId: string;
  rating: number;
  text: string | null;
  status: ReviewStatus;
  spamScore: number;
  spamFlags: string[];
  vendorResponse: { id: string; text: string; createdAt: string; updatedAt: string; } | null;
  createdAt: string;
}

export interface ModerateReviewRequest {
  status: ReviewStatus;
  note?: string;
}
