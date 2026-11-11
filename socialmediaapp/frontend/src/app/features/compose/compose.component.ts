import { Component, computed, effect, inject, signal } from '@angular/core';
import { TitleCasePipe, DatePipe, UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlatformService } from '../../core/services/platform.service';
import { AuthService } from '../../core/services/auth.service';
import { PublishService, PublishTarget } from '../../core/services/publish.service';
import { TargetService, accountKey } from '../../core/services/target.service';
import { ToastService } from '../../core/services/toast.service';
import { MediaType, PublishResult } from '../../core/models/platform.model';

/**
 * Compose — write once, then pick which connected ACCOUNTS to post to.
 *
 * With multi-account support, each selectable item is a specific account (a
 * login) of a platform — you can post to several accounts, even of the same
 * platform, at once. A platform/account is only selectable if it supports the
 * attached media type. "Publish" posts now; "Schedule Post" opens a future
 * date/time picker (native scheduling where supported, browser fallback else).
 * See ARCHITECTURE.md §5 & §6.
 */
@Component({
  selector: 'app-compose',
  standalone: true,
  imports: [FormsModule, RouterLink, TitleCasePipe, DatePipe, UpperCasePipe],
  templateUrl: './compose.component.html',
})
export class ComposeComponent {
  readonly platformSvc = inject(PlatformService);
  readonly auth = inject(AuthService);
  readonly targets = inject(TargetService);
  private readonly publishSvc = inject(PublishService);
  private readonly toast = inject(ToastService);

  constructor() {
    // When connected accounts (re)load — e.g. after a page refresh — make sure
    // destinations (Facebook Pages / IG accounts) are fetched for any account
    // that needs one but hasn't loaded yet. This fixes "no pages after refresh".
    effect(() => {
      for (const p of this.platformSvc.platforms()) {
        if (!p.requiresTarget) continue;
        for (const acct of this.auth.getAccounts(p.key)) {
          if (!this.targets.hasLoaded(p.key, acct.accountId)) {
            void this.targets.load(p.key, acct.accountId).catch(() => {});
          }
        }
      }
    });
  }

  readonly text = signal('');
  readonly mediaType = signal<MediaType>('none');

  /** Emoji picker state + a curated set of common emojis. */
  readonly showEmojis = signal(false);
  readonly emojis = [
    '😀','😁','😂','🤣','😊','😍','😎','🤩','😉','😌',
    '🙌','👏','🙏','👍','👎','💪','🤝','✌️','🔥','✨',
    '🎉','🎊','🥳','❤️','🧡','💛','💚','💙','💜','🖤',
    '⭐','🌟','💯','✅','❗','❓','💡','📣','📢','🚀',
    '📈','📊','🏆','🎯','💰','🛒','🎁','📅','⏰','📌',
    '👀','🤔','😮','😢','😅','😭','😴','🙈','🤷','💬',
  ];

  toggleEmojis(): void {
    this.showEmojis.update((v) => !v);
  }

  /** Append an emoji to the current text. */
  insertEmoji(emoji: string): void {
    this.text.set(this.text() + emoji);
  }

  readonly file = signal<File | null>(null);
  readonly mediaUrl = signal('');
  /** Selected account keys ('platform::accountId'). */
  readonly selected = signal<Set<string>>(new Set());

  readonly publishing = signal(false);
  readonly results = signal<PublishResult[]>([]);
  readonly error = signal<string | null>(null);
  /** Show an "upgrade/choose a plan" nudge when a gating error (402) occurred. */
  readonly showUpgrade = signal(false);

  readonly showScheduler = signal(false);
  readonly scheduledAt = signal('');
  readonly browserQueued = signal<BrowserScheduledPost[]>([]);

  readonly minScheduleValue = computed(() => toLocalInputValue(new Date(Date.now() + 11 * 60 * 1000)));

