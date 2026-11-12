import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TitleCasePipe, DatePipe, UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlatformService } from '../../core/services/platform.service';
import { AuthService } from '../../core/services/auth.service';
import { PublishService, PublishTarget } from '../../core/services/publish.service';
import { TargetService, accountKey } from '../../core/services/target.service';
import { ToastService } from '../../core/services/toast.service';
import { AiService } from '../../core/services/ai.service';
import { AiConfig } from '../../core/models/ai.model';
import { MediaType, PublishResult } from '../../core/models/platform.model';
import {
  AI_ACTION_GROUPS,
  AiAction,
  AiActionId,
  AiOutputCard,
  CaptionVersion,
} from './compose-ai';

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
export class ComposeComponent implements OnInit {
  readonly platformSvc = inject(PlatformService);
  readonly auth = inject(AuthService);
  readonly targets = inject(TargetService);
  private readonly publishSvc = inject(PublishService);
  private readonly toast = inject(ToastService);
  private readonly ai = inject(AiService);

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

  // ===========================================================================
  // AI Assistant — integrated into the caption field.
  //
  // The caption lives in `text`. AI never mutates it directly: a caption-style
  // action produces a PREVIEW the user can Apply / Edit / discard, and the
  // original is always preserved in `versions` so the user can revert. Asset
  // actions (hashtags, titles, SEO) produce copy-able/append-able cards. All AI
  // is optional — manual composing and publishing work unchanged if AI is off.
  // ===========================================================================

  readonly aiGroups = AI_ACTION_GROUPS;

  /** Capability probe (enabled/configured/plan) — null until loaded. */
  readonly aiConfig = signal<AiConfig | null>(null);
  readonly aiConfigLoaded = signal(false);
  /** Whether the whole AI panel is expanded. */
  readonly aiOpen = signal(false);

  /** The action currently running (for per-button spinners); null when idle. */
  readonly aiRunning = signal<AiActionId | null>(null);
  readonly aiBusy = computed(() => this.aiRunning() !== null);
  readonly aiError = signal<string | null>(null);
  /** Set true when a 403 upgrade_required comes back (plan lacks AI). */
  readonly aiUpgrade = signal(false);

  /** Caption-style preview awaiting the user's decision. */
  readonly aiPreview = signal<CaptionPreview | null>(null);
  /** Asset cards (hashtags/titles/SEO/CTAs) from the last 'cards' action. */
  readonly aiCards = signal<AiOutputCard[]>([]);
  readonly aiCardsLabel = signal<string>('');
  /** Which provider answered last (gemini/openrouter) — small badge. */
  readonly aiProvider = signal<string | null>(null);

  /** Session history of the caption for revert/compare. */
  readonly versions = signal<CaptionVersion[]>([]);

  /** AI is globally available (on + configured). */
  readonly aiAvailable = computed(() => this.aiConfig()?.available === true);
  /**
   * The customer's plan explicitly does NOT include AI. We only block when the
   * backend resolved the plan and said no; an unknown (null) plan is treated as
   * "let them try" — the server-side 403 is the real gate.
   */
  readonly aiPlanBlocked = computed(() => {
    const c = this.aiConfig();
    if (!c) return false;
    if (c.planAllowed === false) return true;
    return c.plan != null && c.planAllowed !== true;
  });

  async ngOnInit(): Promise<void> {
    try {
      this.aiConfig.set(await this.ai.config());
    } catch {
      // Probe failed (e.g. egress blocked). Leave config null — the panel shows
      // a neutral "couldn't check" note and manual composing is unaffected.
      this.aiConfig.set(null);
    } finally {
      this.aiConfigLoaded.set(true);
    }
  }

  toggleAiPanel(): void {
    this.aiOpen.update((v) => !v);
  }

  /** Does this caption-action have something to work on? */
  private requireContent(): boolean {
    if (this.text().trim().length > 0) return true;
    this.toast.error('Nothing to work with', 'Write a caption first, then let AI refine it.');
    return false;
  }

