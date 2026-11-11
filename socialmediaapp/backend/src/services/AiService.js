/**
 * AiService — the AI Content Assistant's product logic.
 *
 * Each public method composes a prompt (a system instruction that pins the
 * output format + a user message carrying the task) and asks the provider
 * chain (Gemini → OpenRouter) to complete it, then parses the result. Providers
 * know nothing about "hashtags" or "platforms"; all of that lives here.
 *
 * MVP scope (5 tools):
 *   generatePlatformContent · rewrite · generateHashtags · generateTitles · translate
 *
 * Output discipline: we instruct the model to return STRICT JSON and then parse
 * it defensively (extractJson) because models occasionally wrap JSON in prose
 * or code fences. If parsing fails we throw a clear error the route maps to 502.
 */
import { generateWithFallback } from '../ai/index.js';

/** The platforms the assistant writes for, with their nuances baked into the prompt. */
export const SUPPORTED_PLATFORMS = Object.freeze([
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'youtube',
]);

/** Allowed rewrite tones. */
export const SUPPORTED_TONES = Object.freeze([
  'professional',
  'casual',
  'corporate',
  'sales',
  'educational',
  'funny',
  'motivational',
]);

/** Target formats for the content-expansion tool (short idea → long form). */
export const EXPAND_FORMATS = Object.freeze([
  'marketing_copy',
  'product_announcement',
  'long_form_post',
  'landing_page',
]);

/** Target formats for the content-shortening tool (long → short). */
export const SHORTEN_FORMATS = Object.freeze([
  'short_caption',
  'summary',
  'social_post',
  'sms',
]);

/** Hard cap on input length to control cost/latency (chars). */
const MAX_INPUT_CHARS = 6000;

/**
 * Pull a JSON value out of a model response. Handles the common cases where the
 * model wraps JSON in ```json fences or adds a sentence before/after. Throws if
 * no parseable JSON object/array can be found.
 * @param {string} text
 * @returns {any}
 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') throw new Error('Empty AI response.');
  let s = text.trim();

  // Strip Markdown code fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Fast path: already pure JSON.
  try {
    return JSON.parse(s);
  } catch {
    /* fall through to bracket extraction */
  }

  // Slice from the first opening bracket to the last matching closing one.
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) throw new Error('AI response contained no JSON.');
  const openChar = s[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = s.lastIndexOf(closeChar);
  if (end === -1 || end < start) throw new Error('AI response contained malformed JSON.');

  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    throw new Error('Could not parse the AI response as JSON.');
  }
}

/** Validate + normalise free-text input. Throws a user-facing error if empty/oversized. */
function cleanInput(content) {
  const text = String(content ?? '').trim();
  if (!text) throw new Error('Please provide some content to work with.');
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`Content is too long (max ${MAX_INPUT_CHARS} characters).`);
  }
  return text;
}

/** Coerce a possibly-messy array-of-strings into a trimmed, de-duped string[]. */
function toStringList(value, limit = 50) {
  const arr = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = String(item ?? '').trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}

const JSON_ONLY = 'Respond with ONLY valid minified JSON and no commentary, no Markdown fences.';

/**
 * 1) Generate platform-specific content from one idea.
 * @param {object} args
 * @param {string} args.content   the source idea/post
 * @param {string[]} [args.platforms] subset of SUPPORTED_PLATFORMS (default all)
 * @param {string} [args.tone]    optional tone hint
 * @param {object} [log]
 * @returns {Promise<{result:object, provider:string}>} result keyed by platform + hashtags
 */
