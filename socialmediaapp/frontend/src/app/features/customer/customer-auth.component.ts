import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CustomerAuthService } from '../../core/services/customer-auth.service';

/**
 * CustomerAuth — sign in / sign up screen for customers, backed by Supabase Auth.
 * Toggles between the two modes; on success routes into the app (Compose).
 */
@Component({
  selector: 'app-customer-auth',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-shell">
      <!-- Brand / marketing side -->
      <aside class="auth-aside">
        <div class="auth-brand">
          <span class="brand-mark">◆</span>
          <span>Social Cross Poster</span>
        </div>
        <div class="auth-aside-body">
          <h2>Post once. Reach everywhere.</h2>
          <p>Compose a single post and publish it across Facebook, Instagram, YouTube and more — schedule ahead, track insights, all in one place.</p>
          <ul class="auth-points">
            <li><span class="tick">✓</span> Cross-post to every connected account</li>
            <li><span class="tick">✓</span> Schedule for the perfect time</li>
            <li><span class="tick">✓</span> Audience &amp; engagement insights</li>
          </ul>
        </div>
        <p class="auth-aside-foot">© Nkwana PTY</p>
      </aside>

      <!-- Form side -->
      <div class="auth-main">
        <div class="auth-card">
          <div class="auth-head">
            <h1>
              @switch (mode()) {
                @case ('signin') { Welcome back }
                @case ('signup') { Create your account }
                @case ('reset') { Reset your password }
              }
            </h1>
            <p>
              @switch (mode()) {
                @case ('signin') { Sign in to manage your social posts. }
                @case ('signup') { Sign up to connect your accounts and start cross-posting. }
                @case ('reset') { Enter your email and we'll send you a link to reset your password. }
              }
            </p>
          </div>

          <!-- Mode toggle (hidden during password reset) -->
          @if (mode() !== 'reset') {
            <div class="auth-toggle">
              <button type="button" [class.active]="mode() === 'signin'" (click)="setMode('signin')">Sign in</button>
              <button type="button" [class.active]="mode() === 'signup'" (click)="setMode('signup')">Sign up</button>
            </div>
          }

          <!-- Password reset request -->
          @if (mode() === 'reset') {
            <form (ngSubmit)="submit()">
              <label class="field">
                <span class="field-label">Email</span>
                <input type="email" name="resetEmail" autocomplete="email"
                       [ngModel]="email()" (ngModelChange)="email.set($event)" required />
              </label>
              <button class="btn primary auth-submit" type="submit" [disabled]="busy() || !email().trim()">
                {{ busy() ? 'Sending…' : 'Send reset link' }}
              </button>
            </form>
          } @else {
          <form (ngSubmit)="submit()">
            @if (mode() === 'signup') {
              <div class="field-row">
                <label class="field">
                  <span class="field-label">First name</span>
                  <input type="text" name="firstName" autocomplete="given-name"
                         [ngModel]="firstName()" (ngModelChange)="firstName.set($event)" required />
                </label>
                <label class="field">
                  <span class="field-label">Last name</span>
                  <input type="text" name="lastName" autocomplete="family-name"
                         [ngModel]="lastName()" (ngModelChange)="lastName.set($event)" required />
                </label>
              </div>
              <label class="field">
                <span class="field-label">Phone number</span>
                <input type="tel" name="phone" autocomplete="tel"
                       [ngModel]="phone()" (ngModelChange)="phone.set($event)" required />
              </label>
            }
            <label class="field">
              <span class="field-label">Email</span>
              <input type="email" name="email" autocomplete="email"
                     [ngModel]="email()" (ngModelChange)="email.set($event)" required />
            </label>
            <label class="field">
              <span class="field-label">Password</span>
              <input type="password" name="password"
                     [attr.autocomplete]="mode() === 'signin' ? 'current-password' : 'new-password'"
                     [ngModel]="password()" (ngModelChange)="password.set($event)" required />
              @if (mode() === 'signup') {
                <span class="hint">At least 6 characters.</span>
              }
              @if (mode() === 'signin') {
                <button type="button" class="linklike forgot-link" (click)="setMode('reset')">
                  Forgot your password?
                </button>
              }
            </label>

            @if (mode() === 'signup') {
              <label class="field">
                <span class="field-label">Confirm password</span>
                <input type="password" name="confirmPassword" autocomplete="new-password"
                       [class.input-error]="passwordMismatch()"
                       [ngModel]="confirmPassword()" (ngModelChange)="confirmPassword.set($event)" required />
                @if (passwordMismatch()) {
                  <span class="hint field-error">Passwords don't match.</span>
                }
              </label>
            }

            <button class="btn primary auth-submit" type="submit" [disabled]="busy() || !canSubmit()">
              {{ busy() ? 'Please wait…' : (mode() === 'signin' ? 'Sign in' : 'Create account') }}
            </button>
          </form>
          }

          @if (message()) {
            <div class="auth-banner ok"><span class="banner-icon">✓</span><span>{{ message() }}</span></div>
          }
          @if (error()) {
            <div class="auth-banner danger"><span class="banner-icon">✕</span><span>{{ error() }}</span></div>
          }

          <p class="auth-switch">
            @if (mode() === 'signin') {
              Don't have an account?
              <button type="button" class="linklike" (click)="setMode('signup')">Sign up</button>
            } @else if (mode() === 'signup') {
              Already have an account?
              <button type="button" class="linklike" (click)="setMode('signin')">Sign in</button>
            } @else {
              Remembered it?
              <button type="button" class="linklike" (click)="setMode('signin')">Back to sign in</button>
            }
          </p>
          <p class="auth-back"><a routerLink="/">← Back to home</a></p>
        </div>
      </div>
    </div>
  `,
})
export class CustomerAuthComponent {
  private readonly auth = inject(CustomerAuthService);
  private readonly router = inject(Router);

  readonly mode = signal<'signin' | 'signup' | 'reset'>('signin');
  readonly email = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly phone = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  setMode(m: 'signin' | 'signup' | 'reset'): void {
    this.mode.set(m);
    this.error.set(null);
    this.message.set(null);
    // Clear the confirm field so it never leaks between modes.
    this.confirmPassword.set('');
  }

  /** True once a confirm password has been typed and it doesn't match. */
  passwordMismatch(): boolean {
    return this.mode() === 'signup' && this.confirmPassword().length > 0 && this.confirmPassword() !== this.password();
  }

  /** Whether the form can be submitted (all fields required on sign-up). */
  canSubmit(): boolean {
    if (!this.email().trim() || !this.password()) return false;
    if (this.mode() === 'signup') {
      return !!(
        this.firstName().trim() &&
        this.lastName().trim() &&
        this.phone().trim() &&
        this.confirmPassword() &&
        this.confirmPassword() === this.password()
      );
    }
    return true;
  }

  async submit(): Promise<void> {
    this.error.set(null);
    this.message.set(null);

    // Password-reset request: email a reset link, then show a generic message
    // (we don't reveal whether the address has an account — anti-enumeration).
    if (this.mode() === 'reset') {
      if (!this.email().trim()) return;
      this.busy.set(true);
      try {
        await this.auth.requestPasswordReset(this.email());
      } catch {
        // Swallow provider errors (incl. "not found") — same generic result.
      } finally {
        this.busy.set(false);
      }
      this.message.set(
        "If an account exists for that email, we've sent a password-reset link. Check your inbox (and spam)."
      );
      return;
    }

    // Backstop the password match (the button is also disabled on mismatch).
    if (this.mode() === 'signup' && this.password() !== this.confirmPassword()) {
      this.error.set('Passwords do not match.');
      return;
    }
    this.busy.set(true);
    try {
      if (this.mode() === 'signup') {
        const { needsConfirmation } = await this.auth.signUp(this.email(), this.password(), {
          firstName: this.firstName().trim(),
          lastName: this.lastName().trim(),
          phone: this.phone().trim(),
        });
        if (needsConfirmation) {
          this.message.set('Account created. Check your email to confirm, then sign in.');
          this.setMode('signin');
          return;
        }
      } else {
        await this.auth.signIn(this.email(), this.password());
      }
      await this.router.navigate(['/compose']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
