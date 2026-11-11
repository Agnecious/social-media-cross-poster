import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Encrypted token file lives at the backend root (two levels up from src/services).
const STORE_PATH = path.resolve(__dirname, '..', '..', '.tokens.enc');

/**
 * TokenStore — persists OAuth tokens ENCRYPTED AT REST so connections survive
 * restarts (Option 1). This is the app's single, deliberate exception to
 * "store nothing": only auth tokens are kept, AES-256-GCM encrypted with a key
 * from TOKEN_STORE_KEY. There is no database — it's one small local file.
 *
 * Shape on disk (after decryption): { [platform]: { accessToken, meta } }.
 *
 * NOTE: there is no token refresh (Option 2 was not chosen), so a connection
 * ends when the user disconnects OR when the platform's token expires.
 */
class TokenStore {
  constructor(storePath = STORE_PATH) {
    this.storePath = storePath;
  }

  /** Derive a 32-byte key from TOKEN_STORE_KEY. Returns null if not configured. */
  #key() {
    const secret = process.env.TOKEN_STORE_KEY;
    if (!secret) return null;
    return crypto.createHash('sha256').update(secret).digest();
  }

  /** Whether persistence is configured (key present). */
  isEnabled() {
    return this.#key() !== null;
  }

  /** Read + decrypt the whole store. Returns {} if missing/unreadable. */
  #readAll() {
    const key = this.#key();
    if (!key || !fs.existsSync(this.storePath)) return {};
    try {
      const raw = fs.readFileSync(this.storePath);
      // Layout: [12-byte IV][16-byte auth tag][ciphertext]
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const data = raw.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      // Corrupt/tampered/wrong key — fail closed to an empty store.
      return {};
    }
  }

  /** Encrypt + write the whole store atomically. */
  #writeAll(obj) {
    const key = this.#key();
    if (!key) throw new Error('TOKEN_STORE_KEY is not set; cannot persist tokens.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([iv, tag, ciphertext]);
    const tmp = `${this.storePath}.tmp`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, this.storePath);
  }

  /**
   * @returns {object} the full store as { platform: { accountId: { label, auth } } }
   */
  all() {
    return this.#readAll();
  }

  /** Add/replace one account for a platform. */
  addAccount(platform, accountId, label, auth) {
    const all = this.#readAll();
    if (!all[platform]) all[platform] = {};
    all[platform][accountId] = { label, auth };
    this.#writeAll(all);
  }

  /** Remove one account from a platform (used by per-account Disconnect). */
  removeAccount(platform, accountId) {
    const all = this.#readAll();
    if (all[platform] && accountId in all[platform]) {
      delete all[platform][accountId];
      if (Object.keys(all[platform]).length === 0) delete all[platform];
      this.#writeAll(all);
    }
  }
}

export const tokenStore = new TokenStore();