  /**
   * Run an AI action. Caption actions fill `aiPreview`; asset actions fill
   * `aiCards`. Guards: availability + (for most) non-empty caption.
   */
  async runAi(action: AiAction): Promise<void> {
    if (this.aiBusy()) return;
    if (!this.aiAvailable()) {
      this.toast.error('AI unavailable', 'The AI assistant is turned off or not configured.');
      return;
    }
    if (!this.requireContent()) return;

    this.aiError.set(null);
    this.aiUpgrade.set(false);
    this.aiRunning.set(action.id);
    const content = this.text().trim();

    try {
      if (action.kind === 'caption') {
        const { text, provider } = await this.generateCaption(action.id, content);
        this.aiProvider.set(provider);
        this.aiPreview.set({ action, text, editing: false });
        this.aiCards.set([]);
        this.toast.success('Draft ready', 'Preview it, then Apply or discard.');
      } else {
        const { cards, label, provider } = await this.generateCards(action.id, content);
        this.aiProvider.set(provider);
        this.aiCards.set(cards);
        this.aiCardsLabel.set(label);
        this.aiPreview.set(null);
        if (cards.length === 0) {
          this.toast.info('Nothing generated', 'The AI returned no results — try again.');
        } else {
          this.toast.success('Generated', 'Copy or append the results below.');
        }
      }
    } catch (e) {
      this.handleAiError(e);
    } finally {
      this.aiRunning.set(null);
    }
  }

  /** Dispatch a caption-style action to the right AiService call. */
  private async generateCaption(
    id: AiActionId,
    content: string
  ): Promise<{ text: string; provider: string }> {
    switch (id) {
      case 'improve': {
        const r = await this.ai.rewrite({ content, tone: 'motivational' });
        return { text: r.rewritten, provider: r.provider };
      }
      case 'professional': {
        const r = await this.ai.rewrite({ content, tone: 'professional' });
        return { text: r.rewritten, provider: r.provider };
      }
      case 'casual': {
        const r = await this.ai.rewrite({ content, tone: 'casual' });
        return { text: r.rewritten, provider: r.provider };
      }
      case 'shorten': {
        const r = await this.ai.shorten({ content, format: 'social_post' });
        return { text: r.shortened, provider: r.provider };
      }
      case 'expand': {
        const r = await this.ai.expand({ content, format: 'long_form_post' });
        return { text: r.expanded, provider: r.provider };
      }
      case 'grammar': {
        const r = await this.ai.proofread({ content });
        return { text: r.corrected, provider: r.provider };
      }
      case 'rewrite_facebook':
      case 'rewrite_instagram':
      case 'rewrite_x':
      case 'rewrite_linkedin':
      case 'rewrite_tiktok':
      case 'rewrite_youtube': {
        const platform = id.replace('rewrite_', '') as
          | 'facebook'
          | 'instagram'
          | 'x'
          | 'linkedin'
          | 'tiktok'
          | 'youtube';
        const r = await this.ai.platformContent({ content, platforms: [platform] });
        const res = r.result;
        let text: string;
        if (platform === 'youtube') {
          text = [res.youtubeTitle, res.youtubeDescription].filter(Boolean).join('\n\n');
        } else {
          // res has explicit optional string keys for each non-YouTube platform.
          text = res[platform] ?? '';
        }
        if (!text.trim()) throw new Error('The AI did not return content for this platform.');
        return { text, provider: r.provider };
      }
      default:
        throw new Error('This action does not produce a caption.');
    }
  }

  /** Dispatch an asset-style action; returns copy-able cards. */
  private async generateCards(
    id: AiActionId,
    content: string
  ): Promise<{ cards: AiOutputCard[]; label: string; provider: string }> {
    switch (id) {
      case 'cta': {
        const r = await this.ai.ctas({ content });
        return {
          label: 'Call-to-action ideas',
          provider: r.provider,
          cards: r.ctas.map((t, i) => ({ label: `CTA ${i + 1}`, text: t })),
        };
      }
      case 'gen_hashtags': {
        const r = await this.ai.hashtags({ content });
        return {
          label: 'Hashtags',
          provider: r.provider,
          cards: [{ label: 'Hashtags', text: r.hashtags.join(' '), items: r.hashtags }],
        };
      }
      case 'gen_titles': {
        const r = await this.ai.titles({ content });
        return {
          label: 'Title ideas',
          provider: r.provider,
          cards: r.titles.map((t, i) => ({ label: `Title ${i + 1}`, text: t })),
        };
      }
      case 'yt_title': {
        const r = await this.ai.platformContent({ content, platforms: ['youtube'] });
        return {
          label: 'YouTube title',
          provider: r.provider,
          cards: r.result.youtubeTitle
            ? [{ label: 'YouTube title', text: r.result.youtubeTitle }]
            : [],
        };
      }
      case 'yt_description': {
        const r = await this.ai.platformContent({ content, platforms: ['youtube'] });
        return {
          label: 'YouTube description',
          provider: r.provider,
          cards: r.result.youtubeDescription
            ? [{ label: 'YouTube description', text: r.result.youtubeDescription }]
            : [],
        };
      }
      case 'yt_seo': {
        const r = await this.ai.seoKeywords({ content });
        return {
          label: 'SEO keywords',
          provider: r.provider,
          cards: [{ label: 'SEO keywords', text: r.keywords.join(', '), items: r.keywords }],
        };
      }
      default:
        throw new Error('This action does not produce assets.');
    }
  }

