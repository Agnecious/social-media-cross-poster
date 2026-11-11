# Security notes & hardening checklist

This document records the security posture of the app, what's been hardened, and
what to do before/after deploying. It is a living checklist — update it as the
app evolves.

## What's in place

- **Per-customer isolation** — every customer-scoped query filters by the
  authenticated customer id (`requireCustomer` sets `req.customer`); one customer
  can't see or act on another's data.
- **Admin auth** — single admin account; bcrypt-hashed password + signed JWT
  (`ADMIN_JWT_SECRET`), constant-time compare, generic error messages.
- **OAuth tokens encrypted at rest** — customer tokens are AES-256-GCM encrypted
  (`TOKEN_STORE_KEY`) in the DB; the browser never sends/receives raw tokens for
  publishing (resolved server-side by account id).
- **Security headers** (`middleware/securityHeaders.js`) — `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a strict
  `Content-Security-Policy` (API is JSON-only), `Permissions-Policy`, and HSTS when
  served over HTTPS. `X-Powered-By` is disabled.
- **Rate limiting** (`middleware/rateLimit.js`) — the admin login is rate-limited
  per IP (fixed window, default 10 / 15 min) to blunt brute-force; returns 429 with
  `Retry-After`.
- **Request size limits** — JSON/form bodies capped at 100 kb; uploads capped at
  `MAX_UPLOAD_MB` (default 100 MB), one file per request; oversize → HTTP 413.
- **No raw error leakage** — customer-facing routes (`publish`, `platforms`) return
  generic messages and log details server-side.

## Rotate these before/at deployment

Any secret that has ever been committed, pasted into chat, or shared should be
considered compromised and rotated:

- [ ] **Supabase database password** — reset in Supabase → Project Settings →
      Database, then update `DATABASE_URL` / `DIRECT_URL`.
- [ ] **Supabase `service_role` key** — rotate in Supabase → Project Settings →
      API; update `SUPABASE_SERVICE_ROLE_KEY` (backend only — never ship to the
      frontend).
- [ ] **`ADMIN_JWT_SECRET`** — set a fresh long random value
      (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
      Rotating it invalidates existing admin sessions.
- [ ] **`ADMIN_PASSWORD_HASH`** — regenerate with
      `npm run hash-password -- "your-password"`; never store plaintext.
- [ ] **`TOKEN_STORE_KEY`** — use a long random value. Changing it makes existing
      encrypted tokens undecryptable (users reconnect).
- [ ] **Platform OAuth `*_CLIENT_SECRET`** (Facebook, Instagram, YouTube, TikTok)
      — rotate in each platform's developer portal if exposed.

> `.env` is gitignored and must never be committed. `.env.example` ships only
> placeholders — no working secrets.

## Deployment checklist

- [ ] Serve the app over **HTTPS** (HSTS only engages over HTTPS). Terminate TLS at
      nginx / the proxy; `trust proxy` is enabled so forwarded IP/scheme are honored.
- [ ] Set `FRONTEND_ORIGIN` to the real site origin (CORS).
- [ ] Register production **redirect URIs** in each platform's portal.
- [ ] Confirm the backend process can write its `.env` (the Admin config screen
      edits it) — or disable that screen if the FS is read-only.

## Known gaps (not yet implemented)

- **No payment provider** — plan changes are DB-only.
- **No Supabase Row-Level Security** — tenant isolation is enforced in application
  code (the backend uses the service-role key, which bypasses RLS). Adding RLS would
  be defense-in-depth.
- **No admin-action audit log** — config edits and plan changes aren't recorded with
  actor/timestamp.
- **No structured logging / metrics / error tracking** (e.g. pino, Sentry); logging
  is `console.*`. The health check doesn't probe the DB.
- **Rate limiting is in-process** — per instance. Behind multiple replicas, move to a
  shared store (Redis) or `express-rate-limit` with a store.
- **Dependency-based hardening deferred** — `helmet` / `express-rate-limit` were not
  added (the equivalents here are hand-rolled). Swap them in when the dependency
  install path is available.
- **Browser-tab scheduling** (Instagram/TikTok) relies on the tab staying open.
