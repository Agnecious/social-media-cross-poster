import { AiProvider } from './AiProvider.js';
import { http } from '../services/http.js';

/**
 * GeminiProvider — PRIMARY AI provider, backed by Google's Generative Language
 * API (generativelanguage.googleapis.com, the public "AI Studio" REST surface
 * that authenticates with a simple API key, not OAuth).
 *
 * Endpoint shape:
 *   POST {baseUrl}/v1beta/models/{model}:generateContent?key={apiKey}
 * Gemini has no separate "system" role on this surface, so we fold the system
 * instruction into `systemInstruction` and put the user text in `contents`.
 */
export class GeminiProvider extends AiProvider {
  get key() {
    return 'gemini';
  }

  async complete({ system, user, maxTokens = 1024, temperature = 0.7 }) {
    const { apiKey, model, baseUrl } = this.cfg;
    if (!apiKey) throw new Error('Gemini is not configured (missing GEMINI_API_KEY).');

    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };

    const res = await http.post(url, body, {
      params: { key: apiKey },
      headers: { 'Content-Type': 'application/json' },
    });

    // Concatenate all text parts of the first candidate.
    const candidate = res.data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p) => p?.text || '').join('').trim();
    if (!text) {
      const reason = candidate?.finishReason || res.data?.promptFeedback?.blockReason;
      throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ''}.`);
    }
    return text;
  }

  async ping() {
    const { apiKey, model, baseUrl } = this.cfg;
    // GET the model's metadata — a cheap, GET-only endpoint. Any HTTP response
    // (200 with a key, 400/403 without) proves we reached Gemini; validateStatus
    // true so only a thrown connection error counts as unreachable.
    await http.get(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}`, {
      params: apiKey ? { key: apiKey } : undefined,
      validateStatus: () => true,
    });
  }
}
