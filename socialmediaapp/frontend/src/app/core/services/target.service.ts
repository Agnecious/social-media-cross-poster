import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PlatformTarget } from '../models/platform.model';

/** Composite key uniquely identifying one connected account. */
export function accountKey(platform: string, accountId: string): string {
  return `${platform}::${accountId}`;
}

/**
 * TargetService — fetches and holds the publishing destinations (Facebook
 * Pages, Instagram Business accounts) PER CONNECTED ACCOUNT.
 *
 * Because each account (login) has its own set of Pages/IG accounts, targets
 * are keyed by `platform::accountId`, not just the platform. In-memory only.
 */
@Injectable({ providedIn: 'root' })
export class TargetService {
  private readonly http = inject(HttpClient);

  /** accountKey -> available targets */
  private readonly targetsByAccount = signal<Record<string, PlatformTarget[]>>({});
  /** accountKey -> selected target id */
  private readonly selectedByAccount = signal<Record<string, string>>({});

  targetsFor(platform: string, accountId: string): PlatformTarget[] {
    return this.targetsByAccount()[accountKey(platform, accountId)] ?? [];
  }

  /** Whether destinations have already been fetched for this account. */
  hasLoaded(platform: string, accountId: string): boolean {
    return accountKey(platform, accountId) in this.targetsByAccount();
  }

  selectedIdFor(platform: string, accountId: string): string | undefined {
    return this.selectedByAccount()[accountKey(platform, accountId)];
  }

  selectedTargetFor(platform: string, accountId: string): PlatformTarget | undefined {
    const id = this.selectedIdFor(platform, accountId);
    return this.targetsFor(platform, accountId).find((t) => t.id === id);
  }

  select(platform: string, accountId: string, targetId: string): void {
    this.selectedByAccount.set({
      ...this.selectedByAccount(),
      [accountKey(platform, accountId)]: targetId,
    });
  }

  /** Drop cached targets + selection for one account (on disconnect). */
  clear(platform: string, accountId: string): void {
    const key = accountKey(platform, accountId);
    const targets = { ...this.targetsByAccount() };
    const selected = { ...this.selectedByAccount() };
    delete targets[key];
    delete selected[key];
    this.targetsByAccount.set(targets);
    this.selectedByAccount.set(selected);
  }

  /** Fetch destinations for one connected account (token resolved server-side). */
  async load(platform: string, accountId: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ targets: PlatformTarget[] }>(
        `${environment.apiBaseUrl}/platforms/${platform}/targets`,
        { accountId }
      )
    );
    const targets = res.targets ?? [];
    const key = accountKey(platform, accountId);
    this.targetsByAccount.set({ ...this.targetsByAccount(), [key]: targets });

    // Auto-select if there's exactly one destination.
    if (targets.length === 1) {
      this.select(platform, accountId, targets[0].id);
    }
  }

  /**
   * Build the per-account publish options from the selected target.
   * Facebook -> { pageId, pageAccessToken }, Instagram -> { igUserId }.
   */
  optionsFor(platform: string, accountId: string): Record<string, unknown> {
    const target = this.selectedTargetFor(platform, accountId);
    if (!target) return {};

    if (platform === 'facebook') {
      return { pageId: target.id, pageAccessToken: target.extra?.['pageAccessToken'] };
    }
    if (platform === 'instagram') {
      return { igUserId: target.id };
    }
    return {};
  }
}
