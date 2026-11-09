import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { ApiClient } from '../core/api/api-client';

export type EvidenceState = 'loading' | 'ready' | 'unavailable';

export interface EvidenceLink {
  /** The S3 object key exactly as the backend returned it. */
  key: string;
  state: EvidenceState;
  /** Short-lived presigned GET, present only while `state === 'ready'`. */
  url: string | null;
  /** Why it cannot be opened, in the operator's words. */
  reason: string | null;
}

interface PresignReadResponse { url: string; expiresInSeconds?: number }

/**
 * Turns an S3 key into something the admin can actually open.
 *
 * The arbitration screens are built around evidence — "a claim with no photos is
 * not one to uphold" — but the payloads carry only object keys, so the UI was
 * drawing empty grey squares and asking the operator to move a customer's
 * deposit on files they had never seen.
 *
 * `POST /uploads/presign-read` exchanges a key for a short-lived GET URL — a signed
 * link to the backend's own `/media/{key}` while photos are kept in the database
 * (setting `media.storage` = DB), or a presigned S3 URL once S3 is switched on. Where
 * object storage is not configured — local and CI have no AWS credentials, and
 * the endpoint answers 503 `UPLOAD_STORAGE_UNAVAILABLE` — the fallback is
 * deliberately honest: the key is shown as a labelled reference and the strip
 * says the file cannot be viewed here. "We hold two photos you cannot open" and
 * "no photos were filed" are different facts, and on an arbitration screen the
 * difference is the whole verdict.
 *
 * Results are cached per key for the session; presigned URLs are short-lived but
 * comfortably outlast the few minutes an arbitration takes, and a cache keeps a
 * table of twelve thumbnails from firing twelve requests per render.
 */
@Injectable({ providedIn: 'root' })
export class EvidenceService {
  private api = inject(ApiClient);
  private cache = new Map<string, WritableSignal<EvidenceLink>>();

  /**
   * A signal for this key. Safe to call from a template: the fetch is fired once
   * per key and every later caller gets the same signal back.
   */
  link(key: string): Signal<EvidenceLink> {
    const existing = this.cache.get(key);
    if (existing) return existing.asReadonly();

    const slot = signal<EvidenceLink>({ key, state: 'loading', url: null, reason: null });
    this.cache.set(key, slot);

    this.api.post<PresignReadResponse>('/uploads/presign-read', { s3Key: key }).subscribe({
      next: res => slot.set(res?.url
        ? { key, state: 'ready', url: res.url, reason: null }
        : { key, state: 'unavailable', url: null, reason: 'The storage service returned no link for this file.' }),
      error: err => {
        const status = (err as { status?: number })?.status;
        const code = (err as { error?: { error?: { code?: string } } })?.error?.error?.code;
        slot.set({
          key,
          state: 'unavailable',
          url: null,
          reason: status === 503 || code === 'UPLOAD_STORAGE_UNAVAILABLE'
            ? 'Object storage is not configured in this environment.'
            : code === 'MEDIA_NOT_FOUND'
              ? 'This file was never uploaded — the app sent a reference without the photo.'
              : status === 404
              ? 'This backend cannot hand out view links yet.'
              : 'The storage service refused a view link for this file.'
        });
      }
    });

    return slot.asReadonly();
  }

  /** Last path segment, for a readable caption under a thumbnail. */
  fileName(key: string): string {
    const parts = key.split('/');
    return parts[parts.length - 1] || key;
  }

  /** True when the key looks like something a browser can render inline. */
  isImage(key: string): boolean {
    return /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(key);
  }
}
