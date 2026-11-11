import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AiService } from '../../core/services/ai.service';
import { ToastService } from '../../core/services/toast.service';
import {
  AiConfig,
  AiExpandFormat,
  AiPlatform,
  AiShortenFormat,
  AiTone,
  ContentAnalysis,
  PlatformContentResult,
} from '../../core/models/ai.model';

/** The tool tabs, in display order. */
type AiTool =
  | 'platform'
  | 'rewrite'
  | 'hashtags'
  | 'titles'
  | 'translate'
  | 'ctas'
  | 'analyze'
  | 'expand'
  | 'shorten'
  | 'pack';

interface ToolTab {
  key: AiTool;
  label: string;
  icon: string;
  blurb: string;
}

/** A labelled piece of generated output, ready to render + copy. */
interface OutputCard {
  label: string;
  text: string;
}

/**
 * AiAssistantComponent — the AI Content Assistant (MVP).
 *
 * A single idea in, platform-optimized content out. Five tools behind tabs:
 * generate platform content, rewrite in a tone, hashtags, titles, translate.
 * All state is signal-based; results render as copy-able cards. The feature is
 * hidden/disabled when the backend reports AI is off or unconfigured.
 */
@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [FormsModule, TitleCasePipe, RouterLink],
  templateUrl: './ai-assistant.component.html',
})
export class AiAssistantComponent implements OnInit {
  private readonly ai = inject(AiService);
  private readonly toast = inject(ToastService);

  readonly tabs: ToolTab[] = [
    { key: 'platform', label: 'Platform content', icon: '✨', blurb: 'Turn one idea into posts for every platform.' },
    { key: 'rewrite', label: 'Rewrite', icon: '🔁', blurb: 'Rewrite your text in a different tone.' },
    { key: 'hashtags', label: 'Hashtags', icon: '#️⃣', blurb: 'Generate 10–20 relevant hashtags.' },
    { key: 'titles', label: 'Titles', icon: '🏷️', blurb: 'Catchy title ideas for posts & videos.' },
    { key: 'translate', label: 'Translate', icon: '🌍', blurb: 'Translate while keeping meaning & tone.' },
    { key: 'ctas', label: 'CTAs', icon: '🎯', blurb: 'Generate call-to-action phrases.' },
    { key: 'analyze', label: 'Analyze', icon: '📊', blurb: 'Score clarity, readability & engagement.' },
    { key: 'expand', label: 'Expand', icon: '➕', blurb: 'Turn a short idea into long-form content.' },
    { key: 'shorten', label: 'Shorten', icon: '✂️', blurb: 'Condense long content into a short format.' },
    { key: 'pack', label: 'Complete pack', icon: '📦', blurb: 'Everything in one click: posts, tags, titles, CTAs.' },
  ];

  // --- Capability / availability ---
  readonly cfg = signal<AiConfig | null>(null);
  readonly configLoading = signal(true);
  /** True when the capability probe itself failed (network/server), as opposed to AI being off. */
  readonly configError = signal(false);
  readonly available = computed(() => this.cfg()?.available === true);
  /**
   * Block (show the upgrade prompt) when the customer's plan does NOT include
   * AI. We block when the backend explicitly says planAllowed === false, OR
   * when it resolved the plan but it isn't allowed. We do NOT block on a null
   * planAllowed with no resolved plan (couldn't determine — e.g. auth
   * unreachable): the server-side 403 still protects actual generation, and we
   * avoid locking everyone out during an outage.
   */
  readonly planBlocked = computed(() => {
    const c = this.cfg();
    if (!c) return false;
    if (c.planAllowed === false) return true;
    // Plan was resolved but not flagged allowed.
    if (c.plan != null && c.planAllowed !== true) return true;
    return false;
  });

  // --- Active tab ---
  readonly active = signal<AiTool>('platform');

  // --- Shared input ---
  readonly content = signal('');
  readonly busy = signal(false);

  // --- Platform-content options ---
  readonly allPlatforms: AiPlatform[] = ['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube'];
  readonly selectedPlatforms = signal<Set<AiPlatform>>(new Set(['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube']));
  readonly tones: AiTone[] = ['professional', 'casual', 'corporate', 'sales', 'educational', 'funny', 'motivational'];
  readonly platformTone = signal<AiTone | ''>('');

  // --- Rewrite options ---
  readonly rewriteTone = signal<AiTone>('professional');

  // --- Titles options ---
  readonly titleCount = signal(7);

  // --- Translate options ---
  readonly targetLanguage = signal('');
  readonly commonLanguages = ['Afrikaans', 'isiZulu', 'French', 'Spanish', 'Portuguese', 'German', 'Arabic', 'Mandarin'];

  // --- CTA options ---
  readonly ctaGoal = signal('');

