import { Injectable } from '@angular/core';

/** A single knowledge-base entry: keywords that trigger it and the answer. */
interface Intent {
  id: string;
  /** Words/phrases that indicate this intent. Matched case-insensitively. */
  keywords: string[];
  answer: string;
}

/** A suggested question shown as a quick-tap chip. */
export interface Suggestion {
  label: string;
  query: string;
}

/**
 * HelpBotService — a fully client-side, rule-based assistant.
 *
 * It answers questions about USING the app (connecting accounts, composing,
 * cross-posting, scheduling, media rules, results). It intentionally does NOT
 * help with administration/credentials — those are deflected. Nothing leaves
 * the browser; there is no AI model or API call.
 */
@Injectable({ providedIn: 'root' })
export class HelpBotService {
  /** Topics the bot refuses to cover (admin/credentials/security config). */
  private readonly adminKeywords = [
    'admin', 'administrator', 'credential', 'client secret', 'client id',
    'api key', 'password', 'jwt', 'token secret', '.env', 'env file',
    'configure platform', 'setup app', 'developer app', 'app secret',
  ];

  /** The scoped knowledge base (usage/functionality only). */
  private readonly intents: Intent[] = [
    {
      id: 'connect',
      keywords: ['connect', 'link account', 'log in', 'login', 'sign in', 'authorize', 'oauth', 'add account'],
      answer:
        'To connect a social account, open the "Connections" tab and click "Connect" next to the platform. ' +
        'A popup opens that platform\'s own login page — you sign in there and approve permissions. ' +
        'The app never sees your password, and the session token is kept only in your browser.',
    },
    {
      id: 'disconnect',
      keywords: ['disconnect', 'log out account', 'remove account', 'unlink'],
      answer:
        'In the "Connections" tab, click "Disconnect" next to a connected platform. That clears its session ' +
        'from your browser immediately (nothing was stored on a server).',
    },
    {
      id: 'crosspost',
      keywords: ['cross post', 'crosspost', 'post to all', 'multiple', 'at once', 'everywhere', 'several platforms', 'publish'],
      answer:
        'Cross-posting is on the "Compose" tab: write your text once, optionally attach media, tick every platform ' +
        'you want, and click "Publish". The app sends to all selected platforms at the same time and shows a ' +
        'per-platform result so you can see what succeeded or failed.',
    },
    {
      id: 'compose',
      keywords: ['compose', 'write', 'create post', 'new post', 'caption', 'text'],
      answer:
        'On the "Compose" tab, type your text/caption, choose a media type (text, image, or video), attach a file ' +
        'if needed, pick the platforms, then Publish. Only platforms that support your content and are connected ' +
        'can be selected.',
    },
    {
      id: 'media-rules',
      keywords: ['media', 'image', 'photo', 'video', 'file', 'upload', 'support', 'format', 'what can i post'],
      answer:
        'Each platform accepts different content:\n' +
        '• Facebook — text, image, or video.\n' +
        '• Instagram — image or video (from a public URL); no text-only posts.\n' +
        '• YouTube — video only.\n' +
        '• TikTok — video or image.\n' +
        'A platform is only selectable when it supports the media type you attached.',
    },
    {
      id: 'instagram-url',
      keywords: ['instagram url', 'public url', 'instagram image', 'instagram video', 'media url'],
      answer:
        'Instagram fetches media from a public URL rather than a direct upload. On Compose, when you pick Instagram, ' +
        'provide a publicly reachable image/video URL in the "Public media URL" field.',
    },
    {
      id: 'target',
      keywords: ['page', 'which page', 'business account', 'destination', 'facebook page', 'instagram account'],
      answer:
        'Facebook and Instagram need a specific destination. After you connect them, a dropdown appears on Compose ' +
        'to choose the Facebook Page or Instagram Business account to post to. Pick one before publishing.',
    },
    {
      id: 'schedule',
      keywords: ['schedule', 'later', 'future', 'time', 'date', 'calendar', 'automate', 'queue'],
      answer:
        'Click "Schedule Post" on Compose to pick a future date and time. Facebook and YouTube are scheduled by the ' +
        'platform itself (you can close the tab). Instagram and TikTok don\'t support API scheduling, so the app ' +
        'posts them from your browser at the chosen time — keep the tab open until they fire.',
    },
    {
      id: 'schedule-tab',
      keywords: ['tab open', 'close tab', 'browser closed', 'laptop', 'stay open'],
      answer:
        'For Facebook and YouTube, scheduled posts are held by the platform, so you can close the app. For Instagram ' +
        'and TikTok, the scheduled post fires from your browser — that tab must stay open until the scheduled time.',
    },
    {
      id: 'results',
      keywords: ['result', 'fail', 'failed', 'error', 'did it post', 'status', 'success'],
      answer:
        'After publishing, a Results panel lists each platform with success (and a link to view) or the error message. ' +
        'Platforms are independent — one can succeed while another fails, and you\'ll see exactly which.',
    },
    {
      id: 'privacy',
      keywords: ['save', 'store', 'privacy', 'data', 'secure', 'kept'],
      answer:
        'The app stores nothing: your posts and media are streamed to the platforms and not kept, and login tokens ' +
        'live only in your browser session (gone when you close the tab or disconnect).',
    },
    {
      id: 'platforms-available',
      keywords: ['which platforms', 'what platforms', 'supported networks', 'facebook instagram youtube tiktok'],
      answer:
        'The app supports Facebook, Instagram, YouTube, and TikTok. You\'ll only see the ones that have been turned ' +
        'on. If a platform is missing, it hasn\'t been enabled yet.',
    },
    {
      id: 'greeting',
      keywords: ['hi', 'hello', 'hey', 'help', 'what can you do', 'start'],
      answer:
        'Hi! I can help you use the app — connecting your social accounts, composing and cross-posting, scheduling, ' +
        'and understanding what each platform accepts. What would you like to do?',
    },
  ];

  readonly suggestions: Suggestion[] = [
    { label: 'How do I connect an account?', query: 'How do I connect an account?' },
    { label: 'Post to multiple platforms', query: 'How do I cross post to multiple platforms?' },
    { label: 'Schedule a post', query: 'How does scheduling work?' },
    { label: 'What can each platform post?', query: 'What media can each platform post?' },
  ];

  private readonly adminReply =
    'I only help with using the app — connecting accounts, composing, cross-posting, and scheduling. ' +
    'Credentials and configuration live in the Administrator area; please ask your administrator for that.';

  private readonly fallbackReply =
    "I can only help with using this app — connecting social accounts, composing, cross-posting, and scheduling. " +
    'Try asking, for example, "How do I connect an account?" or "How does scheduling work?"';

  /**
   * Answer a user message. Returns the best-matching app answer, an admin
   * deflection, or a scoped fallback for off-topic questions.
   */
  answer(message: string): string {
    const text = (message || '').toLowerCase().trim();
    if (!text) return this.fallbackReply;

    // Deflect admin/credential topics explicitly (out of scope by design).
    if (this.adminKeywords.some((k) => text.includes(k))) {
      return this.adminReply;
    }

    // Score each intent by how many of its keywords appear in the message.
    let best: { intent: Intent; score: number } | null = null;
    for (const intent of this.intents) {
      let score = 0;
      for (const kw of intent.keywords) {
        if (text.includes(kw)) score += kw.includes(' ') ? 2 : 1; // phrases weigh more
      }
      if (score > 0 && (!best || score > best.score)) best = { intent, score };
    }

    return best ? best.intent.answer : this.fallbackReply;
  }
}
