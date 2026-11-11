import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { TitleCasePipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PlansService } from '../../core/services/plans.service';
import { Plan, PlanCurrency, BillingStatus } from '../../core/models/plan.model';
import { ToastService } from '../../core/services/toast.service';

/**
 * BillingComponent — the customer's Plan & Billing screen, and the mandatory
 * setup gate for new signups.
 *
 * When billing is ENABLED, a new customer is `pending_setup`: they must choose
 * a plan and add billing before any access. Choosing a plan starts checkout
 * (mock provider returns to this screen with `?mock_checkout=1`, which we
 * complete to start the trial). Once trialing/active, this screen shows status
 * (incl. trial post usage) and lets them change tier.
 *
 * When billing is DISABLED, it behaves as the old display-only plan switcher.
 */
@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [TitleCasePipe, DatePipe],
  templateUrl: './billing.component.html',
})
export class BillingComponent implements OnInit {
  private readonly plansService = inject(PlansService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly plans = signal<Plan[]>([]);
  readonly currency = signal<PlanCurrency>({ code: 'ZAR', symbol: 'R', locale: 'en-ZA' });
  readonly trialDays = signal<number>(30);

  readonly billing = signal<BillingStatus | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string>('');
  readonly saving = signal<string>(''); // plan id being acted on
  readonly notice = signal<string>('');

  /** Customer must set up billing before using the app. */
  readonly needsSetup = computed(() => this.billing()?.subscriptionStatus === 'pending_setup');
  readonly isTrialing = computed(() => this.billing()?.subscriptionStatus === 'trialing');
  readonly isActive = computed(() => this.billing()?.subscriptionStatus === 'active');
  readonly billingEnabled = computed(() => !!this.billing()?.enabled);
  readonly isMock = computed(() => this.billing()?.provider === 'mock');

  async ngOnInit(): Promise<void> {
    try {
      const [cat, billing] = await Promise.all([
        this.plansService.catalogue(),
        this.plansService.billing(),
      ]);
      this.plans.set(cat.plans);
      this.currency.set(cat.currency);
      this.trialDays.set(cat.trialDays);
      this.billing.set(billing);

      // Returning from the simulated checkout page. The checkout itself already
      // completed (or was cancelled) there; just surface the outcome + refresh.
      const qp = this.route.snapshot.queryParamMap;
      const checkoutResult = qp.get('mock_checkout');
      if (checkoutResult === 'done') {
        this.billing.set(await this.plansService.billing());
        this.notice.set('Payment successful — your subscription is active.');
      } else if (checkoutResult === 'cancelled') {
        this.notice.set('Checkout cancelled — choose a plan to get started.');
      }
      if (checkoutResult) {
        // Strip the query param so a refresh doesn't re-run it.
        void this.router.navigate([], { queryParams: {} });
      }
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't load billing", msg);
    } finally {
      this.loading.set(false);
    }
  }

  price(plan: Plan): string {
    return this.plansService.formatZar(plan.priceZar, this.currency().symbol);
  }

  isCurrent(plan: Plan): boolean {
    return this.billing()?.plan === plan.id;
  }

  /**
   * True when the customer is actively on this plan (active or trialing) — in
   * which case re-selecting it is blocked. For canceled/past_due the plan is
   * still "current" (for highlighting) but re-subscribing IS allowed, so this
   * returns false there.
   */
  isLockedPlan(plan: Plan): boolean {
    return this.isCurrent(plan) && (this.isActive() || this.isTrialing());
  }

  /**
   * Choose a plan. When billing is enabled this starts checkout (add billing);
   * when disabled it's a straight plan switch (legacy behaviour).
   */
  async choose(plan: Plan): Promise<void> {
    if (this.saving()) return;
    // Guard: you're already on this plan (active/trialing) — nothing to do.
    if (this.isLockedPlan(plan)) return;
    this.saving.set(plan.id);
    this.notice.set('');
    this.error.set('');
    try {
      if (!this.billingEnabled()) {
        // Legacy: DB-only plan change.
        await this.plansService.changePlan(plan.id);
        this.billing.set(await this.plansService.billing());
        this.notice.set(`Your plan is now ${plan.name}.`);
        this.toast.success(`Plan changed to ${plan.name}.`);
        return;
      }
      // Billing on: start checkout. The returnUrl brings the user back here.
      const returnUrl = window.location.origin + '/billing';
      const res = await this.plansService.subscribe(plan.id, returnUrl);
      if (res.redirectUrl) {
        // Hosted payment page (mock: our own screen via query params).
        this.toast.info('Redirecting to checkout…', `Setting up ${plan.name}.`);
        window.location.href = res.redirectUrl;
      } else {
        const msg = 'Could not start checkout (no redirect URL).';
        this.error.set(msg);
        this.toast.error("Couldn't start checkout", msg);
      }
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't change plan", msg);
    } finally {
      this.saving.set('');
    }
  }

  /** Mock-provider dev controls to simulate payment outcomes. */
  async mock(outcome: string): Promise<void> {
    this.saving.set('mock:' + outcome);
    this.error.set('');
    this.notice.set('');
    try {
      this.billing.set(await this.plansService.mockComplete(outcome));
      this.notice.set(`Mock: ${outcome} applied.`);
      this.toast.info(`Mock: ${outcome} applied.`);
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error('Mock action failed', msg);
    } finally {
      this.saving.set('');
    }
  }

  /** Cancel the active/trialing subscription (stops future charges). */
  async cancelSubscription(): Promise<void> {
    if (this.saving()) return;
    if (!confirm('Cancel your subscription? You will lose access at the end of this period.')) return;
    this.saving.set('cancel');
    this.error.set('');
    this.notice.set('');
    try {
      this.billing.set(await this.plansService.cancel());
      this.notice.set('Your subscription has been canceled.');
      this.toast.success('Subscription canceled', 'Future charges have been stopped.');
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't cancel", msg);
    } finally {
      this.saving.set('');
    }
  }
}

/** Pull a readable message out of an HttpErrorResponse or Error. */
function extractError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const any = e as { error?: { error?: string } | string; message?: string };
    if (any.error && typeof any.error === 'object' && typeof any.error.error === 'string') {
      return any.error.error;
    }
    if (typeof any.error === 'string') return any.error;
    if (typeof any.message === 'string') return any.message;
  }
  return 'Something went wrong. Please try again.';
}