  /**
   * Flatten platforms × their connected accounts into selectable items,
   * annotated with whether they support the current media type.
   */
  readonly eligibleAccounts = computed(() => {
    const mt = this.mediaType();
    const items: EligibleAccount[] = [];
    for (const p of this.platformSvc.platforms()) {
      const supports =
        (mt === 'none' && p.capabilities.text) ||
        (mt === 'image' && p.capabilities.image) ||
        (mt === 'video' && p.capabilities.video);
      for (const acct of this.auth.getAccounts(p.key)) {
        items.push({
          platform: p.key,
          accountId: acct.accountId,
          label: acct.label,
          key: accountKey(p.key, acct.accountId),
          requiresTarget: p.requiresTarget,
          supportsScheduling: p.supportsScheduling,
          supports,
          eligible: supports,
        });
      }
    }
    return items;
  });

  /** True when at least one platform is enabled but no accounts are connected. */
  readonly noAccounts = computed(
    () => this.platformSvc.platforms().length > 0 && this.eligibleAccounts().length === 0
  );

  readonly canPublish = computed(() => {
    if (this.selected().size === 0 || this.publishing()) return false;
    return [...this.selected()].every((k) => this.targetReadyByKey(k));
  });

  /** Split selected accounts by native vs browser scheduling. */
  readonly scheduleBreakdown = computed(() => {
    const native: EligibleAccount[] = [];
    const browser: EligibleAccount[] = [];
    const byKey = new Map(this.eligibleAccounts().map((a) => [a.key, a]));
    for (const k of this.selected()) {
      const a = byKey.get(k);
      if (!a) continue;
      (a.supportsScheduling ? native : browser).push(a);
    }
    return { native, browser };
  });

  private accountByKey(key: string): EligibleAccount | undefined {
    return this.eligibleAccounts().find((a) => a.key === key);
  }

  /** Does the selected account's platform need a target, and is one chosen? */
  private targetReadyByKey(key: string): boolean {
    const a = this.accountByKey(key);
    if (!a) return false;
    if (!a.requiresTarget) return true;
    return !!this.targets.selectedIdFor(a.platform, a.accountId);
  }

  targetReady(a: EligibleAccount): boolean {
    return this.targetReadyByKey(a.key);
  }

  onTargetChange(a: EligibleAccount, targetId: string): void {
    this.targets.select(a.platform, a.accountId, targetId);
  }

  onMediaTypeChange(mt: MediaType): void {
    this.mediaType.set(mt);
    if (mt === 'none') this.file.set(null);
    const stillEligible = new Set(this.eligibleAccounts().filter((a) => a.eligible).map((a) => a.key));
    this.selected.set(new Set([...this.selected()].filter((k) => stillEligible.has(k))));
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
  }

  toggle(a: EligibleAccount): void {
    if (!a.eligible) return;
    const next = new Set(this.selected());
    next.has(a.key) ? next.delete(a.key) : next.add(a.key);
    this.selected.set(next);
  }

  /**
   * Build one PublishTarget per selected account. Only identifiers + options —
   * the backend resolves each account's token server-side by accountId.
   */
  private buildTargets(keys: string[]): PublishTarget[] {
    const targets: PublishTarget[] = [];
    for (const key of keys) {
      const a = this.accountByKey(key);
      if (!a) continue;
      targets.push({
        platform: a.platform,
        accountId: a.accountId,
        label: a.label,
        options: this.targets.optionsFor(a.platform, a.accountId),
      });
    }
    return targets;
  }

  private currentPost(scheduledAtIso?: string) {
    return {
      text: this.text(),
      mediaType: this.mediaType(),
      file: this.file(),
      mediaUrl: this.mediaUrl() || undefined,
      scheduledAt: scheduledAtIso,
    };
  }

  toggleScheduler(): void {
    this.showScheduler.update((v) => !v);
    this.error.set(null);
  }

  async publish(): Promise<void> {
    this.error.set(null);
    this.showUpgrade.set(false);
    this.results.set([]);
    this.publishing.set(true);
    try {
      const results = await this.publishSvc.publish(
        this.currentPost(),
        this.buildTargets([...this.selected()])
      );
      this.results.set(results);
      this.notifyResults(results, 'Published');
    } catch (e) {
      this.handleError(e);
    } finally {
      this.publishing.set(false);
    }
  }

