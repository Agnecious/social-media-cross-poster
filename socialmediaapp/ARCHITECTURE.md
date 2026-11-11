# Architecture & Developer Guide

This document explains **how the code works** — the structure, the data flow, and the responsibility of each part. For setup and run instructions see [README.md](./README.md).

---

> **Note (kept current):** the app has evolved from a single-tenant stateless
> tool into a **multi-tenant SaaS**. Sections §1–§10 describe the original
> single-tenant core (still accurate for the posting engine, adapters, and
> admin). The multi-tenant layer — customer auth, per-customer data isolation,
> analytics, and the database — is documented in **§12 (SaaS layer)**. Read §12
> alongside the earlier sections.

## 1. Big picture

The app is a cross-poster: write a post once and publish (or schedule) it to Facebook, Instagram, YouTube, and TikTok. Originally stateless; it now also has a multi-tenant SaaS layer (customers, database) — see §12. It has two halves:

```
┌──────────────────────────┐        HTTP / JSON        ┌───────────────────────────┐
│  frontend (Angular 22)   │  ───────────────────────► │  backend (Node/Express)   │
│  UI only. Talks to the   │  ◄─────────────────────── │  Stateless proxy to the    │
│  backend over /api/*     │                           │  social platform APIs      │
└──────────────────────────┘                           └───────────────────────────┘
                                                                    │  OAuth 2.0 + REST
                                                                    ▼
                                              Facebook · Instagram · YouTube · TikTok
```

- **Frontend** renders the UI and never holds platform secrets. It calls the backend at `/api/*`.
- **Backend** holds the app's client secrets (from `.env`), performs the OAuth token exchange, and forwards publish/schedule calls to each platform. It keeps almost nothing — the one exception is *optional* encrypted token persistence (see §7).

**Why a backend at all?** OAuth client secrets can't live in browser code, and video uploads / token exchange must be server-side. The backend is a thin, stateless proxy.

---

## 2. Directory map

```
socialmediaapp/
├── README.md                 setup & usage
├── ARCHITECTURE.md           this file
├── docker-compose.yml        one-command run (frontend + backend)
│
├── backend/                  Node/Express (ESM)
│   ├── .env / .env.example   ALL configuration (secrets, admin login, keys)
│   └── src/
│       ├── server.js         Express app: middleware + route mounting
│       ├── config/index.js   reads platform config from env (recomputed per call)
│       ├── platforms/        one adapter per platform + factory  (Strategy/Factory)
│       ├── services/         PublishService (Facade), EnvFileService, TokenStore, ...
│       ├── routes/           HTTP endpoints (auth, platforms, publish, admin, tokens)
│       ├── middleware/        requireAdmin (JWT guard)
│       └── scripts/          hash-password.js (bcrypt helper)
│
└── frontend/                 Angular 22 (standalone components, signals)
    └── src/app/
        ├── app.component.ts  shell: nav, footer, help bot; startup hydration
        ├── app.config.ts     providers (router, http + interceptor)
        ├── app.routes.ts     routes + admin guard
        ├── core/
        │   ├── models/       TypeScript interfaces
        │   ├── services/     platform, auth, publish, target, admin, admin-auth, help-bot
        │   ├── guards/       admin.guard.ts
        │   └── interceptors/ admin-auth.interceptor.ts
        └── features/
            ├── compose/      write + publish/schedule (the main screen)
            ├── connections/  connect/disconnect accounts (OAuth)
            ├── admin/        edit platform config + admin login
            └── help/         rule-based help assistant widget
```

---

## 3. Design patterns

- **Strategy / Adapter** — `PlatformPublisher` is the common contract; each platform (`FacebookPublisher`, `InstagramPublisher`, `YouTubePublisher`, `TikTokPublisher`) implements it. Platform-specific quirks stay isolated in each adapter.
- **Factory** — `PublisherFactory.createPublisher(key)` maps a platform key to its adapter, reading current config. `describeEnabledPlatforms()` tells the UI what's available.
- **Facade** — `PublishService.publishToMany()` gives the routes one call that fans out to many platforms; callers never touch adapters directly.
- **Dependency Injection** — Angular DI on the frontend; the backend passes config into adapters.

Adding a new platform = write an adapter, register it in the factory, add its env block. Nothing else changes.

---

## 4. Backend request flow

