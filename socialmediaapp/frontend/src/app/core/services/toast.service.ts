import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** ms before auto-dismiss; 0 = sticky (manual close only). */
  duration: number;
  /** true once the exit animation has been triggered (so the view can fade it out). */
  leaving?: boolean;
}

/**
 * ToastService — app-wide transient notifications (top-right).
 *
 * Any component injects this and calls success()/error()/info(). The single
 * ToastContainer (mounted in the app shell) renders + animates them. State is
 * a signal so the container reacts automatically.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Green success toast (default 4s). */
  success(title: string, message?: string, duration = 4000): number {
    return this.show('success', title, message, duration);
  }

  /** Red error toast — sticks a little longer by default (6s). */
  error(title: string, message?: string, duration = 6000): number {
    return this.show('error', title, message, duration);
  }

  /** Neutral info toast (default 4s). */
  info(title: string, message?: string, duration = 4000): number {
    return this.show('info', title, message, duration);
  }

  show(kind: ToastKind, title: string, message?: string, duration = 4000): number {
    const id = ++this.seq;
    const toast: Toast = { id, kind, title, message, duration };
    this.toasts.update((list) => [...list, toast]);
    if (duration > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), duration)
      );
    }
    return id;
  }

  /**
   * Begin dismissing a toast: flag it `leaving` (triggers the exit animation),
   * then remove it after the animation window.
   */
  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => {
      this.toasts.update((list) => list.filter((x) => x.id !== id));
    }, 220); // must match the CSS exit animation duration
  }

  /** Clear everything (e.g. on route change / sign-out). */
  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.toasts.set([]);
  }
}
