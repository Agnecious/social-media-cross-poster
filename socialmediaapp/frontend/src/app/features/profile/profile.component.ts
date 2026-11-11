import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CustomerAuthService } from '../../core/services/customer-auth.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * ProfileComponent — the signed-in customer's account page.
 *
 * Two independent cards:
 *  1. Profile details (first/last/phone) — email is shown read-only since it's
 *     the login identity.
 *  2. Change password — current + new + confirm, with matching enforced and the
 *     current password verified before the change is applied.
 *
 * Both write through Supabase (CustomerAuthService); the backend Customer row
 * re-syncs from the user metadata on the next authenticated request. The
 * "Contact support" flow lives on its own page (/support).
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './profile.component.html',
})
export class ProfileComponent {
  private readonly auth = inject(CustomerAuthService);
  private readonly toast = inject(ToastService);

  readonly email = this.auth.email;

  // --- Profile form (seeded from the current session metadata) ---
  readonly firstName = signal(this.auth.firstName());
  readonly lastName = signal(this.auth.lastName());
  readonly phone = signal(this.auth.phone());
  readonly savingProfile = signal(false);

  readonly profileValid = computed(
    () => !!this.firstName().trim() && !!this.lastName().trim() && !!this.phone().trim()
  );

  // --- Password form ---
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly savingPassword = signal(false);

  readonly passwordMismatch = computed(
    () => this.confirmPassword().length > 0 && this.confirmPassword() !== this.newPassword()
  );
  readonly passwordValid = computed(
    () =>
      !!this.currentPassword() &&
      this.newPassword().length >= 6 &&
      this.newPassword() === this.confirmPassword()
  );

  async saveProfile(): Promise<void> {
    if (!this.profileValid() || this.savingProfile()) return;
    this.savingProfile.set(true);
    try {
      await this.auth.updateProfile({
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        phone: this.phone().trim(),
      });
      this.toast.success('Profile updated', 'Your details have been saved.');
    } catch (e) {
      this.toast.error("Couldn't update profile", e instanceof Error ? e.message : String(e));
    } finally {
      this.savingProfile.set(false);
    }
  }

  async savePassword(): Promise<void> {
    if (!this.passwordValid() || this.savingPassword()) return;
    this.savingPassword.set(true);
    try {
      // Verify the current password first so a stolen/forgotten session can't
      // silently reset the password.
      await this.auth.verifyPassword(this.currentPassword());
      await this.auth.updatePassword(this.newPassword());
      this.currentPassword.set('');
      this.newPassword.set('');
      this.confirmPassword.set('');
      this.toast.success('Password changed', 'Use your new password next time you sign in.');
    } catch (e) {
      this.toast.error("Couldn't change password", e instanceof Error ? e.message : String(e));
    } finally {
      this.savingPassword.set(false);
    }
  }
}
