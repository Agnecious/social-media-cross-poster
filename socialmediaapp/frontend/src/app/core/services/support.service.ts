import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppConfigService } from './app-config.service';
import { CustomerAuthService } from './customer-auth.service';

/** Support priority derived from the customer's plan. */
export type SupportPriority = 'High' | 'Normal' | 'Standard';

/**
 * SupportService — builds a plan-aware "Contact support" email and opens it in
 * the customer's mail client via a mailto: link. The subject encodes the
 * customer's name, plan, and priority so inbound tickets are easy to triage.
 *
 * mailto keeps this dependency-free (no SMTP, no secrets) and the destination
 * address is configurable (SUPPORT_EMAIL, surfaced via AppConfigService).
 */
@Injectable({ providedIn: 'root' })
export class SupportService {
  private readonly http = inject(HttpClient);
  private readonly appConfig = inject(AppConfigService);
  private readonly auth = inject(CustomerAuthService);

  /** Whether the backend can send support email server-side (SMTP configured). */
  get serverSendEnabled(): boolean {
    return this.appConfig.mailEnabled();
  }

  /**
   * Send a support message via the backend (server-side email). Throws on
   * failure; a 503 means mail isn't configured — callers should then fall back
   * to openContactEmail().
   */
  async sendMessage(message: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiBaseUrl}/customer/support`, { message })
    );
  }

  /** Map a plan id to its support priority. Agency gets the fastest lane. */
  priorityForPlan(plan: string | null | undefined): SupportPriority {
    switch ((plan || '').toLowerCase()) {
      case 'agency':
        return 'High';
      case 'pro':
        return 'Normal';
      default:
        return 'Standard'; // starter / trial / unknown
    }
  }

  /**
   * Open the customer's mail client with a pre-filled support email.
   * @param plan the customer's current plan id (for subject + priority)
   */
  openContactEmail(plan: string | null | undefined): void {
    const to = this.appConfig.supportEmail();
    const name = this.auth.displayName();
    const email = this.auth.email() ?? '';
    const planLabel = this.titleCase(plan || 'trial');
    const priority = this.priorityForPlan(plan);

    const subject = `[${priority} priority] ${name} — ${planLabel} plan — Support request`;
    const body = [
      `Name: ${name}`,
      `Account email: ${email}`,
      `Plan: ${planLabel}`,
      `Priority: ${priority}`,
      '',
      'How can we help?',
      '',
      '',
      '— Sent from Social Cross-Poster',
    ].join('\n');

    const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  private titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
