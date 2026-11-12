import { getPlatformConfig, enabledPlatformKeys, maxAccountsPerPlatform } from '../config/index.js';
import { FacebookPublisher } from './FacebookPublisher.js';
import { InstagramPublisher } from './InstagramPublisher.js';
import { YouTubePublisher } from './YouTubePublisher.js';
import { TikTokPublisher } from './TikTokPublisher.js';
import { XPublisher } from './XPublisher.js';
import { LinkedInPublisher } from './LinkedInPublisher.js';

/**
 * Factory — maps a platform key to its concrete adapter (Strategy).
 * Adding a new platform means: write an adapter + register it here + add env.
 * Nothing else in the app needs to change.
 */
const REGISTRY = {
  facebook: FacebookPublisher,
  instagram: InstagramPublisher,
  youtube: YouTubePublisher,
  tiktok: TikTokPublisher,
  x: XPublisher,
  linkedin: LinkedInPublisher,
};

/**
 * @param {string} key e.g. "youtube"
 * @returns {import('./PlatformPublisher.js').PlatformPublisher}
 */
export function createPublisher(key) {
  const Adapter = REGISTRY[key];
  if (!Adapter) throw new Error(`No adapter registered for platform "${key}"`);
  const cfg = getPlatformConfig(key);
  if (!cfg.enabled) throw new Error(`Platform "${key}" is disabled in config.`);
  return new Adapter(key, cfg);
}

/** Describe all enabled platforms + their capabilities for the frontend. */
export function describeEnabledPlatforms() {
  const maxAccounts = maxAccountsPerPlatform(); // 0 = unlimited
  return enabledPlatformKeys().map((key) => {
    const publisher = createPublisher(key);
    return {
      key,
      capabilities: publisher.capabilities(),
      requiresTarget: publisher.requiresTarget(),
      supportsScheduling: publisher.supportsScheduling(),
      supportsAnalytics: publisher.supportsAnalytics(),
      maxAccounts,
    };
  });
}
