import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ConnectedAccount, PlatformAuth } from '../models/platform.model';

/**
 * AuthService — holds connected accounts, keyed by platform, as a LIST so
 * multiple logins of the same platform can be connected at once.
 *
 * Accounts live in memory (signals) for the session and, when the backend has
 * persistence enabled (TOKEN_STORE_KEY), are saved encrypted so they survive
 * restarts. Each account has a stable id + human label + its own OAuth token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /** platform key -> connected accounts of that platform */
  private readonly accounts = signal<Record<string, ConnectedAccount[]>>({});

  /**
   * The authoritative per-platform account cap for the signed-in customer's
   * plan (0 = unlimited), from GET /api/tokens. Null until loaded.
   */
  readonly planAccountCap = signal<number | null>(null);

  /** Platforms that have at least one connected account. */
  readonly connected = computed(() =>
    Object.entries(this.accounts())
      .filter(([, list]) => list.length > 0)
      .map(([platform]) => platform)
  );

  /** All connected accounts for a platform. */
  getAccounts(platform: string): ConnectedAccount[] {
    return this.accounts()[platform] ?? [];
  }

  /** A single account by platform + id. */
  getAccount(platform: string, accountId: string): ConnectedAccount | undefined {
    return this.getAccounts(platform).find((a) => a.accountId === accountId);
  }

  /** True if the platform has any connected account. */
  isConnected(platform: string): boolean {
    return this.getAccounts(platform).length > 0;
  }

  /** Clear all in-memory accounts (on sign-out / customer switch). */
  clearAll(): void {
    this.accounts.set({});
    this.planAccountCap.set(null);
  }

  /** Hydrate persisted accounts on startup. */
  async loadPersisted(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ enabled: boolean; accounts: ConnectedAccount[]; maxAccountsPerPlatform?: number }>(
          `${environment.apiBaseUrl}/tokens`
        )
      );
      if (res.enabled && Array.isArray(res.accounts)) {
        const map: Record<string, ConnectedAccount[]> = {};
        for (const a of res.accounts) {
          (map[a.platform] ??= []).push(a);
        }
        this.accounts.set(map);
      }
      if (typeof res.maxAccountsPerPlatform === 'number') {
        this.planAccountCap.set(res.maxAccountsPerPlatform);
      }
    } catch {
      // Persistence unavailable — session-only accounts.
    }
  }

  /** Remove one connected account (per-account Disconnect). */
  disconnect(platform: string, accountId: string): void {
    const list = this.getAccounts(platform).filter((a) => a.accountId !== accountId);
    this.accounts.set({ ...this.accounts(), [platform]: list });
    this.http
      .delete(`${environment.apiBaseUrl}/tokens/${platform}/${encodeURIComponent(accountId)}`)
      .subscribe({ error: () => {} });
  }

  /**
   * Start OAuth for a platform and ADD the resulting account to the list.
   * Opens the platform login popup; resolves when it posts back the token,
   * accountId, and label.
   */
  async connect(platform: string): Promise<void> {
    const { url } = await firstValueFrom(
      this.http.get<{ url: string; state: string }>(
        `${environment.apiBaseUrl}/auth/${platform}/start`
      )
    );

    const popup = window.open(url, 'oauth', 'width=600,height=700');
    if (!popup) throw new Error('Popup blocked. Please allow popups for this site.');

    return new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.source !== 'socialmediaapp-oauth') return;
        const { payload } = event.data;
        window.removeEventListener('message', handler);

        if (payload.error) {
          reject(new Error(`${platform}: ${payload.error}`));
          return;
        }
        if (payload.platform === platform && payload.token) {
          const auth = payload.token as PlatformAuth;
          const accountId: string = payload.accountId || `${platform}:${Date.now()}`;
          const label: string = payload.label || `${platform} account`;
          const account: ConnectedAccount = { platform, accountId, label, auth };

          // Add (or replace if the same account reconnected).
          const prevList = this.getAccounts(platform);
          const list = prevList.filter((a) => a.accountId !== accountId);
          this.accounts.set({ ...this.accounts(), [platform]: [...list, account] });

          // Persist. If the backend rejects (e.g. account-limit 409), roll back
          // the in-memory add and surface the error to the caller.
          firstValueFrom(
            this.http.put(
              `${environment.apiBaseUrl}/tokens/${platform}/${encodeURIComponent(accountId)}`,
              { auth, label }
            )
          )
            .then(() => resolve())
            .catch((err: unknown) => {
              this.accounts.set({ ...this.accounts(), [platform]: prevList });
              const msg =
                (err as { error?: { error?: string } })?.error?.error ||
                `${platform}: could not save connection.`;
              reject(new Error(msg));
            });
        }
      };
      window.addEventListener('message', handler);
    });
  }
}