export async function generatePlatformContent({ content, platforms, tone }, log) {
  const text = cleanInput(content);
  const targets =
    Array.isArray(platforms) && platforms.length
      ? platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p))
      : [...SUPPORTED_PLATFORMS];
  if (targets.length === 0) throw new Error('No valid platforms selected.');

  const toneLine = tone && SUPPORTED_TONES.includes(tone) ? ` Use a ${tone} tone.` : '';
  const system =
    'You are an expert social media copywriter. Adapt one idea into optimized, ' +
    'platform-native content. Respect each platform: Facebook = friendly and ' +
    'community-focused; Instagram = punchy caption with tasteful emojis; LinkedIn = ' +
    'professional and insight-led; TikTok = short, trendy, hook-first; YouTube = a ' +
    'clickable title AND a rich description. Keep the core message intact.' +
    toneLine +
    ' ' +
    JSON_ONLY;

  // Build a schema that only asks for the requested platforms.
  const wantsYouTube = targets.includes('youtube');
  const schemaKeys = targets
    .filter((p) => p !== 'youtube')
    .map((p) => `"${p}": "<text>"`);
  if (wantsYouTube) {
    schemaKeys.push('"youtubeTitle": "<text>"', '"youtubeDescription": "<text>"');
  }
  schemaKeys.push('"hashtags": ["#tag", ...]');

  const user =
    `Idea:\n"""${text}"""\n\n` +
    `Return JSON with exactly these keys: {${schemaKeys.join(', ')}}. ` +
    'Provide 8-15 relevant hashtags. Do not include platforms that were not requested.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 1500, temperature: 0.8 },
    log
  );
  const parsed = extractJson(raw);

  const result = {};
  for (const p of targets) {
    if (p === 'youtube') {
      result.youtubeTitle = String(parsed.youtubeTitle ?? '').trim();
      result.youtubeDescription = String(parsed.youtubeDescription ?? '').trim();
    } else {
      result[p] = String(parsed[p] ?? '').trim();
    }
  }
  result.hashtags = toStringList(parsed.hashtags, 20).map((h) => (h.startsWith('#') ? h : `#${h}`));
  return { result, provider };
}

/**
 * 2) Rewrite content in a given tone.
 * @param {object} args
 * @param {string} args.content
 * @param {string} args.tone  one of SUPPORTED_TONES
 * @param {object} [log]
 * @returns {Promise<{rewritten:string, provider:string}>}
 */
export async function rewrite({ content, tone }, log) {
  const text = cleanInput(content);
  const t = String(tone || '').toLowerCase();
  if (!SUPPORTED_TONES.includes(t)) {
    throw new Error(`Unsupported tone. Choose one of: ${SUPPORTED_TONES.join(', ')}.`);
  }
  const system =
    `You rewrite text in a specific tone while preserving meaning and key facts. ` +
    `Tone: ${t}. Keep it natural and ready to post. ${JSON_ONLY}`;
  const user = `Rewrite this in a ${t} tone:\n"""${text}"""\n\nReturn JSON: {"rewritten": "<text>"}.`;

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 1200, temperature: 0.7 },
    log
  );
  const parsed = extractJson(raw);
  const rewritten = String(parsed.rewritten ?? '').trim();
  if (!rewritten) throw new Error('The AI did not return rewritten text.');
  return { rewritten, provider };
}

/**
 * 3) Generate 10-20 relevant hashtags.
 * @param {object} args
 * @param {string} args.content
 * @param {object} [log]
 * @returns {Promise<{hashtags:string[], provider:string}>}
 */
export async function generateHashtags({ content }, log) {
  const text = cleanInput(content);
  const system =
    'You are a social media hashtag strategist. Produce a mix of broad and niche, ' +
    'high-relevance hashtags. No spaces, no duplicates. ' + JSON_ONLY;
  const user =
    `Generate 10 to 20 relevant hashtags for this content:\n"""${text}"""\n\n` +
    'Return JSON: {"hashtags": ["#tag", ...]}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 400, temperature: 0.6 },
    log
  );
  const parsed = extractJson(raw);
  const hashtags = toStringList(parsed.hashtags, 20).map((h) => (h.startsWith('#') ? h : `#${h}`));
  if (hashtags.length === 0) throw new Error('The AI did not return any hashtags.');
  return { hashtags, provider };
}

