import { Injectable, computed, signal } from '@angular/core';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * CustomerAuthService — customer sign-up / login via Supabase Auth.
 *
 * Supabase manages the session (email/password, resets, verification) and
 * persists it in the browser. We mirror the session into a signal so the UI
 * reacts, and expose the access token for authenticated API calls.
 */
@Injectable({ providedIn: 'root' })
export class CustomerAuthService {
  private readonly supabase: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey
  );

  private readonly session = signal<Session | null>(null);
  /** False until Supabase has finished restoring any existing session. */
  private readonly ready = signal(false);

  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly email = computed(() => this.session()?.user?.email ?? null);
  /** True once the initial session check has completed (avoids startup races). */
  readonly authReady = computed(() => this.ready());

  // --- Profile (from Supabase user_metadata) ---
  private meta = computed(() => this.session()?.user?.user_metadata ?? {});
  readonly firstName = computed<string>(() => (this.meta() as Record<string, string>)['firstName'] ?? '');
  readonly lastName = computed<string>(() => (this.meta() as Record<string, string>)['lastName'] ?? '');
  readonly phone = computed<string>(() => (this.meta() as Record<string, string>)['phone'] ?? '');

  /**
   * A short display name for the nav: full name if present, else first name,
   * else the part of the email before the @, else 'Account'.
   */
  readonly displayName = computed<string>(() => {
    const full = `${this.firstName()} ${this.lastName()}`.trim();
    if (full) return full;
    const email = this.email();
    if (email) return email.split('@')[0];
    return 'Account';
  });

  constructor() {
    // Restore any existing session first, THEN mark ready so consumers don't
    // fire authenticated calls before the token is available (refresh race).
    void this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.ready.set(true);
    });
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.ready.set(true);
    });
  }

  /** The current access token (Supabase JWT) for Authorization headers. */
  getAccessToken(): string | null {
    return this.session()?.access_token ?? null;
  }

  async signUp(
    email: string,
    password: string,
    profile: { firstName: string; lastName: string; phone: string }
  ): Promise<{ needsConfirmation: boolean }> {
    // Profile fields ride along as Supabase user metadata (options.data). The
    // backend mirrors them into the Customer row on first authenticated request.
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          phone: profile.phone,
        },
      },
    });
    if (error) throw new Error(error.message);
    // If email confirmation is on, there's no session until they confirm.
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.session.set(null);
  }

  /**
   * Update the signed-in user's profile (first/last/phone), stored as Supabase
   * user_metadata. The backend re-mirrors these into the Customer row on the
   * next authenticated request. onAuthStateChange refreshes our session signal.
   */
  async updateProfile(profile: { firstName: string; lastName: string; phone: string }): Promise<void> {
    const { data, error } = await this.supabase.auth.updateUser({
      data: { firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone },
    });
    if (error) throw new Error(error.message);
    // updateUser returns the fresh user; reflect it immediately.
    if (data.user) {
      const current = this.session();
      if (current) this.session.set({ ...current, user: data.user });
    }
  }

  /** Change the signed-in user's password. */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }

  /**
   * Re-authenticate with the current password — used to verify identity before
   * a sensitive change (password update). Throws if the password is wrong.
   */
  async verifyPassword(currentPassword: string): Promise<void> {
    const email = this.email();
    if (!email) throw new Error('Not signed in.');
    const { error } = await this.supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (error) throw new Error('Current password is incorrect.');
  }
}
