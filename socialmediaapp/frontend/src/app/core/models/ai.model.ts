/**
 * Types for the AI Content Assistant (GET/POST /api/ai/*).
 * Mirrors the backend AiService response shapes.
 */

/** Platforms the assistant can write for. */
export type AiPlatform = 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'youtube';

/** Rewrite tones supported by the backend. */
export type AiTone =
  | 'professional'
  | 'casual'
  | 'corporate'
  | 'sales'
  | 'educational'
  | 'funny'
  | 'motivational';

/** Target formats for the content-expansion tool. */
export type AiExpandFormat =
  | 'marketing_copy'
  | 'product_announcement'
  | 'long_form_post'
  | 'landing_page';

/** Target formats for the content-shortening tool. */
export type AiShortenFormat = 'short_caption' | 'summary' | 'social_post' | 'sms';

/** Capabilities probe (GET /api/ai/config). */
export interface AiConfig {
  enabled: boolean;
  configured: boolean;
  /** enabled && configured — the feature can actually run (globally). */
  available: boolean;
  /** The signed-in customer's plan id, when a valid token was sent (else null). */
  plan?: string | null;
  /** Whether the customer's plan includes AI: true/false, or null if unknown (not signed in / unreachable). */
  planAllowed?: boolean | null;
  platforms: AiPlatform[];
  tones: AiTone[];
  expandFormats?: AiExpandFormat[];
  shortenFormats?: AiShortenFormat[];
}

/** Platform-content generation result (POST /api/ai/platform-content). */
export interface PlatformContentResult {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  tiktok?: string;
  youtubeTitle?: string;
  youtubeDescription?: string;
  hashtags: string[];
}

export interface PlatformContentResponse {
  result: PlatformContentResult;
  /** Which provider answered ('gemini' | 'openrouter'). */
  provider: string;
}

export interface RewriteResponse {
  rewritten: string;
  provider: string;
}

export interface HashtagsResponse {
  hashtags: string[];
  provider: string;
}

export interface TitlesResponse {
  titles: string[];
  provider: string;
}

export interface TranslateResponse {
  translated: string;
  provider: string;
}

export interface CtasResponse {
  ctas: string[];
  provider: string;
}

/** Content analysis scores (0–100) + suggestions. */
export interface ContentAnalysis {
  clarity: number;
  readability: number;
  engagement: number;
  overall: number;
  summary: string;
  suggestions: string[];
}

export interface AnalyzeResponse {
  analysis: ContentAnalysis;
  provider: string;
}

export interface ExpandResponse {
  expanded: string;
  provider: string;
}

export interface ShortenResponse {
  shortened: string;
  provider: string;
}

/** One-click complete content pack. `posts` is keyed by platform (+ youtubeTitle/youtubeDescription). */
export interface CompletePack {
  posts: Record<string, string>;
  hashtags: string[];
  titles: string[];
  ctas: string[];
  summary: string;
}

export interface CompletePackResponse {
  pack: CompletePack;
  provider: string;
}
