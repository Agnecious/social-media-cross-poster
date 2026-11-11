import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CustomerAuthService } from '../../core/services/customer-auth.service';
import { ToastService } from '../../core/services/toast.service';
import { SupportService } from '../../core/services/support.service';
import { AppConfigService } from '../../core/services/app-config.service';
import { PlansService } from '../../core/services/plans.service';

/**
 * SupportComponent — the "Contact support" page.
 *
 * Two modes, chosen by whether the backend has SMTP configured:
 *  - server-side send → an in-app message form (POST /api/customer/support),
 *  - otherwise → a button that opens the customer's mail client (mailto:).
 *
 * The message is tagged with the customer's plan + priority (Agency = High,
 * Pro = Normal, else Standard), derived server-side on send.
 */
@Component({
  selector: 'app-support',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './support.component.html',
})
export class SupportComponent implements OnInit {
  private readonly auth = inject(CustomerAuthService);
  private readonly toast = inject(ToastService);
  private readonly support = inject(SupportService);
  private readonly appConfig = inject(AppConfigService);
  private readonly plansSvc = inject(PlansService);

  readonly email = this.auth.email;

  /** The customer's current plan (for support priority + display). */
  readonly plan = signal<string>('');
  readonly supportEmail = this.appConfig.supportEmail;
  readonly supportPriority = computed(() => this.support.priorityForPlan(this.plan()));

  /** Server-side send available? Drives form vs mailto button. */
  readonly serverSend = this.appConfig.mailEnabled;
  readonly supportMessage = signal('');
  readonly sendingSupport = signal(false);

  async ngOnInit(): Promise<void> {
    void this.appConfig.load();
    try {
      const sub = await this.plansSvc.subscription();
      this.plan.set(sub.plan);
    } catch {
      // Non-critical — the contact action still works with a default priority.
    }
  }

  /** Open a pre-filled support email (name + plan + priority in the subject). */
  contactSupport(): void {
    this.support.openContactEmail(this.plan());
  }

  /**
   * Send the message through the backend. If the server reports mail isn't
   * configured (503), fall back to the mailto: flow transparently.
   */
  async sendSupport(): Promise<void> {
    const msg = this.supportMessage().trim();
    if (!msg || this.sendingSupport()) return;
    this.sendingSupport.set(true);
    try {
      await this.support.sendMessage(msg);
      this.supportMessage.set('');
      this.toast.success('Message sent', 'Our support team will get back to you.');
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 503) {
        this.support.openContactEmail(this.plan());
      } else {
        this.toast.error("Couldn't send", e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.sendingSupport.set(false);
    }
  }
}
