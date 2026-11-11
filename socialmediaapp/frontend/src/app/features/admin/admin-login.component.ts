import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AdminAuthService } from '../../core/services/admin-auth.service';

/**
 * AdminLogin — the gate for the Administrator area.
 * On success the JWT is held in memory by AdminAuthService and the user is
 * routed to /admin.
 */
@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-shell admin">
      <!-- Admin brand side (slate/amber to signal a restricted area) -->
      <aside class="auth-aside">
        <div class="auth-brand">
          <span class="brand-mark">◆</span>
          <span>Admin Console</span>
        </div>
        <div class="auth-aside-body">
          <span class="admin-lock">🔒</span>
          <h2>Restricted area</h2>
          <p>Manage platform credentials, plans, customers and system health. Authorised operators only.</p>
        </div>
        <p class="auth-aside-foot">Nkwana PTY · Administrator</p>
      </aside>

      <!-- Form side -->
      <div class="auth-main">
        <div class="auth-card">
          <div class="auth-head">
            <h1>Administrator login</h1>
            <p>Sign in to manage platform credentials and options.</p>
          </div>

          <form (ngSubmit)="submit()">
            <label class="field">
              <span class="field-label">Username</span>
              <input
                type="text"
                name="username"
                autocomplete="username"
                [ngModel]="username()"
                (ngModelChange)="username.set($event)"
                required
              />
            </label>

            <label class="field">
              <span class="field-label">Password</span>
              <input
                type="password"
                name="password"
                autocomplete="current-password"
                [ngModel]="password()"
                (ngModelChange)="password.set($event)"
                required
              />
            </label>

            <button
              class="btn primary auth-submit"
              type="submit"
              [disabled]="busy() || !username() || !password()"
            >
              {{ busy() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>

          @if (error()) {
            <div class="auth-banner danger"><span class="banner-icon">✕</span><span>{{ error() }}</span></div>
          }

          <p class="auth-back"><a routerLink="/">← Back to home</a></p>
        </div>
      </div>
    </div>
  `,
})
export class AdminLoginComponent {
  private readonly auth = inject(AdminAuthService);
  private readonly router = inject(Router);

  readonly username = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async submit(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.login(this.username(), this.password());
      await this.router.navigate(['/admin']);
    } catch (e: unknown) {
      // Surface the backend's message where available, else a generic one.
      const msg = extractMessage(e);
      this.error.set(msg);
    } finally {
      this.busy.set(false);
    }
  }
}

function extractMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const anyErr = e as { error?: { error?: string }; message?: string };
    if (anyErr.error?.error) return anyErr.error.error;
    if (anyErr.message) return anyErr.message;
  }
  return 'Login failed. Please try again.';
}