/**
 * 4) Generate multiple catchy title suggestions.
 * @param {object} args
 * @param {string} args.content
 * @param {number} [args.count] how many titles (default 7, clamped 3..15)
 * @param {object} [log]
 * @returns {Promise<{titles:string[], provider:string}>}
 */
export async function generateTitles({ content, count }, log) {
  const text = cleanInput(content);
  const n = Math.min(15, Math.max(3, Number(count) || 7));
  const system =
    'You write catchy, high-CTR titles for posts, videos, blogs and campaigns. ' +
    'Vary the angle (curiosity, benefit, how-to, number, bold claim). ' + JSON_ONLY;
  const user =
    `Generate ${n} distinct title options for this:\n"""${text}"""\n\n` +
    'Return JSON: {"titles": ["<title>", ...]}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 500, temperature: 0.9 },
    log
  );
  const parsed = extractJson(raw);
  const titles = toStringList(parsed.titles, n);
  if (titles.length === 0) throw new Error('The AI did not return any titles.');
  return { titles, provider };
}

/**
 * 5) Translate content while keeping meaning and tone.
 * @param {object} args
 * @param {string} args.content
 * @param {string} args.targetLanguage  e.g. "French", "isiZulu", "Spanish"
 * @param {object} [log]
 * @returns {Promise<{translated:string, provider:string}>}
 */
export async function translate({ content, targetLanguage }, log) {
  const text = cleanInput(content);
  const lang = String(targetLanguage || '').trim();
  if (!lang) throw new Error('Please specify a target language.');
  if (lang.length > 40) throw new Error('Target language name is too long.');

  const system =
    'You are a professional translator. Translate faithfully, preserving meaning, ' +
    'tone, and intent (not a literal word-for-word translation). Keep hashtags, ' +
    '@mentions and URLs unchanged. ' + JSON_ONLY;
  const user =
    `Translate the following into ${lang}:\n"""${text}"""\n\n` +
    'Return JSON: {"translated": "<text>"}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 1500, temperature: 0.3 },
    log
  );
  const parsed = extractJson(raw);
  const translated = String(parsed.translated ?? '').trim();
  if (!translated) throw new Error('The AI did not return a translation.');
  return { translated, provider };
}

/**
 * 6) Generate call-to-action phrases (Learn More, Sign Up Now, Book a Demo, …).
 * @param {object} args
 * @param {string} args.content   what the post/campaign is about
 * @param {string} [args.goal]    optional goal hint (e.g. "drive sign-ups")
 * @param {number} [args.count]   how many CTAs (default 8, clamped 3..15)
 * @param {object} [log]
 * @returns {Promise<{ctas:string[], provider:string}>}
 */
export async function generateCtas({ content, goal, count }, log) {
  const text = cleanInput(content);
  const n = Math.min(15, Math.max(3, Number(count) || 8));
  const goalLine = goal && String(goal).trim() ? ` The goal is: ${String(goal).trim()}.` : '';
  const system =
    'You are a conversion copywriter. Write short, punchy call-to-action phrases ' +
    '(2–5 words each) that prompt a specific next step. Vary the angle.' +
    goalLine +
    ' ' +
    JSON_ONLY;
  const user =
    `Generate ${n} call-to-action options for this content:\n"""${text}"""\n\n` +
    'Return JSON: {"ctas": ["<cta>", ...]}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 400, temperature: 0.8 },
    log
  );
  const parsed = extractJson(raw);
  const ctas = toStringList(parsed.ctas, n);
  if (ctas.length === 0) throw new Error('The AI did not return any CTAs.');
  return { ctas, provider };
}

/**
 * 7) Analyse content: score clarity / readability / engagement (0–100) and
 * return concrete improvement suggestions.
 * @param {object} args
 * @param {string} args.content
 * @param {object} [log]
 * @returns {Promise<{analysis:{clarity:number, readability:number, engagement:number, overall:number, suggestions:string[], summary:string}, provider:string}>}
 */
