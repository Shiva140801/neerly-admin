import { humanize } from './ui/urgency';

/**
 * How the portal says a backend enum out loud.
 *
 * `humanize()` title-cases a SCREAMING_SNAKE value, which is right for most
 * enums but wrong for the ones where the machine name is not English:
 * `FSSAI_LICENSE` became "Fssai License", `TIER_1` stayed "TIER_1", and
 * `JAR_20L_NORMAL` stayed a product key. Those get an explicit entry here; the
 * rest fall through to title-casing, so a new enum value the backend adds is
 * still readable rather than blank.
 *
 * Keys are the wire values. Never render a raw enum in a label or a button.
 */
const LABELS: Record<string, string> = {
  // --- Vendor tier and status -------------------------------------------
  TIER_1: 'Tier 1 · licensed',
  TIER_2: 'Tier 2 · licence in filing',
  TIER_3_SUSPENDED: 'Tier 3 · suspended',
  TIER_3_REJECTED: 'Tier 3 · permanently rejected',
  PENDING_VERIFICATION: 'Awaiting verification',
  APPLIED: 'Applied',
  PARTNER_ENGAGED: 'Partner engaged',
  FSSAI_FILING: 'FSSAI being filed',
  ACTIVE: 'Live',
  SUSPENDED: 'Suspended',
  OFFBOARDING: 'Off-boarding',
  OFFBOARDED: 'Off-boarded',

  // --- Business type ------------------------------------------------------
  PROPRIETOR: 'Sole proprietor',
  PARTNERSHIP: 'Partnership',
  PRIVATE_LTD: 'Private limited',
  LLP: 'LLP',

  // --- Vendor categories --------------------------------------------------
  WATER_SUPPLIER: 'Water supplier',
  ICE_SUPPLIER: 'Ice supplier',
  TANKER_OPERATOR: 'Tanker operator',
  DISPENSER_DEALER: 'Dispenser dealer',

  // --- Product categories (platform catalog) ------------------------------
  JAR_20L_NORMAL: '20L jar · normal',
  JAR_20L_COOL: '20L jar · chilled',
  JAR_20L_MINERAL: '20L jar · mineral',
  JAR_20L_RO: '20L jar · RO',
  BOTTLE_1L: '1L bottle',
  BOTTLE_2L: '2L bottle',
  BOTTLE_500ML: '500ml bottle',
  TANKER_5000L: '5,000L tanker',
  TANKER_10000L: '10,000L tanker',
  DISPENSER: 'Water dispenser',
  ICE_BAG_5KG: '5kg ice bag',

  // --- Compliance document types -----------------------------------------
  FSSAI_LICENSE: 'FSSAI licence',
  TRADE_LICENSE: 'Trade licence',
  GROUNDWATER_PERMIT: 'Groundwater permit',
  SHOP_ESTABLISHMENT: 'Shop establishment certificate',
  GST_CERTIFICATE: 'GST certificate',
  WATER_TEST_REPORT: 'Water test report',
  BIS_CERTIFICATE: 'BIS certificate',
  PAN_CARD: 'PAN card',
  AADHAAR: 'Aadhaar',

  // --- Order lifecycle ----------------------------------------------------
  PLACED: 'Placed',
  VENDOR_ASSIGNED: 'Offered to vendor',
  VENDOR_ACCEPTED: 'Vendor accepted',
  VENDOR_REJECTED: 'Vendor declined',
  PREPARING: 'Being prepared',
  DISPATCHED: 'Out for delivery',
  ARRIVING: 'Arriving',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  ON_DEMAND: 'One-off order',
  SUBSCRIPTION: 'Subscription delivery',

  // --- Payment / money ----------------------------------------------------
  COD: 'Cash on delivery',
  UPI: 'UPI',
  CARD: 'Card',
  NETBANKING: 'Net banking',
  WALLET: 'Neerly wallet',
  ORIGINAL: 'Original payment method',
  CASH: 'Cash',

  // --- Notification channels ---------------------------------------------
  IN_APP: 'In-app',
  PUSH: 'Push',
  SMS: 'SMS',
  EMAIL: 'Email',
  ORDER_OFFER: 'Order offered to vendor',
  SLA_WARNING: 'SLA warning',
  COMPLIANCE_EXPIRY: 'Licence expiry',

  // --- Dispute vocabulary -------------------------------------------------
  LATE_DELIVERY: 'Late delivery',
  WRONG_PRODUCT: 'Wrong product',
  DAMAGED_CONTAINER: 'Damaged container',
  WATER_QUALITY: 'Water quality',
  DRIVER_BEHAVIOUR: 'Driver behaviour',
  SHORT_QUANTITY: 'Short quantity',
  OVERCHARGED: 'Overcharged',
  OTHER: 'Other',
  FAILED_DELIVERY: 'Driver marked not delivered',
  REFUND: 'Refund to original payment method',
  WALLET_CREDIT: 'Credit to Neerly wallet',
  REPLACEMENT: 'Replacement delivery',
  VENDOR_PENALTY: 'Penalty against the vendor',
  NO_ACTION: 'No action — complaint not upheld',
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',

  // --- Surge sources ------------------------------------------------------
  MANUAL_ADMIN: 'Triggered by an admin',
  AUTO_DEMAND: 'Automatic · demand spike',
  AUTO_WEATHER: 'Automatic · weather',
  AUTO_SCARCITY: 'Automatic · supply scarcity',

  // --- Review moderation --------------------------------------------------
  VISIBLE: 'Public',
  PENDING_MODERATION: 'Awaiting moderation',
  HIDDEN_SPAM: 'Hidden as spam',
  HIDDEN_ABUSE: 'Hidden as abuse',
  DELETED: 'Deleted'
};

/** Human label for a wire enum. Falls back to title case for unknown values. */
export function label(value: string | null | undefined): string {
  if (!value) return '—';
  return LABELS[value] ?? humanize(value);
}

/**
 * Short form for dense cells (status pills, chips) — drops the "· explanation"
 * tail that the long label carries, so a table column stays one line.
 */
export function shortLabel(value: string | null | undefined): string {
  const full = label(value);
  const cut = full.indexOf(' · ');
  return cut > 0 ? full.slice(0, cut) : full;
}

/**
 * The platform's canonical product categories, in catalog order.
 *
 * Mirrors the seeded `product_templates` table. The admin catalog endpoint is
 * vendor-role-gated, so the price-band editor cannot fetch this list — but a
 * typed category code silently creates a band against a category that does not
 * exist, which is worse. Any code already in use is merged in at the call site,
 * so a category added on the backend still appears once a band references it.
 */
export const PRODUCT_CATEGORY_CODES: readonly string[] = [
  'JAR_20L_NORMAL', 'JAR_20L_COOL', 'JAR_20L_MINERAL', 'JAR_20L_RO',
  'BOTTLE_1L', 'BOTTLE_500ML', 'BOTTLE_2L',
  'TANKER_5000L', 'TANKER_10000L',
  'DISPENSER', 'ICE_BAG_5KG'
];
