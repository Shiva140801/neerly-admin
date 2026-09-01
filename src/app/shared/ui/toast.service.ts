import { Injectable, signal } from '@angular/core';

export type ToastTone = 'ok' | 'info' | 'warn';

export interface Toast {
  id: number;
  tone: ToastTone;
  /** What just happened, in the past tense: "Order NEE-26243-0002 cancelled". */
  text: string;
  /** Optional second line naming the consequence that is now in motion. */
  detail?: string;
}

/**
 * The portal's only success channel.
 *
 * Before this, every mutation completed in silence and simply re-fetched the
 * list — so on a screen where the row disappears after you act on it, success
 * and a swallowed failure looked identical, and on a screen where nothing
 * visibly changes ("Run weekly job") there was no way at all to tell a 200 from
 * a no-op. Every mutation now says what it did, in the operator's words, and
 * names the number that proves it where one exists.
 *
 * Deliberately not an error channel: a failed action needs to stay on screen
 * next to the control that produced it, not fade out after four seconds.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  /** Milliseconds a toast stays up. Long enough to read two lines. */
  private readonly ttl = 5200;

  success(text: string, detail?: string) { this.push('ok', text, detail); }
  info(text: string, detail?: string) { this.push('info', text, detail); }
  /** Completed, but with a caveat the admin should read — e.g. a job that staged nothing. */
  warn(text: string, detail?: string) { this.push('warn', text, detail); }

  dismiss(id: number) {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }

  private push(tone: ToastTone, text: string, detail?: string) {
    const id = ++this.seq;
    // Newest on top, and never more than three at once — a stack taller than
    // that stops being feedback and starts being a wall.
    this.toasts.update(list => [{ id, tone, text, detail }, ...list].slice(0, 3));
    setTimeout(() => this.dismiss(id), this.ttl);
  }
}