  /**
   * Toast a summary of a publish/schedule result set: all-ok → success,
   * some-ok → info (partial), none-ok → error.
   */
  private notifyResults(results: PublishResult[], verb: string): void {
    if (!results.length) return;
    const ok = results.filter((r) => r.ok).length;
    const total = results.length;
    if (ok === total) {
      this.toast.success(`${verb} to ${total} ${total === 1 ? 'account' : 'accounts'}.`);
    } else if (ok > 0) {
      this.toast.info(`${verb} to ${ok} of ${total} accounts — ${total - ok} failed.`);
    } else {
      this.toast.error(`Couldn't ${verb.toLowerCase()} to any account.`, 'See the per-account details below.');
    }
  }

  /**
   * Set the error message, toast it, and for plan/trial gating errors (402)
   * flag the upgrade nudge pointing at /billing.
   */
  private handleError(e: unknown): void {
    const err = e as { message?: string; reason?: string; status?: number };
    const msg = err?.message || String(e);
    this.error.set(msg);
    const gated = err?.status === 402 || err?.reason === 'trial_expired' || err?.reason === 'canceled';
    this.showUpgrade.set(gated);
    this.toast.error(gated ? 'Action blocked' : 'Something went wrong', msg);
  }

  scheduleValid(): boolean {
    if (!this.scheduledAt()) return false;
    const t = new Date(this.scheduledAt()).getTime();
    return !Number.isNaN(t) && t > Date.now() + 60 * 1000;
  }

  get canSchedule(): boolean {
    return (
      this.selected().size > 0 &&
      !this.publishing() &&
      this.scheduleValid() &&
      [...this.selected()].every((k) => this.targetReadyByKey(k))
    );
  }

  async schedulePost(): Promise<void> {
    this.error.set(null);
    this.showUpgrade.set(false);
    this.results.set([]);
    if (!this.scheduleValid()) {
      this.error.set('Please choose a valid future date and time.');
      this.toast.error('Invalid time', 'Please choose a valid future date and time.');
      return;
    }
    const iso = new Date(this.scheduledAt()).toISOString();
    const { native, browser } = this.scheduleBreakdown();

    // Native scheduling → hand off to the backend now.
    if (native.length > 0) {
      this.publishing.set(true);
      try {
        const results = await this.publishSvc.publish(
          this.currentPost(iso),
          this.buildTargets(native.map((a) => a.key))
        );
        this.results.set(results);
        this.notifyResults(results, 'Scheduled');
      } catch (e) {
        this.handleError(e);
      } finally {
        this.publishing.set(false);
      }
    }

    // Browser fallback → queue a timer per account.
    for (const a of browser) {
      this.queueInBrowser(a, iso);
    }
    if (browser.length > 0) {
      this.toast.info(
        `Queued ${browser.length} ${browser.length === 1 ? 'post' : 'posts'} in this browser.`,
        'Keep this tab open until they publish.'
      );
    }
  }

  private queueInBrowser(a: EligibleAccount, iso: string): void {
    const fireIn = new Date(iso).getTime() - Date.now();
    const post = this.currentPost(); // publish immediately when the timer fires
    const targets = this.buildTargets([a.key]);

    const timerId = window.setTimeout(async () => {
      try {
        const results = await this.publishSvc.publish(post, targets);
        this.results.update((r) => [...r, ...results]);
      } catch (e) {
        this.results.update((r) => [
          ...r,
          { platform: a.platform, accountId: a.accountId, label: a.label, ok: false, error: e instanceof Error ? e.message : String(e) },
        ]);
      } finally {
        this.browserQueued.update((q) => q.filter((item) => item.timerId !== timerId));
      }
    }, Math.max(0, fireIn));

    this.browserQueued.update((q) => [...q, { label: a.label, at: iso, timerId }]);
  }

  cancelBrowserQueued(timerId: number): void {
    window.clearTimeout(timerId);
    this.browserQueued.update((q) => q.filter((item) => item.timerId !== timerId));
  }
}

/** A selectable account item shown on Compose. */
interface EligibleAccount {
  platform: string;
  accountId: string;
  label: string;
  key: string;
  requiresTarget: boolean;
  supportsScheduling: boolean;
  supports: boolean;
  eligible: boolean;
}

/** A post queued in the browser (tab must stay open until it fires). */
interface BrowserScheduledPost {
  label: string;
  at: string;
  timerId: number;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
