import { Component, inject } from '@angular/core';
import { ToastService } from '../services/toast.service';

/**
 * ToastContainer — renders the stack of toasts (top-right) with slide+fade
 * animations. Mounted once in the app shell. Styling uses the app's CSS
 * variables so it matches light/dark; honours prefers-reduced-motion.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  template: `
    <div class="toast-wrap" aria-live="polite" aria-atomic="false">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class.leaving]="t.leaving" [attr.data-kind]="t.kind" role="status">
          <span class="toast-icon" aria-hidden="true">
            @switch (t.kind) {
              @case ('success') { ✓ }
              @case ('error') { ✕ }
              @default { i }
            }
          </span>
          <div class="toast-body">
            <div class="toast-title">{{ t.title }}</div>
            @if (t.message) { <div class="toast-msg">{{ t.message }}</div> }
          </div>
          <button class="toast-close" (click)="toast.dismiss(t.id)" aria-label="Dismiss">✕</button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-wrap {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 2000;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: min(440px, calc(100vw - 32px));
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 13px;
        min-width: 320px;
        background: var(--surface, #fff);
        color: var(--text, #0f172a);
        border: 1px solid var(--border, #e5e9f0);
        border-left: 5px solid var(--toast-accent);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 12px 36px rgba(15, 23, 42, 0.2);
        animation: toast-in 0.26s cubic-bezier(0.21, 1.02, 0.73, 1);
      }
      .toast.leaving { animation: toast-out 0.2s ease forwards; }
      .toast[data-kind='success'] { --toast-accent: var(--ok, #16a34a); }
      .toast[data-kind='error'] { --toast-accent: var(--fail, #dc2626); }
      .toast[data-kind='info'] { --toast-accent: var(--primary, #2f6bff); }

      .toast-icon {
        flex: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 800;
        color: #fff;
        background: var(--toast-accent);
        margin-top: 1px;
      }
      .toast-body { flex: 1; min-width: 0; }
      .toast-title { font-weight: 700; font-size: 15.5px; line-height: 1.35; }
      .toast-msg { font-size: 14px; color: var(--muted, #64748b); margin-top: 3px; line-height: 1.45; word-break: break-word; }
      .toast-close {
        flex: none;
        background: transparent;
        border: none;
        color: var(--muted, #64748b);
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 3px 5px;
        border-radius: 6px;
      }
      .toast-close:hover { color: var(--text, #0f172a); }

      @keyframes toast-in {
        from { opacity: 0; transform: translateX(24px) scale(0.98); }
        to { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes toast-out {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(24px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast, .toast.leaving { animation: none; }
      }
    `,
  ],
})
export class ToastContainerComponent {
  readonly toast = inject(ToastService);
}
