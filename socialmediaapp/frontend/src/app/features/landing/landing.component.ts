import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PlansService } from '../../core/services/plans.service';
import { Plan, PlanCurrency } from '../../core/models/plan.model';
import { RevealDirective } from '../../core/directives/reveal.directive';

/**
 * LandingComponent — a light-themed marketing home page.
 *
 * Original design inspired by common SaaS landing layouts: white header with
 * CTAs, a bold headline + primary CTA, a hero mock, a trust strip, and a
 * colourful "manage all your socials" bar. Uses the app's own branding.
 * All CTAs route into the app (Compose). Styles are component-scoped so they
 * don't affect the dark app screens.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, FormsModule, RevealDirective],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
})
export class LandingComponent implements OnInit {
  private readonly plansService = inject(PlansService);

  /** Social channels shown in the hero and the bottom bar. */
  readonly socials = [
    { name: 'Facebook', glyph: 'f', color: '#1877F2' },
    { name: 'Instagram', glyph: '◎', color: '#E4405F' },
    { name: 'TikTok', glyph: '♪', color: '#000000' },
    { name: 'X', glyph: '✕', color: '#000000' },
    { name: 'LinkedIn', glyph: 'in', color: '#0A66C2' },
    { name: 'YouTube', glyph: '▶', color: '#FF0000' },
    { name: 'Pinterest', glyph: 'P', color: '#BD081C' },
    { name: 'Google', glyph: 'G', color: '#4285F4' },
  ];

  /** Feature cards shown in the "Features" section. */
  readonly features = [
    {
      icon: '🔗',
      title: 'Connect your accounts',
      text: 'Securely link Facebook, Instagram, YouTube, and TikTok via their own login — we never see your password.',
    },
    {
      icon: '📝',
      title: 'Write once, post everywhere',
      text: 'Compose a single post, attach media, pick your platforms, and publish to all of them at once.',
    },
    {
      icon: '📅',
      title: 'Schedule ahead',
      text: 'Pick a future date and time. Supported platforms schedule natively; the rest post on time from the app.',
    },
    {
      icon: '🔒',
      title: 'Private by design',
      text: 'No database. Your posts and media are streamed straight to the platforms and never stored.',
    },
  ];

  /** Steps shown in the "How it works" section. */
  readonly steps = [
    { n: '1', title: 'Connect', text: 'Link the social accounts you want to post to.' },
    { n: '2', title: 'Compose', text: 'Write your post and choose which platforms to publish to.' },
    { n: '3', title: 'Publish or schedule', text: 'Post instantly, or set a time and let it go out automatically.' },
  ];

  /**
   * Pricing tiers, loaded from the backend catalogue (GET /api/plans) so prices
   * (ZAR) and features come from one editable place — no free tier, no rebuild
   * to change a price. `trialDays` drives the "start your N-day trial" copy.
   */
  readonly plans = signal<Plan[]>([]);
  readonly currency = signal<PlanCurrency>({ code: 'ZAR', symbol: 'R', locale: 'en-ZA' });
  readonly trialDays = signal<number>(30);
  readonly plansError = signal<string>('');

  /** Format a ZAR price for display (e.g. "R169"). */
  price(plan: Plan): string {
    return this.plansService.formatZar(plan.priceZar, this.currency().symbol);
  }

  /** Contact details shown in the "Get in Touch" section. */
  readonly contact = {
    email: 'mathema.business@gmail.com',
    company: 'Nkwana PTY',
    location: 'Gauteng, South Africa',
  };

  /** Contact form model. */
  readonly form = {
    fullName: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  };

  /** Load the plan catalogue (prices/features/trial) from the backend. */
  async ngOnInit(): Promise<void> {
    try {
      const cat = await this.plansService.catalogue();
      this.plans.set(cat.plans);
      this.currency.set(cat.currency);
      this.trialDays.set(cat.trialDays);
    } catch {
      this.plansError.set('Could not load pricing right now. Please try again later.');
    }
  }

  /** Smooth-scroll to a section on this page. */
  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** True when the required fields are filled. */
  get canSend(): boolean {
    return !!(this.form.fullName.trim() && this.form.email.trim() && this.form.subject.trim() && this.form.message.trim());
  }

  /**
   * Open the visitor's email client with a pre-filled message to us (mailto).
   * No backend and nothing stored — the visitor sends from their own client.
   */
  sendMessage(): void {
    if (!this.canSend) return;
    const subject = `[Website enquiry] ${this.form.subject}`;
    const body =
      `Name: ${this.form.fullName}\n` +
      `Email: ${this.form.email}\n` +
      `Phone: ${this.form.phone || '-'}\n\n` +
      `${this.form.message}\n`;
    const href =
      `mailto:${this.contact.email}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }
}