export async function analyzeContent({ content }, log) {
  const text = cleanInput(content);
  const system =
    'You are a content quality analyst. Score the text on three dimensions from ' +
    '0 to 100 (higher is better): clarity (easy to understand), readability (flow, ' +
    'sentence length, jargon) and engagement (hook, interest, shareability). Be ' +
    'honest and consistent. Then give specific, actionable improvement suggestions. ' +
    JSON_ONLY;
  const user =
    `Analyse this content:\n"""${text}"""\n\n` +
    'Return JSON: {"clarity": <0-100>, "readability": <0-100>, "engagement": <0-100>, ' +
    '"summary": "<one-sentence verdict>", "suggestions": ["<tip>", ...]}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 700, temperature: 0.4 },
    log
  );
  const parsed = extractJson(raw);

  // Clamp scores to 0–100 integers; default to 0 if the model omitted one.
  const score = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
  };
  const clarity = score(parsed.clarity);
  const readability = score(parsed.readability);
  const engagement = score(parsed.engagement);
  const overall = Math.round((clarity + readability + engagement) / 3);
  const suggestions = toStringList(parsed.suggestions, 10);
  const summary = String(parsed.summary ?? '').trim();

  return {
    analysis: { clarity, readability, engagement, overall, suggestions, summary },
    provider,
  };
}

/** Human labels for expand formats (used in the prompt). */
const EXPAND_LABELS = {
  marketing_copy: 'persuasive marketing copy',
  product_announcement: 'a product announcement',
  long_form_post: 'an engaging long-form post',
  landing_page: 'landing page copy (headline, subhead, body, bullet benefits, CTA)',
};

/**
 * 8) Expand a short idea into a longer piece in a chosen format.
 * @param {object} args
 * @param {string} args.content
 * @param {string} args.format  one of EXPAND_FORMATS
 * @param {string} [args.tone]
 * @param {object} [log]
 * @returns {Promise<{expanded:string, provider:string}>}
 */
export async function expandContent({ content, format, tone }, log) {
  const text = cleanInput(content);
  const f = String(format || '').toLowerCase();
  if (!EXPAND_FORMATS.includes(f)) {
    throw new Error(`Unsupported format. Choose one of: ${EXPAND_FORMATS.join(', ')}.`);
  }
  const toneLine = tone && SUPPORTED_TONES.includes(tone) ? ` Use a ${tone} tone.` : '';
  const system =
    `You are a marketing copywriter. Expand a short idea into ${EXPAND_LABELS[f]}, ` +
    `keeping the core message and adding useful, non-fluffy detail.${toneLine} ${JSON_ONLY}`;
  const user =
    `Expand this idea into ${EXPAND_LABELS[f]}:\n"""${text}"""\n\n` +
    'Return JSON: {"expanded": "<text>"}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 1800, temperature: 0.8 },
    log
  );
  const parsed = extractJson(raw);
  const expanded = String(parsed.expanded ?? '').trim();
  if (!expanded) throw new Error('The AI did not return expanded content.');
  return { expanded, provider };
}

/** Human labels + constraints for shorten formats. */
const SHORTEN_LABELS = {
  short_caption: 'a short, punchy caption (1–2 lines)',
  summary: 'a concise summary (2–3 sentences)',
  social_post: 'a ready-to-post social update',
  sms: 'an SMS-length message (max 160 characters)',
};

/**
 * 9) Shorten long content into a chosen compact format.
 * @param {object} args
 * @param {string} args.content
 * @param {string} args.format  one of SHORTEN_FORMATS
 * @param {object} [log]
 * @returns {Promise<{shortened:string, provider:string}>}
 */