  // --- Preview actions (Apply / Edit / discard) ---

  /** Replace the caption with the preview, saving the current text to history. */
  applyPreview(): void {
    const p = this.aiPreview();
    if (!p) return;
    this.snapshotCurrent();
    this.text.set(p.text);
    this.versions.update((v) => [...v, { label: labelFor(p.action), text: p.text }]);
    this.aiPreview.set(null);
    this.toast.success('Applied', 'Your caption was updated. You can still revert.');
  }

  /** Toggle inline editing of the preview text before applying. */
  toggleEditPreview(): void {
    this.aiPreview.update((p) => (p ? { ...p, editing: !p.editing } : p));
  }

  updatePreviewText(value: string): void {
    this.aiPreview.update((p) => (p ? { ...p, text: value } : p));
  }

  discardPreview(): void {
    this.aiPreview.set(null);
  }

  clearAiCards(): void {
    this.aiCards.set([]);
    this.aiCardsLabel.set('');
  }

  /** Snapshot the current caption into history exactly once (the Original). */
  private snapshotCurrent(): void {
    if (this.versions().length === 0) {
      this.versions.set([{ label: 'Original', text: this.text() }]);
    }
  }

  /** Can the caption be reverted (is there an earlier version)? */
  readonly canRevert = computed(() => this.versions().length > 0);

  /** Revert the caption to the previous version in the session history. */
  revertCaption(): void {
    const v = this.versions();
    if (v.length === 0) return;
    // Pop the latest; restore to the one before it (or the original).
    const next = [...v];
    const popped = next.pop()!;
    const restoreTo = next.length > 0 ? next[next.length - 1].text : popped.text;
    // If only the Original remains, restore to it and keep it.
    this.text.set(next.length > 0 ? restoreTo : popped.text);
    this.versions.set(next);
    this.toast.info('Reverted', 'Restored the previous version of your caption.');
  }

  /** Append a card's text to the caption (e.g. hashtags, a chosen CTA/title). */
  appendToCaption(card: AiOutputCard): void {
    this.snapshotCurrent();
    const current = this.text().trimEnd();
    const sep = current.length ? '\n\n' : '';
    const next = `${current}${sep}${card.text}`;
    this.versions.update((v) => [...v, { label: `+ ${card.label}`, text: next }]);
    this.text.set(next);
    this.toast.success('Added', `${card.label} appended to your caption.`);
  }

  /** Copy arbitrary text to the clipboard. */
  async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Copied', 'Copied to clipboard.');
    } catch {
      this.toast.error('Copy failed', 'Your browser blocked clipboard access.');
    }
  }

  /** Map AI errors: a 403 upgrade_required flips to the upgrade nudge. */
  private handleAiError(e: unknown): void {
    const err = e as { status?: number; error?: { reason?: string; error?: string }; message?: string };
    const upgrade = err?.status === 403 || err?.error?.reason === 'upgrade_required';
    const msg = err?.error?.error || err?.message || 'The AI request failed. Please try again.';
    this.aiError.set(msg);
    if (upgrade) {
      this.aiUpgrade.set(true);
      const c = this.aiConfig();
      if (c) this.aiConfig.set({ ...c, planAllowed: false });
      this.toast.error('Upgrade required', 'The AI assistant is on the Pro and Agency plans.');
    } else {
      this.toast.error('AI request failed', msg);
    }
  }
}

/** A caption-style AI result awaiting Apply / Edit / discard. */
interface CaptionPreview {
  action: AiAction;
  text: string;
  editing: boolean;
}

/** Human label for a version-history entry derived from an action. */
function labelFor(action: AiAction): string {
  if (action.platform && action.id.startsWith('rewrite_')) {
    return `Rewrite · ${action.platform}`;
  }
  return action.label;
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
