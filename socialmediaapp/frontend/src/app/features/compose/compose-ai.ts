import { AiPlatform } from '../../core/models/ai.model';

/**
 * Compose AI — the catalogue of one-click AI actions offered on the Compose
 * screen, plus the small value types the component and its template share.
 *
 * The component owns the signals and the async dispatch (it needs AiService +
 * ToastService); this module just declares WHAT actions exist and how they're
 * grouped, so the template and the dispatch switch stay in sync from one source.
 */

/** Stable identifiers for every AI action available on Compose. */
export type AiActionId =
  // Quick edits that transform the caption in place.
  | 'improve'
  | 'professional'
  | 'casual'
  | 'shorten'
  | 'expand'
  | 'grammar'
  | 'cta'
  // Rewrite the caption natively for one platform.
  | 'rewrite_facebook'
  | 'rewrite_instagram'
  | 'rewrite_x'
  | 'rewrite_linkedin'
  | 'rewrite_tiktok'
  | 'rewrite_youtube'
  // Platform asset generators (produce cards, not a caption replacement).
  | 'gen_hashtags'
  | 'gen_titles'
  | 'yt_title'
  | 'yt_description'
  | 'yt_seo';

/**
 * How an action's primary result is consumed:
 *  - 'caption'  → a single text result that can REPLACE the caption (preview → apply)
 *  - 'cards'    → one or more labelled snippets to copy or append (hashtags, titles…)
 */
export type AiActionKind = 'caption' | 'cards';

export interface AiAction {
  id: AiActionId;
  label: string;
  icon: string;
  kind: AiActionKind;
  /** Short helper shown as a tooltip / sub-label. */
  hint: string;
  /** If set, the action targets this platform (drives the avatar accent). */
  platform?: AiPlatform;
}

export interface AiActionGroup {
  key: string;
  title: string;
  hint: string;
  actions: AiAction[];
}

/**
 * The action catalogue, grouped for the UI. Platforms match the backend's
 * SUPPORTED_PLATFORMS (facebook, instagram, linkedin, tiktok, youtube). X
 * (Twitter) is intentionally absent — the backend does not support it; the
 * template surfaces that as an explained, disabled option so the requirement
 * is visible rather than silently dropped.
 */
export const AI_ACTION_GROUPS: readonly AiActionGroup[] = Object.freeze([
  {
    key: 'edit',
    title: 'Improve this caption',
    hint: 'Transform your text — preview before it replaces anything.',
    actions: [
      { id: 'improve', label: 'Improve engagement', icon: '🔥', kind: 'caption', hint: 'More hook, more shareable' },
      { id: 'professional', label: 'More professional', icon: '👔', kind: 'caption', hint: 'Polished, business tone' },
      { id: 'casual', label: 'More casual', icon: '😊', kind: 'caption', hint: 'Relaxed, friendly tone' },
      { id: 'shorten', label: 'Shorten', icon: '✂️', kind: 'caption', hint: 'Tighter, punchier' },
      { id: 'expand', label: 'Expand', icon: '➕', kind: 'caption', hint: 'Add useful detail' },
      { id: 'grammar', label: 'Fix grammar', icon: '✅', kind: 'caption', hint: 'Spelling & punctuation' },
      { id: 'cta', label: 'Add call-to-action', icon: '🎯', kind: 'cards', hint: 'Generate CTA options' },
    ],
  },
  {
    key: 'platform',
    title: 'Rewrite for a platform',
    hint: 'Adapt the caption to each platform’s native style.',
    actions: [
      { id: 'rewrite_facebook', label: 'Facebook', icon: 'f', kind: 'caption', hint: 'Friendly & community-focused', platform: 'facebook' },
      { id: 'rewrite_instagram', label: 'Instagram', icon: 'ig', kind: 'caption', hint: 'Punchy caption + emojis', platform: 'instagram' },
      { id: 'rewrite_x', label: 'X (Twitter)', icon: 'X', kind: 'caption', hint: 'Concise, ≤280, hook-first', platform: 'x' },
      { id: 'rewrite_linkedin', label: 'LinkedIn', icon: 'in', kind: 'caption', hint: 'Professional & insight-led', platform: 'linkedin' },
      { id: 'rewrite_tiktok', label: 'TikTok', icon: 'tt', kind: 'caption', hint: 'Short, trendy, hook-first', platform: 'tiktok' },
      { id: 'rewrite_youtube', label: 'YouTube', icon: 'yt', kind: 'caption', hint: 'Rich video description', platform: 'youtube' },
    ],
  },
  {
    key: 'assets',
    title: 'Generate assets',
    hint: 'Hashtags, titles and SEO you can copy or append.',
    actions: [
      { id: 'gen_hashtags', label: 'Hashtags', icon: '#️⃣', kind: 'cards', hint: '10–20 relevant tags' },
      { id: 'gen_titles', label: 'Titles', icon: '🏷️', kind: 'cards', hint: 'Catchy title ideas' },
      { id: 'yt_title', label: 'YouTube title', icon: '🎬', kind: 'cards', hint: 'Clickable video title', platform: 'youtube' },
      { id: 'yt_description', label: 'YouTube description', icon: '📝', kind: 'cards', hint: 'Detailed description', platform: 'youtube' },
      { id: 'yt_seo', label: 'SEO keywords', icon: '🔎', kind: 'cards', hint: 'Discoverability tags', platform: 'youtube' },
    ],
  },
]);

/** A labelled, copy-able/append-able snippet produced by a 'cards' action. */
export interface AiOutputCard {
  label: string;
  text: string;
  /** For list-style outputs (hashtags, keywords) we also keep the items. */
  items?: string[];
}

/** One entry in the session version history (for revert/compare). */
export interface CaptionVersion {
  /** Human label, e.g. "Original", "Improve engagement", "Rewrite · Instagram". */
  label: string;
  text: string;
}
