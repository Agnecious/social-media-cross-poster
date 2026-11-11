/**
 * logger — a tiny, dependency-free structured logger.
 *
 * Emits one JSON object per line to stdout (stderr for error level), which is
 * the standard for container/log-aggregation setups (Docker, journald, cloud
 * log collectors). No dependency, no file handling — the process's stdout IS
 * the log; redirect it where you want (e.g. `npm start > app.log 2>&1`, or let
 * Docker/your platform capture it).
 *
 * Level is controlled by LOG_LEVEL (error | warn | info | debug). Default info.
 * Each call takes a short message and an optional context object; a child
 * logger can carry bound fields (e.g. a request id) onto every line.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function activeLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  return raw in LEVELS ? raw : 'info';
}

/** Reduce an Error (or anything) to a safe, serialisable summary. */
function describeError(err) {
  if (err == null) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      // Axios-style upstream payloads are useful but can be large/sensitive —
      // include status + a trimmed body only.
      status: err.response?.status,
      data: err.response?.data ? trim(err.response.data) : undefined,
      stack: err.stack,
    };
  }
  return { message: String(err) };
}

function trim(v) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 2000 ? s.slice(0, 2000) + '…(truncated)' : s;
  } catch {
    return '[unserialisable]';
  }
}

function emit(level, bound, message, context) {
  if (LEVELS[level] > LEVELS[activeLevel()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...bound,
    ...(context && typeof context === 'object' ? context : context != null ? { detail: context } : {}),
  };
  // error/warn → stderr, else stdout.
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  try {
    out.write(JSON.stringify(line) + '\n');
  } catch {
    out.write(`{"ts":"${line.ts}","level":"${level}","msg":"log-serialise-failed"}\n`);
  }
}

function make(bound = {}) {
  return {
    error: (msg, ctx) => emit('error', bound, msg, ctx),
    warn: (msg, ctx) => emit('warn', bound, msg, ctx),
    info: (msg, ctx) => emit('info', bound, msg, ctx),
    debug: (msg, ctx) => emit('debug', bound, msg, ctx),
    /** Create a child logger that adds `fields` to every line. */
    child: (fields) => make({ ...bound, ...fields }),
  };
}

export const logger = make();

/** Normalise an unknown error for logging. Exported for route catch blocks. */
export function errInfo(err) {
  return describeError(err);
}
