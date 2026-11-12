import { Component, inject, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PlatformService } from '../../core/services/platform.service';
import { AuthService } from '../../core/services/auth.service';
import { TargetService } from '../../core/services/target.service';
import { ToastService } from '../../core/services/toast.service';
import { PlatformNamePipe } from '../../core/pipes/platform-name.pipe';

/**
 * Connections — connect/disconnect social accounts via OAuth. Supports MULTIPLE
 * accounts per platform: each connected login is listed with its label and an
 * individual Disconnect, plus a "Connect another account" action per platform.
 */
@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [UpperCasePipe, RouterLink, PlatformNamePipe],
  template: `
    <div class="connections">
      <header class="conn-hero">
        <div class="conn-hero-text">
          <h1>Connections</h1>
          <p>Link one or more accounts per platform. You sign in on the platform's own site — we never see your password.</p>
        </div>
      </header>

      @if (platformSvc.loading()) {
        <div class="conn-panel"><p class="muted">Loading platforms…</p></div>
      } @else if (platformSvc.platforms().length === 0) {
        <div class="conn-panel">
          <p class="empty">
            No platforms enabled. Configure credentials in the backend
            <code>.env</code> and restart the server.
          </p>
        </div>
      } @else {
        <div class="conn-grid">
          @for (p of platformSvc.platforms(); track p.key) {
            <section class="conn-card" [attr.data-platform]="p.key">
              <div class="conn-card-head">
                <span class="conn-avatar" [attr.data-platform]="p.key">{{ p.key.charAt(0) | uppercase }}</span>
                <div class="conn-meta">
                  <strong>{{ p.key | platformName }}</strong>
                  <span class="caps">
                    @if (p.capabilities.text) { <span class="chip">text</span> }
                    @if (p.capabilities.image) { <span class="chip">image</span> }
                    @if (p.capabilities.video) { <span class="chip">video</span> }
                  </span>
                </div>
                @if (auth.getAccounts(p.key).length > 0) {
                  <span class="conn-count">{{ auth.getAccounts(p.key).length }}</span>
                }
              </div>

              @if (auth.getAccounts(p.key).length > 0) {
                <ul class="account-list">
                  @for (a of auth.getAccounts(p.key); track a.accountId) {
                    <li class="account-row">
                      <span class="account-label">
                        <span class="status-dot online"></span>
                        {{ a.label }}
                      </span>
                      <button class="btn ghost small" (click)="disconnect(p.key, a.accountId)">
                        Disconnect
                      </button>
                    </li>
                    <!-- Destination guidance for platforms that post to a Page/Business
                         account (not a personal profile — Meta doesn't allow that). -->
                    @if (p.requiresTarget && targets.hasLoaded(p.key, a.accountId) && targets.targetsFor(p.key, a.accountId).length === 0) {
                      <li class="account-warn">
                        @if (p.key === 'facebook') {
                          No Facebook Page found on this account. Facebook only lets apps post to a
                          <strong>Page</strong>, not a personal profile. Create one at
                          <a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener">facebook.com/pages/create</a>,
                          then reconnect.
                        } @else if (p.key === 'instagram') {
                          No Instagram Business/Creator account found. Instagram only allows posting
                          from a <strong>Business or Creator</strong> account linked to a Facebook Page.
                          Convert your account and link it to a Page, then reconnect.
                        } @else {
                          No publishing destination found for this account. Try reconnecting.
                        }
                      </li>
                    }
                  }
                </ul>
              } @else {
                <p class="conn-empty">No accounts connected yet.</p>
              }

              <!-- Capacity meter -->
              @if (capFor(p) > 0) {
                <div class="conn-capacity">
                  <div class="capacity-bar" [class.full]="atLimit(p)">
                    <span class="capacity-fill" [style.width.%]="(auth.getAccounts(p.key).length / capFor(p)) * 100"></span>
                  </div>
                  <span class="capacity-label">
                    {{ auth.getAccounts(p.key).length }} of {{ capFor(p) }} on your plan
                    @if (atLimit(p)) { <span class="limit-note">· limit reached</span> }
                  </span>
                </div>
              }

              <button
                class="btn primary conn-connect"
                [disabled]="busy() === p.key || atLimit(p)"
                (click)="connect(p.key)"
              >
                {{ busy() === p.key ? 'Connecting…' : (auth.getAccounts(p.key).length ? '+ Connect another' : 'Connect ' + (p.key | platformName)) }}
              </button>
            </section>
          }
        </div>
      }

      @if (error()) {
        <div class="conn-panel error-panel">
          <p class="error">{{ error() }}</p>
          @if (showUpgrade()) {
            <p class="hint">
              Need more? <a routerLink="/billing">View plans &amp; upgrade →</a>
            </p>
          }
        </div>
      }
    </div>
  `,
})
export class ConnectionsComponent {
  readonly platformSvc = inject(PlatformService);
  readonly auth = inject(AuthService);
  readonly targets = inject(TargetService);
  private readonly toast = inject(ToastService);

  readonly busy = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  /** Show an "upgrade" nudge when the last error was a plan limit / trial gate. */
  readonly showUpgrade = signal(false);

  async connect(platform: string): Promise<void> {
    this.error.set(null);
    this.showUpgrade.set(false);
    this.busy.set(platform);
    try {
      await this.auth.connect(platform);

      // If this platform needs a destination, fetch it for the newest account.
      const info = this.platformSvc.platforms().find((p) => p.key === platform);
      if (info?.requiresTarget) {
        const accounts = this.auth.getAccounts(platform);
        const newest = accounts[accounts.length - 1];
        if (newest) await this.targets.load(platform, newest.accountId);
      }

      const accounts = this.auth.getAccounts(platform);
      const newest = accounts[accounts.length - 1];
      this.toast.success(
        `Connected ${platform}.`,
        newest?.label ? `Account: ${newest.label}` : undefined
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error.set(msg);
      // The backend's limit (409) and trial-expired (402) messages both point
      // the user at upgrading/choosing a plan — surface a link to /billing.
      const gated = /limit|plan|trial|upgrade/i.test(msg);
      this.showUpgrade.set(gated);
      this.toast.error(gated ? 'Connection blocked' : `Couldn't connect ${platform}`, msg);
    } finally {
      this.busy.set(null);
    }
  }

  disconnect(platform: string, accountId: string): void {
    const label = this.auth.getAccounts(platform).find((a) => a.accountId === accountId)?.label;
    this.auth.disconnect(platform, accountId);
    this.targets.clear(platform, accountId);
    this.toast.info(`Disconnected ${platform}.`, label ? `Account: ${label}` : undefined);
  }

  /**
   * The effective per-platform account cap (0 = unlimited). Prefer the plan cap
   * resolved from the customer's plan (GET /api/tokens); fall back to the
   * platform's generic cap until that has loaded.
   */
  capFor(p: { key: string; maxAccounts: number }): number {
    const planCap = this.auth.planAccountCap();
    return planCap ?? p.maxAccounts;
  }

  /** True when the platform has hit the effective account cap (0 = unlimited). */
  atLimit(p: { key: string; maxAccounts: number }): boolean {
    const cap = this.capFor(p);
    return cap > 0 && this.auth.getAccounts(p.key).length >= cap;
  }
}
