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
          <span>Social Cross-Poster</span>
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
            <h1>{{ mode() === 'signin' ? 'Welcome back' : 'Create your account' }}</h1>
            <p>
              {{ mode() === 'signin'
                ? 'Sign in to manage your social posts.'
                : 'Sign up to connect your accounts and start cross-posting.' }}
            </p>
          </div>

          <!-- Mode toggle -->
          <div class="auth-toggle">
            <button type="button" [class.active]="mode() === 'signin'" (click)="setMode('signin')">Sign in</button>
            <button type="button" [class.active]="mode() === 'signup'" (click)="setMode('signup')">Sign up</button>
          </div>

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
            } @else {
              Already have an account?
              <button type="button" class="linklike" (click)="setMode('signin')">Sign in</button>
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

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly email = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly phone = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  setMode(m: 'signin' | 'signup'): void {
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
