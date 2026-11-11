import crypto from 'node:crypto';

/**
 * Shared AES-256-GCM helpers for encrypting sensitive values (OAuth tokens)
 * at rest. The key is derived from TOKEN_STORE_KEY. Encrypted output is a
 * base64 string with layout: [12-byte IV][16-byte auth tag][ciphertext].
 */

function key() {
  const secret = process.env.TOKEN_STORE_KEY;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

/** Whether encryption is configured (TOKEN_STORE_KEY present). */
export function isEncryptionConfigured() {
  return key() !== null;
}

/** Encrypt a plaintext string → base64. Throws if no key configured. */
export function encrypt(plaintext) {
  const k = key();
  if (!k) throw new Error('TOKEN_STORE_KEY is not set; cannot encrypt.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a base64 string produced by encrypt(). Returns null on failure. */
export function decrypt(b64) {
  const k = key();
  if (!k || !b64) return null;
  try {
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