  // --- Expand options ---
  readonly expandFormats: { value: AiExpandFormat; label: string }[] = [
    { value: 'marketing_copy', label: 'Marketing copy' },
    { value: 'product_announcement', label: 'Product announcement' },
    { value: 'long_form_post', label: 'Long-form post' },
    { value: 'landing_page', label: 'Landing page content' },
  ];
  readonly expandFormat = signal<AiExpandFormat>('marketing_copy');
  readonly expandTone = signal<AiTone | ''>('');

  // --- Shorten options ---
  readonly shortenFormats: { value: AiShortenFormat; label: string }[] = [
    { value: 'short_caption', label: 'Short caption' },
    { value: 'summary', label: 'Summary' },
    { value: 'social_post', label: 'Social-ready post' },
    { value: 'sms', label: 'SMS-length message' },
  ];
  readonly shortenFormat = signal<AiShortenFormat>('summary');

  // --- Complete-pack options (reuses selectedPlatforms + a tone) ---
  readonly packTone = signal<AiTone | ''>('');

  // --- Output ---
  readonly outputs = signal<OutputCard[]>([]);
  /** Content-analysis result (only set by the Analyze tool). */
  readonly analysis = signal<ContentAnalysis | null>(null);
  readonly lastProvider = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.cfg.set(await this.ai.config());
      this.configError.set(false);
    } catch {
      // The probe itself failed (server down / network). Do NOT claim the
      // feature is "switched off" — that's a different, misleading message.
      this.configError.set(true);
      this.cfg.set(null);
    } finally {
      this.configLoading.set(false);
    }
  }

  setActive(tool: AiTool): void {
    this.active.set(tool);
    this.outputs.set([]);
    this.analysis.set(null);
    this.lastProvider.set(null);
  }

  activeTab = computed(() => this.tabs.find((t) => t.key === this.active())!);

  // --- Platform selection helpers ---
  isPlatformSelected(p: AiPlatform): boolean {
    return this.selectedPlatforms().has(p);
  }
  togglePlatform(p: AiPlatform): void {
    const next = new Set(this.selectedPlatforms());
    if (next.has(p)) next.delete(p);
    else next.add(p);
    this.selectedPlatforms.set(next);
  }

  private guard(): boolean {
    if (!this.available()) {
      this.toast.error('AI unavailable', 'The AI assistant is turned off or not configured.');
      return false;
    }
    if (!this.content().trim()) {
      this.toast.error('Add some content', 'Type an idea or paste content to work with.');
      return false;
    }
    return true;
  }

  async run(): Promise<void> {
    if (this.busy()) return;
    if (this.active() === 'translate' && !this.targetLanguage().trim()) {
      this.toast.error('Pick a language', 'Choose or type a target language to translate into.');
      return;
    }
    if (!this.guard()) return;

    this.busy.set(true);
    this.outputs.set([]);
    this.analysis.set(null);
    this.lastProvider.set(null);
    const content = this.content().trim();

    try {
      switch (this.active()) {
        case 'platform': {
          const platforms = [...this.selectedPlatforms()];
          if (platforms.length === 0) {
            this.toast.error('Pick a platform', 'Select at least one platform to generate for.');
            break;
          }
          const tone = this.platformTone() || undefined;
          const res = await this.ai.platformContent({ content, platforms, tone });
          this.outputs.set(this.platformCards(res.result));
          this.lastProvider.set(res.provider);
          break;
        }
        case 'rewrite': {
          const res = await this.ai.rewrite({ content, tone: this.rewriteTone() });
          this.outputs.set([{ label: `Rewritten (${this.rewriteTone()})`, text: res.rewritten }]);
          this.lastProvider.set(res.provider);
          break;
        }
        case 'hashtags': {
          const res = await this.ai.hashtags({ content });
          this.outputs.set([{ label: 'Hashtags', text: res.hashtags.join(' ') }]);
          this.lastProvider.set(res.provider);
          break;
        }
        case 'titles': {
          const res = await this.ai.titles({ content, count: this.titleCount() });
          this.outputs.set(res.titles.map((t, i) => ({ label: `Title ${i + 1}`, text: t })));
          this.lastProvider.set(res.provider);
          break;
        }
        case 'translate': {
          const res = await this.ai.translate({ content, targetLanguage: this.targetLanguage().trim() });
          this.outputs.set([{ label: `Translated → ${this.targetLanguage().trim()}`, text: res.translated }]);
          this.lastProvider.set(res.provider);
          break;
        }
        case 'ctas': {
          const goal = this.ctaGoal().trim() || undefined;
          const res = await this.ai.ctas({ content, goal });
          this.outputs.set(res.ctas.map((c, i) => ({ label: `CTA ${i + 1}`, text: c })));
          this.lastProvider.set(res.provider);
          break;
        }
        case 'analyze': {
          const res = await this.ai.analyze({ content });
          this.analysis.set(res.analysis);
          // Also surface the suggestions as copy-able cards.
          this.outputs.set(res.analysis.suggestions.map((s, i) => ({ label: `Suggestion ${i + 1}`, text: s })));
          this.lastProvider.set(res.provider);
          break;
        }
        case 'expand': {
          const tone = this.expandTone() || undefined;
          const res = await this.ai.expand({ content, format: this.expandFormat(), tone });
          const label = this.expandFormats.find((f) => f.value === this.expandFormat())?.label ?? 'Expanded';
          this.outputs.set([{ label, text: res.expanded }]);
          this.lastProvider.set(res.provider);
          break;
        }
        case 'shorten': {
          const res = await this.ai.shorten({ content, format: this.shortenFormat() });
          const label = this.shortenFormats.find((f) => f.value === this.shortenFormat())?.label ?? 'Shortened';
          this.outputs.set([{ label, text: res.shortened }]);
          this.lastProvider.set(res.provider);
          break;
        }
        case 'pack': {
          const platforms = [...this.selectedPlatforms()];
          if (platforms.length === 0) {
            this.toast.error('Pick a platform', 'Select at least one platform for the pack.');
            break;
          }
          const tone = this.packTone() || undefined;
          const res = await this.ai.completePack({ content, platforms, tone });
          this.outputs.set(this.packCards(res.pack));
          this.lastProvider.set(res.provider);
          break;
        }
      }
      if (this.outputs().length || this.analysis()) {
        this.toast.success('Done', 'Your content is ready.');
      }
    } catch (err: unknown) {
      // Runtime safety net: a 403 upgrade_required means the plan doesn't
      // include AI — flip to the upgrade view instead of just toasting.
      const anyErr = err as { status?: number; error?: { reason?: string } };
      if (anyErr?.status === 403 || anyErr?.error?.reason === 'upgrade_required') {
        const c = this.cfg();
        if (c) this.cfg.set({ ...c, planAllowed: false });
        this.toast.error('Upgrade required', 'The AI assistant is on the Pro and Agency plans.');
      } else {
        this.toast.error('AI request failed', this.errorMessage(err));
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Flatten a PlatformContentResult into labelled, copy-able cards. */
  private platformCards(r: PlatformContentResult): OutputCard[] {
    const cards: OutputCard[] = [];
    if (r.facebook) cards.push({ label: 'Facebook', text: r.facebook });
    if (r.instagram) cards.push({ label: 'Instagram caption', text: r.instagram });
    if (r.linkedin) cards.push({ label: 'LinkedIn', text: r.linkedin });
    if (r.tiktok) cards.push({ label: 'TikTok caption', text: r.tiktok });
    if (r.youtubeTitle) cards.push({ label: 'YouTube title', text: r.youtubeTitle });
    if (r.youtubeDescription) cards.push({ label: 'YouTube description', text: r.youtubeDescription });
    if (r.hashtags?.length) cards.push({ label: 'Hashtags', text: r.hashtags.join(' ') });
    return cards;
  }

  /** Flatten a complete pack (posts + hashtags + titles + CTAs + summary) into cards. */
  private packCards(p: {
    posts: Record<string, string>;
    hashtags: string[];
    titles: string[];
    ctas: string[];
    summary: string;
  }): OutputCard[] {
    const cards: OutputCard[] = [];
    if (p.summary) cards.push({ label: 'Summary', text: p.summary });
    const labels: Record<string, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram caption',
      linkedin: 'LinkedIn',
      tiktok: 'TikTok caption',
      youtubeTitle: 'YouTube title',
      youtubeDescription: 'YouTube description',
    };
    for (const [key, val] of Object.entries(p.posts || {})) {
      if (val) cards.push({ label: labels[key] ?? key, text: val });
    }
    if (p.titles?.length) {
      p.titles.forEach((t, i) => cards.push({ label: `Title ${i + 1}`, text: t }));
    }
    if (p.ctas?.length) {
      p.ctas.forEach((c, i) => cards.push({ label: `CTA ${i + 1}`, text: c }));
    }
    if (p.hashtags?.length) cards.push({ label: 'Hashtags', text: p.hashtags.join(' ') });
    return cards;
  }

  /** Copy one card's text to the clipboard. */
  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Copied', 'Copied to clipboard.');
    } catch {
      this.toast.error('Copy failed', 'Your browser blocked clipboard access.');
    }
  }

  /** Copy all outputs joined into one block. */
  async copyAll(): Promise<void> {
    const all = this.outputs()
      .map((o) => `${o.label}:\n${o.text}`)
      .join('\n\n');
    await this.copy(all);
  }

  private errorMessage(err: unknown): string {
    const anyErr = err as { error?: { error?: string }; message?: string };
    return anyErr?.error?.error || anyErr?.message || 'Something went wrong. Please try again.';
  }
}
