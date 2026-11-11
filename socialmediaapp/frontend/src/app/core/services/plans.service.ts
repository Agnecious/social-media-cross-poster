import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PlanCatalogue, Plan, Subscription, BillingStatus, SubscribeResponse } from '../models/plan.model';

/**
 * PlansService — reads the public plan catalogue (prices in ZAR, features,
 * trial info) from GET /api/plans, and the signed-in customer's subscription
 * plus upgrade/downgrade via /api/customer/subscription and /api/customer/plan.
 *
 * The catalogue is the single source of truth for pricing; the UI never
 * hardcodes amounts. The catalogue is cached after first load.
 */
@Injectable({ providedIn: 'root' })
export class PlansService {
  private readonly http = inject(HttpClient);
  private cache: PlanCatalogue | null = null;

  /** Fetch the plan catalogue (cached). */
  async catalogue(): Promise<PlanCatalogue> {
    if (this.cache) return this.cache;
    const res = await firstValueFrom(
      this.http.get<PlanCatalogue>(`${environment.apiBaseUrl}/plans`)
    );
    this.cache = res;
    return res;
  }

  /** Format a ZAR amount for display, e.g. 169 -> "R169". null -> "Custom". */
  formatZar(amount: number | null, symbol = 'R'): string {
    if (amount == null) return 'Custom';
    return `${symbol}${amount.toLocaleString('en-ZA')}`;
  }

  /** The signed-in customer's current subscription + trial status. */
  subscription(): Promise<Subscription> {
    return firstValueFrom(
      this.http.get<Subscription>(`${environment.apiBaseUrl}/customer/subscription`)
    );
  }

  /** Change the signed-in customer's plan (upgrade/downgrade anytime). */
  changePlan(plan: string): Promise<Subscription> {
    return firstValueFrom(
      this.http.put<Subscription>(`${environment.apiBaseUrl}/customer/plan`, { plan })
    );
  }

  // --- Billing (subscriptions) ---

  /** The signed-in customer's billing status (plan, access state, trial usage). */
  billing(): Promise<BillingStatus> {
    return firstValueFrom(
      this.http.get<BillingStatus>(`${environment.apiBaseUrl}/customer/billing`)
    );
  }

  /** Start checkout for a plan. Returns a redirect URL (hosted payment page). */
  subscribe(plan: string, returnUrl: string): Promise<SubscribeResponse> {
    return firstValueFrom(
      this.http.post<SubscribeResponse>(`${environment.apiBaseUrl}/customer/billing/subscribe`, { plan, returnUrl })
    );
  }

  /** Cancel the signed-in customer's subscription (stops future charges). */
  cancel(): Promise<BillingStatus> {
    return firstValueFrom(
      this.http.post<BillingStatus>(`${environment.apiBaseUrl}/customer/billing/cancel`, {})
    );
  }

  /**
   * DEV/MOCK ONLY: simulate the provider completing checkout.
   * outcome: 'trial' | 'paid' | 'failed' | 'canceled'.
   */
  mockComplete(outcome: string): Promise<BillingStatus> {
    return firstValueFrom(
      this.http.post<BillingStatus>(`${environment.apiBaseUrl}/customer/billing/mock/complete`, { outcome })
    );
  }
}
