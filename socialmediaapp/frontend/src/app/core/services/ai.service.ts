import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AiConfig,
  AiExpandFormat,
  AiPlatform,
  AiShortenFormat,
  AiTone,
  AnalyzeResponse,
  CompletePackResponse,
  CtasResponse,
  ExpandResponse,
  HashtagsResponse,
  PlatformContentResponse,
  ProofreadResponse,
  RewriteResponse,
  SeoKeywordsResponse,
  ShortenResponse,
  TitlesResponse,
  TranslateResponse,
} from '../models/ai.model';

/**
 * AiService — client for the AI Content Assistant endpoints (/api/ai/*). The
 * customer's Supabase token is attached by the customer-auth interceptor
 * (these URLs contain '/api/ai/'). All methods return the parsed payload and
 * throw on HTTP error so components can surface a toast.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/ai`;

  /** Capabilities probe: is AI on/configured, and which platforms/tones exist. */
  config(): Promise<AiConfig> {
    return firstValueFrom(this.http.get<AiConfig>(`${this.base}/config`));
  }

  /** Turn one idea into platform-optimized content + hashtags. */
  platformContent(input: {
    content: string;
    platforms?: AiPlatform[];
    tone?: AiTone;
  }): Promise<PlatformContentResponse> {
    return firstValueFrom(
      this.http.post<PlatformContentResponse>(`${this.base}/platform-content`, input)
    );
  }

  /** Rewrite content in a given tone. */
  rewrite(input: { content: string; tone: AiTone }): Promise<RewriteResponse> {
    return firstValueFrom(this.http.post<RewriteResponse>(`${this.base}/rewrite`, input));
  }

  /** Generate 10-20 relevant hashtags. */
  hashtags(input: { content: string }): Promise<HashtagsResponse> {
    return firstValueFrom(this.http.post<HashtagsResponse>(`${this.base}/hashtags`, input));
  }

  /** Generate catchy title suggestions. */
  titles(input: { content: string; count?: number }): Promise<TitlesResponse> {
    return firstValueFrom(this.http.post<TitlesResponse>(`${this.base}/titles`, input));
  }

  /** Translate content, preserving meaning and tone. */
  translate(input: { content: string; targetLanguage: string }): Promise<TranslateResponse> {
    return firstValueFrom(this.http.post<TranslateResponse>(`${this.base}/translate`, input));
  }

  /** Generate call-to-action phrases. */
  ctas(input: { content: string; goal?: string; count?: number }): Promise<CtasResponse> {
    return firstValueFrom(this.http.post<CtasResponse>(`${this.base}/ctas`, input));
  }

  /** Score content (clarity/readability/engagement) + improvement tips. */
  analyze(input: { content: string }): Promise<AnalyzeResponse> {
    return firstValueFrom(this.http.post<AnalyzeResponse>(`${this.base}/analyze`, input));
  }

  /** Expand a short idea into a longer piece in a chosen format. */
  expand(input: { content: string; format: AiExpandFormat; tone?: AiTone }): Promise<ExpandResponse> {
    return firstValueFrom(this.http.post<ExpandResponse>(`${this.base}/expand`, input));
  }

  /** Shorten long content into a compact format. */
  shorten(input: { content: string; format: AiShortenFormat }): Promise<ShortenResponse> {
    return firstValueFrom(this.http.post<ShortenResponse>(`${this.base}/shorten`, input));
  }

  /** Fix grammar, spelling & punctuation while preserving meaning and tone. */
  proofread(input: { content: string }): Promise<ProofreadResponse> {
    return firstValueFrom(this.http.post<ProofreadResponse>(`${this.base}/proofread`, input));
  }

  /** Generate SEO keywords/tags (discoverability) — ideal for YouTube. */
  seoKeywords(input: { content: string; count?: number }): Promise<SeoKeywordsResponse> {
    return firstValueFrom(this.http.post<SeoKeywordsResponse>(`${this.base}/seo-keywords`, input));
  }

  /** One-click: platform posts + hashtags + titles + CTAs + summary. */
  completePack(input: {
    content: string;
    platforms?: AiPlatform[];
    tone?: AiTone;
  }): Promise<CompletePackResponse> {
    return firstValueFrom(this.http.post<CompletePackResponse>(`${this.base}/complete-pack`, input));
  }
}
