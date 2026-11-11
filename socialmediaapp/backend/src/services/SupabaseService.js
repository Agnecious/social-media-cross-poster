import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import { http } from './http.js';

/**
 * Supabase admin client (backend only) — uses the SERVICE ROLE key, which
 * bypasses Row-Level Security. NEVER expose this to the frontend.
 *
 * Used to verify a customer's access token (issued by Supabase Auth on the
 * frontend) and resolve the authenticated user.
 */
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  url && serviceKey
    ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

/** Whether Supabase is configured (keys present). */
export function isSupabaseConfigured() {
  return supabaseAdmin !== null;
}

/**
 * Probe whether the backend can actually REACH the Supabase Auth server — the
 * same network path customer token-verification uses. This catches egress /
 * SSL-inspection blocks that leave the keys present but all customer logins
 * failing (status 0 / "fetch failed").
 *
 * We hit the Auth health endpoint; we don't care about the body, only whether
 * the connection completes. A completed request (any HTTP status, even 4xx)
 * means the network is fine. A thrown connection error means it's blocked.
 *
 * @returns {Promise<{ configured: boolean, reachable: boolean|null, reason?: string, latencyMs?: number }>}
 */
export async function checkSupabaseReachable() {
  if (!url) return { configured: false, reachable: null };

  const t0 = Date.now();
  try {
    // GET /auth/v1/health — a cheap, auth-endpoint reachability ping. Any
    // response (200/401/404) proves we reached Supabase. validateStatus:true
    // so even a non-2xx is treated as "reachable" (we only want connectivity).
    await http.get(`${url}/auth/v1/health`, {
      headers: { apikey: serviceKey || '' },
      validateStatus: () => true,
    });
    return { configured: true, reachable: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    const code = err?.code || err?.cause?.code;
    const msg = err?.message || String(err);
    logger.warn('checkSupabaseReachable: Supabase Auth unreachable', { code, reason: msg });
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - t0,
      reason: code || (/fetch failed/i.test(msg) ? 'fetch failed' : msg),
    };
  }
}

/**
 * Verify a Supabase access token and return the user, or null if invalid.
 * @param {string} accessToken JWT from the frontend Supabase session
 */
export async function getUserFromToken(accessToken) {
  if (!supabaseAdmin || !accessToken) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data?.user) {
      // Surface WHY verification failed. Distinguishes:
      //  - network/egress blocked ("fetch failed" / ETIMEDOUT / ENOTFOUND)
      //  - bad token / wrong project ("invalid JWT" / signature / expired)
      logger.warn('getUserFromToken: Supabase rejected the token', {
        reason: error?.message || 'no user returned',
        status: error?.status,
        name: error?.name,
      });
      return null;
    }
    return data.user;
  } catch (err) {
    // A thrown error here is almost always the backend being unable to REACH
    // Supabase (network/egress), not a bad token.
    logger.error('getUserFromToken: call to Supabase threw (likely unreachable)', {
      reason: err?.message,
      cause: err?.cause?.code || err?.cause?.message,
    });
    return null;
  }
}

/**
 * Raise a readable error when a Supabase admin call can't reach the Auth server
 * (the same egress block that affects token verification on restricted
 * networks). Keeps the "corrupted user?" confusion away — it's the network.
 */
function describeAdminError(err) {
  const msg = err?.message || String(err);
  if (/fetch failed/i.test(msg) || err?.name === 'AuthRetryableFetchError') {
    return new Error(
      'Could not reach Supabase Auth (network/egress block). User management ' +
        'needs the backend to reach *.supabase.co — try an unrestricted network.'
    );
  }
  return new Error(msg);
}

/**
 * Create a Supabase Auth user (the login identity). Email is auto-confirmed so
 * the person can sign in immediately. Profile fields are stored as user
 * metadata (mirrored into the Customer row on first authenticated request).
 *
 * @returns {Promise<{ id: string, email: string }>}
 * @throws if Supabase isn't configured or is unreachable, or the email exists.
 */
export async function createAuthUser(email, password, metadata = {}) {
  if (!supabaseAdmin) throw new Error('Supabase is not configured.');
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        firstName: metadata.firstName ?? null,
        lastName: metadata.lastName ?? null,
        phone: metadata.phone ?? null,
      },
    });
    if (error) throw error;
    if (!data?.user?.id) throw new Error('Supabase did not return a user.');
    return { id: data.user.id, email: data.user.email ?? email };
  } catch (err) {
    logger.error('createAuthUser failed', { reason: err?.message, name: err?.name });
    throw describeAdminError(err);
  }
}

/**
 * Delete a Supabase Auth user by id. Best-effort: a "user not found" is treated
 * as success (already gone), so the caller can still clean up the local row.
 */
export async function deleteAuthUser(userId) {
  if (!supabaseAdmin) throw new Error('Supabase is not configured.');
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message || '')) throw error;
    return { ok: true };
  } catch (err) {
    logger.error('deleteAuthUser failed', { reason: err?.message, name: err?.name });
    throw describeAdminError(err);
  }
}
