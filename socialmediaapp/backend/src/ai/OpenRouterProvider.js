import { AiProvider } from './AiProvider.js';
import { http } from '../services/http.js';

/**
 * OpenRouterProvider — FALLBACK AI provider. OpenRouter (openrouter.ai) is an
 * OpenAI-compatible gateway that fronts many models behind one API, so the
 * request/response shape is the standard /chat/completions contract.
 *
 * Used only when Gemini is unconfigured or its call throws (see the factory's
 * generateWithFallback). Authenticates with a Bearer key.
 */
export class OpenRouterProvider extends AiProvider {
  get key() {
    return 'openrouter';
  }

  async complete({ system, user, maxTokens = 1024, temperature = 0.7 }) {
    const { apiKey, model, baseUrl } = this.cfg;
    if (!apiKey) throw new Error('OpenRouter is not configured (missing OPENROUTER_API_KEY).');

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const res = await http.post(
      `${baseUrl}/chat/completions`,
      { model, messages, temperature, max_tokens: maxTokens },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter asks (optionally) for attribution headers; harmless if unset.
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://social-cross-poster.local',
          'X-Title': 'Social Cross-Poster AI Assistant',
        },
      }
    );

    const text = (res.data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('OpenRouter returned no text.');
    return text;
  }

  async ping() {
    const { apiKey, baseUrl } = this.cfg;
    // GET /models — a public, GET-only listing endpoint. Any HTTP response
    // proves reachability; validateStatus true so only a thrown connection
    // error (egress block) counts as unreachable.
    await http.get(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      validateStatus: () => true,
    });
  }
}
