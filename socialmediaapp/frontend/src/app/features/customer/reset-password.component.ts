import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CustomerAuthService } from '../../core/services/customer-auth.service';

/**
 * ResetPasswordComponent — the page the password-reset email links to.
 *
 * Supabase appends a recovery token to the redirect URL; its client picks that
 * up and establishes a short-lived recovery session (fires a PASSWORD_RECOVERY
 * / SIGNED_IN auth event). Once that session exists, `updatePassword()` sets
 * the new password. We gate the form on `authReady()` + an authenticated
 * session so a direct visit (no valid link) shows a clear "link expired"
 * message instead of a broken form.
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-shell">
      <aside class="auth-aside">
        <div class="auth-brand">
          <span class="brand-mark">◆</span>
          <span>Social Cross Poster</span>
        </div>
        <div class="auth-aside-body">
          <h2>Set a new password</h2>
          <p>Choose a strong password you don't use anywhere else. You'll be signed in once it's updated.</p>
        </div>
        <p class="auth-aside-foot">© Nkwana PTY</p>
      </aside>

      <div class="auth-main">
        <div class="auth-card">
          <div class="auth-head">
            <h1>Reset your password</h1>
            <p>Enter and confirm your new password below.</p>
          </div>

          @if (!authReady()) {
            <p class="muted">Verifying your reset link…</p>
          } @else if (!canReset() && !done()) {
            <div class="auth-banner danger">
              <span class="banner-icon">✕</span>
              <span>
                This reset link is invalid or has expired. Request a new one from the
                sign-in page.
              </span>
            </div>
            <p class="auth-switch">
              <a class="linklike" routerLink="/login">← Back to sign in</a>
            </p>
          } @else if (done()) {
            <div class="auth-banner ok">
              <span class="banner-icon">✓</span>
              <span>Your password has been updated. Redirecting you to the app…</span>
            </div>
          } @else {
            <form (ngSubmit)="submit()">
              <label class="field">
                <span class="field-label">New password</span>
                <input type="password" name="password" autocomplete="new-password"
                       [ngModel]="password()" (ngModelChange)="password.set($event)" required />
                <span class="hint">At least 6 characters.</span>
              </label>
              <label class="field">
                <span class="field-label">Confirm new password</span>
                <input type="password" name="confirmPassword" autocomplete="new-password"
                       [class.input-error]="mismatch()"
                       [ngModel]="confirmPassword()" (ngModelChange)="confirmPassword.set($event)" required />
                @if (mismatch()) {
                  <span class="hint field-error">Passwords don't match.</span>
                }
              </label>
              <button class="btn primary auth-submit" type="submit" [disabled]="busy() || !canSubmit()">
                {{ busy() ? 'Updating…' : 'Update password' }}
              </button>
            </form>

            @if (error()) {
              <div class="auth-banner danger"><span class="banner-icon">✕</span><span>{{ error() }}</span></div>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class ResetPasswordComponent implements OnInit {
  private readonly auth = inject(CustomerAuthService);
  private readonly router = inject(Router);

  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal(false);

  /** Supabase has finished restoring/establishing the recovery session. */
  readonly authReady = this.auth.authReady;
  /** There IS a session (the recovery link was valid) → allow the reset. */
  readonly canReset = this.auth.isAuthenticated;

  ngOnInit(): void {
    // Nothing to do — CustomerAuthService already listens to onAuthStateChange,
    // which fires PASSWORD_RECOVERY/SIGNED_IN when Supabase consumes the link.
  }

  mismatch(): boolean {
    return this.confirmPassword().length > 0 && this.confirmPassword() !== this.password();
  }

  canSubmit(): boolean {
    return (
      this.password().length >= 6 &&
      this.confirmPassword().length > 0 &&
      this.password() === this.confirmPassword()
    );
  }

  async submit(): Promise<void> {
    this.error.set(null);
    if (!this.canSubmit()) {
      this.error.set('Please enter matching passwords (at least 6 characters).');
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.updatePassword(this.password());
      this.done.set(true);
      // The recovery session is now a full session — go straight into the app.
      setTimeout(() => void this.router.navigate(['/compose']), 1500);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