`server.js` wires everything:

```
CORS(frontendOrigin) → json/urlencoded parsers → routes → central error handler
```

Mounted routes:

| Path | File | Purpose | Protected? |
|------|------|---------|-----------|
| `/api/health` | server.js | status + enabled platforms | no |
| `/api/auth/admin/*` | adminAuth.js | admin login (issues JWT) | no (it *is* the login) |
| `/api/auth/*` | auth.js | platform OAuth start + callback | no |
| `/api/platforms` | platforms.js | list enabled platforms + capabilities; list targets | no |
| `/api/publish` | publish.js | publish/schedule a post | no |
| `/api/tokens` | tokens.js | persist/list/delete connections | no (gated by TOKEN_STORE_KEY) |
| `/api/admin/*` | admin.js | read/write platform config in `.env` | **yes — requireAdmin JWT** |

### config/index.js — live config

Platform config is **recomputed from `process.env` on every read** (`getPlatforms()`, `getPlatformConfig()`, `enabledPlatformKeys()`), not frozen at boot. That's why the Admin screen's saves take effect immediately without a restart. A platform is "enabled" only when `<PLATFORM>_ENABLED=true` **and** it has a client ID/secret.

---

## 5. OAuth & publishing (the core loop)

### Connecting an account (OAuth 2.0)

```
User clicks Connect (Connections screen)
  → frontend GET /api/auth/:platform/start   → backend returns the platform's auth URL
  → frontend opens that URL in a popup        → user logs in ON THE PLATFORM and approves
  → platform redirects to /api/auth/:platform/callback?code=...
  → backend exchanges the code for an access token (uses the client secret)
  → callback returns a tiny HTML page that postMessage()s the token to the opener window
  → frontend AuthService stores the token (in memory, and persists it if enabled)
```

The app **never sees the user's password** — that's the whole point of OAuth. Two credential types:
- **App credentials** (`client_id`/`client_secret`) — yours, in backend `.env`.
- **User token** — obtained live via the flow above, held by the browser.

### Publishing

```
Compose screen → PublishService.publish(post, platforms, options)
  → POST /api/publish (multipart: text, mediaType, file?, mediaUrl?, scheduledAt?, targets JSON)
  → publish.js writes the upload to a temp file (multer), builds a `post` object
  → PublishService.publishToMany(post, targets)   [Facade]
      → for each target: createPublisher(platform).publish(merged, auth)  [Strategy]
      → Promise.allSettled → per-platform { ok, result | error }
  → temp file deleted in finally (nothing persisted)
  → results returned to the UI
```

Each platform is independent — one can succeed while another fails, and the Results panel shows exactly which.

### Per-platform capabilities (enforced in adapters + UI)

| Platform | Text | Image | Video | Destination needed | Native scheduling |
|----------|:----:|:-----:|:-----:|:------------------:|:-----------------:|
| Facebook | ✓ | ✓ | ✓ | Page | ✓ |
| Instagram | ✗ | ✓ (public URL) | ✓ | IG Business acct | ✗ (browser fallback) |
| YouTube | ✗ | ✗ | ✓ | — | ✓ |
| TikTok | ✗ | ✓ | ✓ | — | ✗ (browser fallback) |

