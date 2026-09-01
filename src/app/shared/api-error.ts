import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turns whatever HttpClient handed back into one sentence an admin can act on.
 *
 * The backend speaks a canonical envelope (`{ error: { code, message } }`), but
 * a 403 from an L2-gated endpoint and a dead backend both surface here, and
 * they call for different responses from the person reading the screen — so the
 * status is translated rather than dumped.
 *
 * Server messages are written for a developer reading a log ("Cannot transition
 * DISPATCHED → CANCELLED"). The operator needs to know what happened to their
 * order and what to do next, so known codes get a sentence written for them and
 * the machine code never reaches the screen.
 */

/**
 * What each error code means for the person who just pressed the button.
 *
 * Only codes an admin action can actually produce are listed. Anything else
 * falls through to the status-based copy below — better a slightly generic
 * sentence than a state-machine trace.
 */
const CODE_COPY: Record<string, string> = {
  ORDER_INVALID_STATE_TRANSITION:
    'This order has already moved past the point where that is allowed — a driver has it, or it has already finished. Refresh the board to see where it actually is.',
  ORDER_NOT_FOUND: 'That order no longer exists on the platform.',
  ORDER_NO_VENDOR_FOUND:
    'No vendor in that service area could take this order. Nothing changed — the order is still where it was.',
  ORDER_OUT_OF_SERVICE_AREA:
    'The delivery address falls outside every live vendor’s service area, so routing has nowhere to send it.',
  ORDER_VENDOR_CAPACITY_EXCEEDED:
    'Every eligible vendor is already at their daily capacity. Try again once one frees up.',
  ORDER_OTP_MISMATCH: 'The delivery code did not match the one issued to the customer.',

  VENDOR_NOT_FOUND: 'That vendor is no longer on the platform.',
  VENDOR_NOT_VERIFIED: 'This vendor is still Tier-2 — their licence has to be approved before they can go live.',
  VENDOR_SUSPENDED: 'This vendor is suspended, so the platform will not route anything to them.',
  VENDOR_UNAVAILABLE: 'The vendor is closed right now — outside business hours or on an emergency close.',
  VENDOR_FSSAI_EXPIRED: 'This vendor’s FSSAI licence has lapsed, so they are blocked from selling until it is renewed.',

  PAYMENT_AUTHORIZE_FAILED: 'The payment rail refused the request. No money moved.',
  PAYMENT_CAPTURE_FAILED: 'The payment gateway failed while settling this. No money moved — safe to retry.',
  PAYMENT_IDEMPOTENCY_CONFLICT: 'A different request already used this id. Reload and try once more.',

  COMMON_VALIDATION_FAILED: 'The server rejected one of the values on this form.',
  COMMON_RATE_LIMITED: 'Too many requests in a short window. Wait a moment and try again.',
  COMMON_IDEMPOTENCY_REPLAY: 'This had already gone through — the earlier result stands, nothing ran twice.',
  COMMON_IDEMPOTENCY_CONFLICT: 'A different request already used this id. Reload and try once more.',
  COMMON_UPSTREAM_TIMEOUT: 'A service the platform depends on timed out. Nothing was changed — try again.',
  COMMON_UNEXPECTED: 'The server hit an error it did not expect. Nothing was changed.',
  COMMON_NOT_FOUND: 'That record is not on this backend.'
};

interface Envelope { message?: string; code?: string }

function envelopeOf(err: unknown): Envelope | undefined {
  const e = err as HttpErrorResponse | undefined;
  return (e?.error as { error?: Envelope } | undefined)?.error;
}

/**
 * Copy for a *load* that failed: the screen has no data to show, so the sentence
 * names what could not be fetched.
 */
export function describeError(err: unknown, subject = 'this data'): string {
  const e = err as HttpErrorResponse | undefined;
  const envelope = envelopeOf(err);

  if (e?.status === 0) {
    return 'The Neerly API is unreachable — check that the backend is running on :8080.';
  }
  if (e?.status === 403) {
    return `Your admin role is not cleared for ${subject}. Surge, promos, price bands, payouts and the audit log need ADMIN_L2 or above.`;
  }
  if (envelope?.code && CODE_COPY[envelope.code]) {
    return CODE_COPY[envelope.code];
  }
  if (e?.status === 404) {
    return `That endpoint isn't available on this backend build.`;
  }
  // A 400 is the server telling us what we got wrong, in words meant to be read.
  // Appending the machine code to that only adds noise.
  if (e?.status === 400 && envelope?.message) {
    return envelope.message;
  }
  if (e?.status && e.status >= 500) {
    return `The server failed while loading ${subject} (HTTP ${e.status}).`;
  }
  if (envelope?.message) {
    return envelope.message;
  }
  return e?.message ?? `Something went wrong loading ${subject}.`;
}

/**
 * Copy for an *action* that failed.
 *
 * Kept separate from `describeError` because the two are read in different
 * places and mean different things: a load error means the list is empty, an
 * action error means the list is fine and the thing you just tried is not. The
 * sentence therefore leads with what did not happen, and always ends by saying
 * the underlying record is untouched — the single most useful fact after a 4xx
 * on a screen full of money.
 *
 * `attempt` is the action in gerund form, e.g. "cancelling this order".
 */
export function describeActionError(err: unknown, attempt: string): string {
  const e = err as HttpErrorResponse | undefined;
  const envelope = envelopeOf(err);

  if (e?.status === 0) {
    return `Couldn't reach the Neerly API, so ${attempt} did not happen. Nothing changed.`;
  }
  if (e?.status === 403) {
    return `Your admin role is not cleared for ${attempt}. This needs ADMIN_L2 or above.`;
  }
  if (envelope?.code && CODE_COPY[envelope.code]) {
    return CODE_COPY[envelope.code];
  }
  if (e?.status === 409) {
    return `Somebody — or something — changed this record first, so ${attempt} was refused. Refresh and look again.`;
  }
  if (e?.status === 404) {
    return `That record was not found, so ${attempt} did not happen.`;
  }
  if ((e?.status === 400 || e?.status === 422) && envelope?.message) {
    return envelope.message;
  }
  if (e?.status && e.status >= 500) {
    return `The server failed while ${attempt} (HTTP ${e.status}). Nothing was changed — safe to retry.`;
  }
  return envelope?.message ?? `Something went wrong while ${attempt}.`;
}
