import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { EvidenceService } from '../evidence.service';

/**
 * The filed evidence, rendered.
 *
 * Every screen that decides something on photographs uses this: damage claims,
 * dispute attachments, compliance uploads. Images become thumbnails that open
 * full size in a new tab; anything else (a PDF licence) becomes a named link.
 * A file the backend cannot hand out a view link for still appears, as its key
 * plus a plain sentence saying it is not openable from here — because "we hold
 * two photos you cannot see" and "no photos were filed" must never look alike
 * on a screen where one of them means uphold and the other means dismiss.
 */
@Component({
  selector: 'app-evidence-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .strip { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }

    .item {
      display: block; width: 64px;
      text-decoration: none; color: inherit;
    }
    .item.wide { width: auto; max-width: 220px; }

    .frame {
      width: 64px; height: 64px; border-radius: var(--r-sm);
      border: 1px solid var(--ink-200); background: var(--ink-50);
      display: grid; place-items: center; overflow: hidden;
    }
    .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
    a.item:hover .frame { border-color: var(--admn); }

    .glyph { font-size: 17px; color: var(--ink-400); }
    .frame.pending {
      background: linear-gradient(90deg, var(--ink-100) 25%, var(--ink-50) 50%, var(--ink-100) 75%);
      background-size: 240% 100%; animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer { 0% { background-position: 120% 0; } 100% { background-position: -20% 0; } }
    .frame.dead { border-style: dashed; background: var(--ink-50); }

    .cap {
      font-size: 10.5px; line-height: 1.35; color: var(--ink-500);
      margin-top: 4px; word-break: break-all;
    }
    .cap.link { color: var(--admn); font-weight: 650; }

    .unavailable {
      font-size: 11px; color: var(--warn-ink); line-height: 1.4;
      background: var(--warn-soft); border-radius: var(--r-sm);
      padding: 6px 9px; margin-top: 7px; max-width: 44ch; font-weight: 600;
    }
    .unavailable strong { display: block; }
    .none { font-size: 12.5px; color: var(--ink-500); }
  `],
  template: `
    @if (!keys.length) {
      <div class="none">{{ emptyText }}</div>
    } @else {
      <div class="strip">
        @for (k of keys; track k) {
          @if (view(k); as v) {
            @if (v.state === 'ready' && v.url) {
              <a class="item" [class.wide]="!isImage(k)" [href]="v.url" target="_blank" rel="noopener noreferrer"
                 [title]="k">
                <span class="frame">
                  @if (isImage(k)) {
                    <img [src]="v.url" [alt]="'Filed evidence — ' + name(k)" loading="lazy" />
                  } @else {
                    <span class="glyph" aria-hidden="true">↗</span>
                  }
                </span>
                <span class="cap link">{{ name(k) }}</span>
              </a>
            } @else if (v.state === 'loading') {
              <span class="item">
                <span class="frame pending" aria-hidden="true"></span>
                <span class="cap">Opening…</span>
              </span>
            } @else {
              <span class="item" [class.wide]="!isImage(k)" [title]="k + ' — on record, not viewable here'">
                <span class="frame dead"><span class="glyph" aria-hidden="true">✕</span></span>
                <span class="cap">{{ name(k) }}</span>
              </span>
            }
          }
        }
      </div>

      @if (blocked(); as reason) {
        <div class="unavailable">
          <strong>On record, not viewable here.</strong>
          {{ reason }} Decide as though you have not seen {{ blockedCount() === 1 ? 'it' : 'them' }} — this is not
          the same as no evidence being filed.
        </div>
      }
    }
  `
})
export class EvidenceStripComponent {
  private evidence = inject(EvidenceService);

  private keyList = signal<string[]>([]);

  @Input({ required: true })
  set keys(value: string[] | null | undefined) { this.keyList.set(value ?? []); }
  get keys(): string[] { return this.keyList(); }

  /** Shown when nothing was filed at all. Required copy — "none" teaches nothing. */
  @Input() emptyText = 'No files were filed against this record.';

  view(key: string) { return this.evidence.link(key)(); }
  name(key: string) { return this.evidence.fileName(key); }
  isImage(key: string) { return this.evidence.isImage(key); }

  readonly blockedCount = computed(() =>
    this.keyList().filter(k => this.evidence.link(k)().state === 'unavailable').length);

  /** The first reason any file could not be opened, or null while all are fine. */
  readonly blocked = computed<string | null>(() => {
    for (const k of this.keyList()) {
      const v = this.evidence.link(k)();
      if (v.state === 'unavailable') return v.reason;
    }
    return null;
  });
}
