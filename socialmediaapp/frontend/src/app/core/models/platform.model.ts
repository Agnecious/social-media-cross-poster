/** What a platform can accept. Drives which compose options are shown. */
export interface PlatformCapabilities {
  text: boolean;
  image: boolean;
  video: boolean;
}

/** A platform as described by the backend (only enabled ones are returned). */
export interface PlatformInfo {
  key: string; // e.g. "facebook"
  capabilities: PlatformCapabilities;
  /** True if the user must pick a destination (Facebook Page, IG account). */
  requiresTarget: boolean;
  /** True if the platform's API can schedule a post for a future time. */
  supportsScheduling: boolean;
  /** True if the platform's API can return analytics/insights. */
  supportsAnalytics: boolean;
  /** Max accounts connectable for this platform (0 = unlimited). */
  maxAccounts: number;
}

/**
 * A concrete publishing destination for a platform — a Facebook Page or an
 * Instagram Business account. `extra` carries platform-specific data (e.g. a
 * Page access token) that is passed straight through to publish.
 */
export interface PlatformTarget {
  id: string;
  name: string;
  extra?: Record<string, unknown>;
}

/** The media a user attached to a post. */
export type MediaType = 'none' | 'image' | 'video';

/** OAuth result held for a connected account. */
export interface PlatformAuth {
  accessToken: string;
  meta?: Record<string, unknown>;
}

/**
 * One connected account (login) for a platform. Multiple accounts of the same
 * platform can be connected — each has a stable id, a human label, and its own
 * OAuth token.
 */
export interface ConnectedAccount {
  platform: string;
  accountId: string;
  label: string;
  auth: PlatformAuth;
}

/** The composed post, before it is sent to selected platforms. */
export interface ComposedPost {
  text: string;
  mediaType: MediaType;
  file?: File | null;
  mediaUrl?: string; // public URL, required for Instagram
  /** ISO timestamp to schedule for; omitted/undefined means publish now. */
  scheduledAt?: string;
}

/** Result of publishing to a single connected account. */
export interface PublishResult {
  platform: string;
  accountId?: string;
  label?: string;
  ok: boolean;
  result?: { id: string; url: string };
  error?: string;
}
