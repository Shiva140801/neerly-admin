import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turns whatever HttpClient handed back into one sentence an admin can act on.
 *
 * The backend speaks a canonical envelope (`{ error: { code, message } }`), but
 * a 403 from an L2-gated endpoint and a dead backend both surface here, and
 * they call for different responses from the person reading the screen — so the
 * status is translated rather than dumped.
 */
export function describeError(err: unknown, subject = 'this data'): string {
  const e = err as HttpErrorResponse | undefined;
  const envelope = (e?.error as { error?: { message?: string; code?: string } } | undefined)?.error;

  if (e?.status === 0) {
    return 'The Neerly API is unreachable — check that the backend is running on :8080.';
  }
  if (e?.status === 403) {
    return `Your admin role is not cleared for ${subject}. Surge, promos, price bands, payouts and the audit log need ADMIN_L2 or above.`;
  }
  if (e?.status === 404) {
    return `That endpoint isn't available on this backend build.`;
  }
  // A 400 is the server telling us what we got wrong, in words meant to be read.
  // Appending the machine code to that only adds noise.
  if (e?.status === 400 && envelope?.message) {
    return envelope.message;
  }
  if (envelope?.message) {
    return envelope.code ? `${envelope.message} (${envelope.code})` : envelope.message;
  }
  if (e?.status && e.status >= 500) {
    return `The server failed while loading ${subject} (HTTP ${e.status}).`;
  }
  return e?.message ?? `Something went wrong loading ${subject}.`;
}
