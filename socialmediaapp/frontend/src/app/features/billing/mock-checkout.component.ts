import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PlansService } from '../../core/services/plans.service';
import { ToastService } from '../../core/services/toast.service';
import { Plan, PlanCurrency } from '../../core/models/plan.model';

/**
 * MockCheckoutComponent — a simulated provider-hosted payment page.
 *
 * This stands in for a real payment provider's hosted checkout (e.g. Peach)
 * while billing runs on the MOCK provider. It shows a fake card form and a plan
 * summary, and on "Pay" it completes the (mock) checkout — starting the trial —
 * then redirects back to the app. NO real money and NO real card handling: the
 * fields are inert and never submitted anywhere.
 *
 * Reached via the `redirectUrl` the mock provider returns from startCheckout.
 * Query params: plan (id), sub (provider subscription id), ret (return URL).
 */
@Component({
  selector: 'app-mock-checkout',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mock-checkout.component.html',
})
export class MockCheckoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly plansSvc = inject(PlansService);
  private readonly toast = inject(ToastService);

  readonly planId = signal<string>('');
  readonly plan = signal<Plan | null>(null);
  readonly currency = signal<PlanCurrency>({ code: 'ZAR', symbol: 'R', locale: 'en-ZA' });
  readonly loading = signal(true);
  readonly paying = signal(false);
  private returnUrl = '/billing';

  // Inert demo card fields (never submitted anywhere).
  readonly cardName = signal('');
  readonly cardNumber = signal('');
  readonly cardExpiry = signal('');
  readonly cardCvc = signal('');

  readonly priceLabel = computed(() => {
    const p = this.plan();
    return p ? this.plansSvc.formatZar(p.priceZar, this.currency().symbol) : '';
  });

  async ngOnInit(): Promise<void> {
    const qp = this.route.snapshot.queryParamMap;
    this.planId.set(qp.get('plan') || '');
    this.returnUrl = qp.get('ret') || '/billing';
    try {
      const cat = await this.plansSvc.catalogue();
      this.currency.set(cat.currency);
      this.plan.set(cat.plans.find((p) => p.id === this.planId()) ?? null);
    } catch {
      // Non-critical — the page still works without the price summary.
    } finally {
      this.loading.set(false);
    }
  }

  /** "Pay" — complete the mock checkout (starts the trial), then return. */
  async pay(): Promise<void> {
    if (this.paying()) return;
    this.paying.set(true);
    try {
      // A completed payment = an ACTIVE subscription (no trial). The trial is
      // only for customers who haven't paid yet.
      await this.plansSvc.mockComplete('paid');
      this.toast.success('Payment successful', 'Your subscription is active.');
      this.goBack('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.toast.error('Checkout failed', msg);
      this.paying.set(false);
    }
  }

  /** "Cancel" — go back without completing (customer stays pending_setup). */
  cancel(): void {
    this.toast.info('Checkout cancelled', 'You can choose a plan again anytime.');
    this.goBack('cancelled');
  }

  /** Navigate back to the return URL (same-origin → internal route). */
  private goBack(status: 'done' | 'cancelled'): void {
    const path = this.toInternalPath(this.returnUrl);
    void this.router.navigate([path], { queryParams: { mock_checkout: status } });
  }

  /** Reduce an absolute same-origin URL to its path for the router. */
  private toInternalPath(url: string): string {
    try {
      if (url.startsWith('/')) return url;
      return new URL(url).pathname || '/billing';
    } catch {
      return '/billing';
    }
  }
}