Instagram/YouTube/TikTok have multi-step upload flows implemented inside their adapters (e.g. Instagram's container→publish, YouTube's resumable upload, TikTok's init→upload).

---

## 6. Scheduling (Option C)

"Schedule Post" on Compose opens a future date/time picker. Behaviour differs by platform capability (`supportsScheduling()`):

- **Facebook / YouTube — native.** The backend sends a future publish time (`scheduled_publish_time`+`published=false` for FB; `privacyStatus=private`+`publishAt` for YouTube). The platform holds and publishes it; you can close the app.
- **Instagram / TikTok — browser fallback.** Their APIs can't schedule, so the frontend queues a `setTimeout` and publishes at the chosen time. **Requires the tab to stay open.** These appear in a "Queued in this browser" list with cancel buttons.

The Compose component (`scheduleBreakdown`) splits selected platforms into native vs browser and labels each in the UI.

---

## 7. State & persistence — what is (and isn't) stored

The app is deliberately lightweight: **no database.**

| Data | Where it lives | Persisted? |
|------|----------------|-----------|
| Post text / media | streamed through backend to platforms | No — temp file deleted after upload |
| App client secrets | backend `.env` | Env only (not a DB) |
| Admin login | `.env` (`ADMIN_*`, bcrypt hash) | Env only |
| Admin session | JWT in browser memory | No |
| User OAuth tokens | browser memory **+ optional** encrypted file | Only if `TOKEN_STORE_KEY` is set |

### Connection persistence (TokenStore)

If `TOKEN_STORE_KEY` is set, `TokenStore.js` saves tokens **AES-256-GCM encrypted** to `.tokens.enc` (file layout: `[12-byte IV][16-byte auth tag][ciphertext]`, key = SHA-256 of `TOKEN_STORE_KEY`). On startup `AuthService.loadPersisted()` hydrates connections; connect writes through, disconnect deletes. This is the **single deliberate exception** to "store nothing." No token refresh — a connection ends on Disconnect or when the platform's token expires.

### Multiple accounts per platform

You can connect several accounts (logins) of the same platform. Storage is keyed by platform → accountId: `{ platform: { accountId: { label, auth } } }`. After OAuth, the adapter's `identity(auth)` resolves a stable `accountId` and human `label` (e.g. the page/channel/handle). On the frontend, `AuthService` holds `ConnectedAccount[]` per platform; Connections lists each with its own Disconnect and a "Connect another account"; Compose selects specific accounts (keyed `platform::accountId`) and each publish target carries that account's own token and destination. Destinations (Facebook Pages / IG accounts) are fetched and selected per account.

If `TOKEN_STORE_KEY` is blank, the `/api/tokens` endpoints are no-ops and tokens stay session-only.

---

## 8. Administrator area & security

- **Login** — `POST /api/auth/admin/login` verifies `ADMIN_USERNAME` + bcrypt-hashed `ADMIN_PASSWORD_HASH`, returns a JWT signed with `ADMIN_JWT_SECRET` (expires per `ADMIN_TOKEN_TTL`).
- **Guard (backend)** — `requireAdmin` middleware validates the `Bearer` JWT on all `/api/admin/*` routes (401 otherwise).
- **Guard (frontend)** — `admin.guard.ts` redirects `/admin` to the login screen unless authenticated; `admin-auth.interceptor.ts` attaches the token to admin calls and logs out on a 401.
- **Config editing** — `admin.js` reads/writes the `.env` file via `EnvFileService` (preserves comments, atomic write). Secrets are returned **masked** (`••••1234`); a blank secret field means "keep current."

The admin JWT is held in memory only. Credentials live in `.env`, not a database (single-admin by design).

---

## 9. Help assistant

`help-bot.service.ts` is a **rule-based, fully client-side** assistant — no AI model, no API key, nothing leaves the browser. It scores the user's message against an `intents` array (keywords → answer). It's scoped to *using* the app; admin/credential questions are deflected, and off-topic questions get a scoped fallback. The floating widget lives in `features/help/` and is mounted in the app shell. Extend it by adding entries to `intents`.

---

## 10. How to extend

- **New platform:** create `XPublisher.js` implementing `PlatformPublisher` (`getAuthUrl`, `exchangeCode`, `publish`, `capabilities`, and optionally `listTargets`/`requiresTarget`/`supportsScheduling`), register it in `PublisherFactory`, add its `X_*` env block. The UI and publish/schedule flows pick it up automatically.
- **New help answer:** add an entry to `intents` in `help-bot.service.ts`.
- **Token refresh (future):** add refresh handling in each adapter + a scheduled renew; would remove the "expires" caveat in §7.
- **Multi-account per platform (future):** change `AuthService`/`TokenStore` from `{ platform: token }` to `{ platform: [ {accountId, label, token} ] }` and expand the connect/compose selection model.

---

## 11. Tech stack

- **Frontend:** Angular 22 (standalone components, signals, new control flow `@if`/`@for`), TypeScript 6, built with `@angular/build`, served by nginx in Docker.
- **Backend:** Node ≥18 (tested on v24), Express, ESM. `axios` (HTTP), `multer` (uploads), `form-data`, `dotenv`, `bcryptjs` + `jsonwebtoken` (admin auth), Node `crypto` (token encryption). **Plus the SaaS layer (§12):** Prisma + Supabase (PostgreSQL + Auth).

---

## 12. Multi-tenant SaaS layer (current)

The app now supports self-service **customers** who sign up, log in, and are fully isolated from one another. This layer sits alongside the original posting engine.

### Database & auth
- **Supabase** provides managed **PostgreSQL** + **Auth** (email/password). Same Supabase project used for dev now; a separate prod project later. Connection via `DATABASE_URL` (pooled, 6543, `pgbouncer=true`) and `DIRECT_URL` (pooler session mode, 5432) — the direct `db.*.supabase.co` host is unreachable on the corporate network, so both use the pooler host.
- **Prisma** is the ORM. Schema at `backend/prisma/schema.prisma`. Apply changes with `npm run db:push`.
- **Customer auth = Supabase Auth** (frontend `CustomerAuthService` wraps `@supabase/supabase-js`). The backend verifies the Supabase JWT via `SupabaseService` (service_role key) in `requireCustomer` middleware, which also auto-provisions a `Customer` row on first authenticated request and attaches `req.customer`.

### Data model (Prisma)
- `Customer` (`id` = Supabase auth user id, email, plan, planStatus)
- `ConnectedAccount` (per customer; platform, accountId, label, `authEnc` = AES-encrypted token, scopes) — **replaces the global `.tokens.enc` for customer flows**
- `Post` (activity/history: platform, accountId, text, mediaType, scheduledAt, status, resultUrl, error)
- `AnalyticsSnapshot` (cached metrics: metric, value, periodStart/End)
- `UsageEvent` (built-in traffic counter: type = pageview/login/publish/...)

### Per-customer isolation (the security core)
Every customer-scoped route uses `requireCustomer` and filters by `req.customer.id`:
- `GET/PUT/DELETE /api/tokens/...` → connected accounts (via `AccountService`, DB-backed, encrypted, enforces per-customer `MAX_ACCOUNTS_PER_PLATFORM`).
- `POST /api/platforms/:platform/targets` → resolves the account token **server-side by accountId** (browser never sends tokens).
- `POST /api/publish` → targets are `[{platform, accountId, label, options}]`; tokens resolved server-side; each result logged to `Post`.
- `GET /api/analytics/:platform/:accountId` → §12 analytics.
- Frontend `customer-auth.interceptor` attaches the Supabase token to `/api/customer`, `/api/tokens`, `/api/publish`, `/api/analytics`, and `/api/platforms/:p/targets`.
- `crypto.js` provides shared AES-256-GCM encrypt/decrypt (key = SHA-256 of `TOKEN_STORE_KEY`) used by `AccountService`.

**Isolation is enforced two ways:** backend queries filtered by `customerId`, and the frontend clears in-memory accounts on sign-out (`AuthService.clearAll`) and reloads them only once Supabase confirms the session (`CustomerAuthService.authReady`, avoiding a refresh race).

### Analytics (§ feature)
- Each adapter has `supportsAnalytics()` + `analytics(auth, { days, target })`. Days clamped 7–90.
- **Facebook** (real): Page insights, requested **one metric at a time** and skipping any the API rejects (Meta deprecates metrics per version) — needs `read_insights` scope + a Page target.
- **Instagram** (real): IG Business insights — needs `instagram_manage_insights` + IG target.
- **YouTube** (real): YouTube Analytics API — needs `yt-analytics.readonly`.
- **TikTok**: not supported (gated API) — returns a clear note.
- Route caches results in `AnalyticsSnapshot`. Frontend `AnalyticsComponent` (`/analytics`): period selector (7/14/30/90), per-account cards, destination picker, metric tiles.
- **Analytics needs extra OAuth scopes** — existing connections must reconnect to grant them.

### Admin vs customer
Two separate auth systems: the original **Administrator** (`.env` creds + own JWT, manages platform config) and **customers** (Supabase Auth). Different roles, different guards.

### Notes / gotchas
- Corporate SSL inspection blocks npm and Node HTTPS unless `NODE_EXTRA_CA_CERTS` / npm `cafile` point at the company CA (see README/troubleshooting). Same may affect runtime HTTPS to Supabase/platforms.
- The legacy global `TokenStore` (`.tokens.enc`) and its old `/api/tokens` behaviour are superseded by `AccountService` for customer flows — candidate for cleanup.
- Secrets pasted during setup (Supabase DB password, service_role key, Facebook app secret) should be **rotated** before production.
