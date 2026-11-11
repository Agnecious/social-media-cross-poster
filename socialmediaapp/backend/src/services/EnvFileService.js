import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env lives at the backend root (two levels up from src/services).
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

/**
 * EnvFileService — reads and updates the backend `.env` file.
 *
 * `.env` remains the single source of truth for configuration. This service
 * lets the Administrator UI change values without hand-editing the file. It
 * preserves comments, blank lines, and any keys it doesn't manage.
 *
 * There is no database — this simply manages the config file you already have.
 */
export class EnvFileService {
  constructor(envPath = ENV_PATH) {
    this.envPath = envPath;
  }

  /** @returns {boolean} whether the .env file exists yet */
  exists() {
    return fs.existsSync(this.envPath);
  }

  /**
   * Parse .env into an ordered list of lines so we can rewrite it while keeping
   * comments and formatting intact.
   * @returns {Array<{ raw: string, key?: string, value?: string }>}
   */
  readLines() {
    if (!this.exists()) return [];
    const content = fs.readFileSync(this.envPath, 'utf8');
    return content.split(/\r?\n/).map((raw) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) return { raw };
      const eq = raw.indexOf('=');
      if (eq === -1) return { raw };
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1);
      return { raw, key, value };
    });
  }

  /** @returns {Record<string,string>} flat key/value map of current values */
  readValues() {
    const values = {};
    for (const line of this.readLines()) {
      if (line.key) values[line.key] = line.value ?? '';
    }
    return values;
  }

  /**
   * Update (or add) the given key/value pairs and write the file back.
   * Updates existing lines in place; appends any new keys at the end.
   * Also updates process.env so the change is live immediately.
   *
   * @param {Record<string,string>} updates
   */
  update(updates) {
    const lines = this.readLines();
    const remaining = { ...updates };

    const rewritten = lines.map((line) => {
      if (line.key && Object.prototype.hasOwnProperty.call(remaining, line.key)) {
        const newValue = remaining[line.key];
        delete remaining[line.key];
        return { raw: `${line.key}=${newValue}`, key: line.key, value: newValue };
      }
      return line;
    });

    // Append keys that weren't already present.
    for (const [key, value] of Object.entries(remaining)) {
      rewritten.push({ raw: `${key}=${value}`, key, value });
    }

    const output = rewritten.map((l) => l.raw).join('\n');
    // Write atomically: write to a temp file then rename over the original.
    const tmp = `${this.envPath}.tmp`;
    fs.writeFileSync(tmp, output.endsWith('\n') ? output : output + '\n', 'utf8');
    fs.renameSync(tmp, this.envPath);

    // Reflect changes into the running process immediately.
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }
  }
}

export const envFileService = new EnvFileService();