export async function shortenContent({ content, format }, log) {
  const text = cleanInput(content);
  const f = String(format || '').toLowerCase();
  if (!SHORTEN_FORMATS.includes(f)) {
    throw new Error(`Unsupported format. Choose one of: ${SHORTEN_FORMATS.join(', ')}.`);
  }
  const smsNote = f === 'sms' ? ' The result MUST be 160 characters or fewer.' : '';
  const system =
    `You condense text into ${SHORTEN_LABELS[f]} while keeping the key message and ` +
    `tone. Cut filler, keep impact.${smsNote} ${JSON_ONLY}`;
  const user =
    `Shorten this into ${SHORTEN_LABELS[f]}:\n"""${text}"""\n\n` +
    'Return JSON: {"shortened": "<text>"}.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 500, temperature: 0.6 },
    log
  );
  const parsed = extractJson(raw);
  let shortened = String(parsed.shortened ?? '').trim();
  if (!shortened) throw new Error('The AI did not return shortened content.');
  // Hard-enforce the SMS limit regardless of what the model returned.
  if (f === 'sms' && shortened.length > 160) shortened = shortened.slice(0, 160).trim();
  return { shortened, provider };
}

/**
 * 10) Complete content pack — everything in one call: platform-specific posts,
 * hashtags, titles, CTAs and a summary. One model call keeps it cheap and
 * internally consistent (the same idea drives every output).
 * @param {object} args
 * @param {string} args.content
 * @param {string[]} [args.platforms]  subset of SUPPORTED_PLATFORMS (default all)
 * @param {string} [args.tone]
 * @param {object} [log]
 * @returns {Promise<{pack:object, provider:string}>}
 */
export async function completePack({ content, platforms, tone }, log) {
  const text = cleanInput(content);
  const targets =
    Array.isArray(platforms) && platforms.length
      ? platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p))
      : [...SUPPORTED_PLATFORMS];
  if (targets.length === 0) throw new Error('No valid platforms selected.');

  const toneLine = tone && SUPPORTED_TONES.includes(tone) ? ` Use a ${tone} tone throughout.` : '';
  const system =
    'You are a senior social media strategist. From ONE idea produce a complete, ' +
    'internally-consistent content pack: platform-native posts, hashtags, title ' +
    'options, call-to-action phrases and a short summary. Respect each platform ' +
    '(Facebook friendly, Instagram punchy + emojis, LinkedIn professional, TikTok ' +
    'hook-first, YouTube clickable title + rich description).' +
    toneLine +
    ' ' +
    JSON_ONLY;

  const wantsYouTube = targets.includes('youtube');
  const platformKeys = targets
    .filter((p) => p !== 'youtube')
    .map((p) => `"${p}": "<text>"`);
  if (wantsYouTube) {
    platformKeys.push('"youtubeTitle": "<text>"', '"youtubeDescription": "<text>"');
  }

  const user =
    `Idea:\n"""${text}"""\n\n` +
    'Return JSON: {"posts": {' + platformKeys.join(', ') + '}, ' +
    '"hashtags": ["#tag", ...], "titles": ["<title>", ...], ' +
    '"ctas": ["<cta>", ...], "summary": "<2-3 sentence summary>"}. ' +
    'Provide 8–15 hashtags, 5 titles and 4 CTAs. Only include requested platforms.';

  const { text: raw, provider } = await generateWithFallback(
    { system, user, maxTokens: 2200, temperature: 0.8 },
    log
  );
  const parsed = extractJson(raw);

  const posts = {};
  const src = parsed.posts && typeof parsed.posts === 'object' ? parsed.posts : parsed;
  for (const p of targets) {
    if (p === 'youtube') {
      posts.youtubeTitle = String(src.youtubeTitle ?? '').trim();
      posts.youtubeDescription = String(src.youtubeDescription ?? '').trim();
    } else {
      posts[p] = String(src[p] ?? '').trim();
    }
  }

  const pack = {
    posts,
    hashtags: toStringList(parsed.hashtags, 20).map((h) => (h.startsWith('#') ? h : `#${h}`)),
    titles: toStringList(parsed.titles, 8),
    ctas: toStringList(parsed.ctas, 8),
    summary: String(parsed.summary ?? '').trim(),
  };
  return { pack, provider };
}
