import { Directive, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * RevealDirective (`appReveal`) — fades/slides an element into view when it
 * scrolls into the viewport, for the landing page's scroll animations.
 *
 * Dependency-free (uses the browser's IntersectionObserver). The element starts
 * in a hidden state (via the `.reveal` class the directive adds) and gets
 * `.is-visible` once it enters view, which CSS transitions animate. Honours
 * `prefers-reduced-motion`: motion-averse users see everything immediately.
 *
 * Usage:
 *   <section appReveal>…</section>
 *   <div appReveal [revealDelay]="120">…</div>   <!-- stagger in ms -->
 */
@Directive({
  selector: '[appReveal]',
  standalone: true,
})
export class RevealDirective implements OnInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Optional stagger delay (ms) applied before the element reveals. */
  @Input() revealDelay = 0;

  private observer?: IntersectionObserver;

  ngOnInit(): void {
    const el = this.host.nativeElement;

    // Respect reduced-motion / missing IO: show immediately, no animation.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal', 'is-visible');
      return;
    }

    el.classList.add('reveal');
    if (this.revealDelay > 0) {
      el.style.transitionDelay = `${this.revealDelay}ms`;
    }

    this.observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-visible');
            obs.unobserve(el); // reveal once, then stop watching
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
    );
    this.observer.observe(el);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
