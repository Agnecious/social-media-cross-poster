# Social Cross-Poster

A multi-tenant SaaS for **composing a post once and publishing (or scheduling) it to Facebook, Instagram, YouTube, and TikTok**. Customers sign up, connect their own social accounts via OAuth, and cross-post from a single UI. The app ships with self-service subscription tiers (a free trial, upgrade/downgrade), per-platform analytics, an owner/admin dashboard, and a configurable light/dark theme.

- **Frontend:** Angular 22 (standalone components + signals)
- **Backend:** Node.js / Express (ESM) — a stateless proxy to the social-platform APIs
- **Data:** Supabase (PostgreSQL + Auth) via Prisma
- **Per-customer isolation:** every customer sees and controls only their own accounts, posts, and analytics

> **How the code works:** see [ARCHITECTURE.md](./ARCHITECTURE.md) (structure, data flow, design patterns, how to extend).
> **Configuration reference:** see [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) (every `.env` setting, defaults, and when it takes effect).
> **SaaS build plan & progress log:** see [docs/MULTI_TENANT_PLAN.md](./docs/MULTI_TENANT_PLAN.md).

---

## What the app does

### Cross-posting
Write text, attach an image or video, pick which connected account(s) to post to, and publish to all of them at once. The backend fans out to each platform's API in parallel and returns a per-platform result. Uploaded media is streamed straight through and deleted immediately — never stored.

| Platform | Text | Image | Video | Notes |
|----------|:----:|:-----:|:-----:|-------|
| Facebook | ✅ | ✅ | ✅ | Posts to a **Page** you manage — not a personal profile (Meta policy) |
| Instagram | ❌ | ✅ | ✅ | **Business/Creator** account linked to a Page; media served from a **public URL** |
| YouTube | ❌ | ❌ | ✅ | Posts to your channel; video only (resumable upload) |
| TikTok | ❌ | ✅ | ✅ | Posts to the authenticated account; requires app review before production |

The UI reads these capabilities from the backend and only lets you select a platform that supports your attached media type and is connected.

> **Facebook & Instagram post to Pages/Business accounts, not personal profiles.** This is a Meta platform restriction, not a limitation of this app — Facebook removed third-party publishing to personal timelines years ago (the old `publish_actions` permission). To publish, a user needs a Facebook **Page** (free — [create one here](https://www.facebook.com/pages/create)); Instagram needs a **Business or Creator** account linked to a Page. If a connected account has no Page, Connections and Compose show guidance explaining this. Every cross-posting tool (Buffer, Hootsuite, etc.) works the same way for the same reason.

### AI Content Assistant
Turn one idea into platform-ready content in seconds. From the **AI Assistant** screen (`/ai`), customers get five tools: **generate platform content** (Facebook / Instagram / LinkedIn / TikTok / YouTube title + description + hashtags), **rewrite** in seven tones (professional, casual, corporate, sales, educational, funny, motivational), a **hashtag generator** (10–20 relevant tags), a **title generator**, and **translation** that preserves meaning and tone. Results render as copy-able cards.

Two AI providers sit behind a **primary → fallback** chain — **Google Gemini** first, **OpenRouter** if Gemini is unconfigured or fails — using the same Strategy/Factory pattern as the platform publishers and billing providers. The feature is off by default and only becomes available when `AI_ENABLED=true` and at least one provider key is set; the UI hides it otherwise. Full details, API and config in **[docs/AI_ASSISTANT.md](./docs/AI_ASSISTANT.md)**.

### Connections (OAuth, multi-account)
None of these platforms allow posting with a raw username/password — they all use **OAuth 2.0**: you log in on the platform's own site, approve permissions, and the app receives a short-lived **access token**. You can connect **multiple accounts per platform**; how many is governed by your subscription plan (see Feature gating).

### How OAuth credentials work (and where tokens are stored)

There are **two different kinds of credentials**, and it's important not to confuse them:

| | App credentials (`client_id` / `client_secret`) | Access token |
|---|---|---|
| Identifies | **Your application** ("Social Cross-Poster") | **One customer's** authorization of one account |
| Owned by | You, the operator | Each customer, individually |
| Shared across all customers? | **Yes — one pair for everyone** | **No — one per connected account** |
| Lives in | Backend `.env` (global), editable via the Admin screen | **Database, encrypted, scoped to the customer** |
| Can it post to an account by itself? | **No** — it can only *start* an OAuth login | Yes — it's what actually authorizes posting |

**The app credentials are safe to share across all tenants.** The `client_id`/`client_secret` identify *your app* to the platform — they are not a login and grant no access to any account on their own. Every customer connects through the same registered app (this is exactly how Buffer, Hootsuite, Zapier, etc. work). You register **one** developer app per platform; customers never see or need the `client_secret`.

**What makes it per-customer and private is the access token**, which only exists after a customer personally logs in on the platform and approves. Here is the full flow and where the token ends up:

```
Customer clicks "Connect Facebook"
      │
      ▼  (uses YOUR global client_id — identifies the app, not a user)
Facebook login + consent  ── THE CUSTOMER logs in with their own account/2FA
      │
      ▼  redirect to  GET /api/auth/facebook/callback?code=...
Backend exchanges the code for an ACCESS TOKEN (server-side; secret never leaves the backend)
      │
      ▼  token handed to the browser via a one-time postMessage bridge, which then
PUT /api/tokens/:platform/:accountId   ── the browser asks the backend to persist it
      │
      ▼
Stored in Postgres: connected_accounts.auth_enc  (AES-256-GCM encrypted, keyed by customerId)
```

So a Facebook (or TikTok/Instagram/YouTube) access token is **stored encrypted at rest in the database** — one row per connected account in the `connected_accounts` table, in the `auth_enc` column, scoped to the owning customer's id. Key points:

- **Encrypted** with AES-256-GCM (`TOKEN_STORE_KEY`) via `services/crypto.js`; never stored in plaintext.
- **Isolated per customer** — every read is filtered by `customerId`; one customer can never see or use another's tokens.
- **Never re-exposed for publishing** — when you post, the backend looks up the token by `(customerId, platform, accountId)` and decrypts it server-side; the browser never receives the raw token to publish with.
- **Tokens, not passwords** — the app never sees your platform password; a token can be revoked any time (Disconnect, or in the platform's own settings).

> **Bring-your-own app (not implemented):** if you ever need white-labeled consent screens or per-customer platform rate limits, the app credentials would move into a per-customer encrypted table too. That's a deliberate future option, not the current model — today one shared app registration serves all customers, which is the standard SaaS approach.

### Scheduling
Alongside **Publish**, a **Schedule Post** button lets you pick a future time. Behaviour is per platform:

| Platform | Scheduling | How |
|----------|-----------|-----|
| Facebook | Native | Sent with `scheduled_publish_time`; the platform holds and publishes it. Works with the browser closed. |
| YouTube | Native | Uploaded as `private` with a `publishAt` time. Works with the browser closed. |
| Instagram | Browser fallback | Posted from your browser at the chosen time. **Tab must stay open.** |
| TikTok | Browser fallback | Same as Instagram — **tab must stay open.** |

### Subscriptions, trial & feature gating
- **No free tier.** Tiers are **Starter / Pro / Agency**; prices (ZAR) and limits live in **one configurable place** (`backend/src/config/plans.js` + env), served to the UI via `GET /api/plans`.
- **Trial model (when billing is enabled):** new signups must **choose a plan and add billing** before any access. That starts a trial capped at **`TRIAL_MAX_POSTS` (default 1)** successful cross-posts (one compose → fan-out = one), after which paying converts them to full access.
- **Billing (Layer 1):** provider-agnostic (`BillingProvider` strategy) with a **mock provider** for testing (no real money) and a **Peach Payments** adapter stub for later. The app never touches card data — a provider hosts payment and reports back via signed, idempotent webhooks that drive the subscription state (`pending_setup → trialing → active | past_due | canceled`). Controlled by `BILLING_ENABLED` (**off by default**) / `BILLING_PROVIDER`. See [docs/TESTING_BILLING.md](./docs/TESTING_BILLING.md).
- **Enforced gating:**
  - **Per-plan account caps** — accounts per platform follow your plan (`PLAN_STARTER_MAX_ACCOUNTS` / `PLAN_PRO_MAX_ACCOUNTS` / `PLAN_AGENCY_MAX_ACCOUNTS`; `0` = unlimited, deferring to a global ceiling).
  - **Billing-state gate** — `pending_setup`, expired trial, `past_due` and `canceled` all block connecting/publishing (402) with a prompt to the **/billing** screen; a trialing customer is blocked after the post cap.
- Customers manage their plan on the **Plan/Billing** screen; the pricing section on the landing page reads the same catalogue.

### Analytics
Per-connected-account insights over a selectable window (7–90 days), using each platform's own insights APIs. Facebook is fully wired; Instagram/YouTube supported (require their analytics scopes + reconnect); TikTok is not supported.

### Admin
A separate, password-protected **Administrator** area:
- **Platform config** — toggle each platform on/off and edit its OAuth credentials from the UI (writes to `.env`).
- **Dashboard** — business metrics: total/active/new customers, plan breakdown, website traffic, and a customer table with inline plan management (shows each customer's name, email, phone).

### Theme
The whole app (including the landing page) renders in a single, backend-configured theme — set `APP_THEME=light|dark` in the backend `.env` and restart; the frontend applies it at startup. No per-user toggle.

### Help assistant
A floating, rule-based help bubble (client-side, no AI/API) answers end-user questions about using the app. Scoped to usage only; admin/credential questions are deflected.

---

## Tech stack

| | |
|---|---|
| Frontend | Angular 22, standalone components, signals, Angular Router |
| Backend | Node.js ≥ 18, Express 4 (ESM), Multer (uploads), Axios |
| Database | Supabase PostgreSQL via Prisma 5 |
| Auth | Supabase Auth (customers, JWT) · bcrypt + JWT (admin) |
| Secrets | OAuth tokens AES-256-GCM encrypted at rest (per-customer, in DB) |

---

## Prerequisites

- **Node.js 18 or newer** (`node --version`) — includes `npm`.
- A **Supabase** project (free tier works) for the database + customer auth.

---

## Setup

### 1. Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
# edit .env: Supabase keys, admin login, and the platform credentials you want
npm run db:push          # create the database tables from the Prisma schema
npm run dev
```

The server starts on `http://localhost:3000` and prints which platforms are enabled.

### 2. Frontend

```powershell
cd frontend
npm install
npm start
```

Open `http://localhost:4200`.

> The frontend's `src/environments/environment.ts` holds the API base URL and the Supabase **anon** key (safe to expose). The Supabase **service_role** key stays backend-only.

---

## Configuration (`backend/.env`)

See [`.env.example`](./backend/.env.example) for the full, commented list. Key groups:

**Server**
```
PORT=3000
FRONTEND_ORIGIN=http://localhost:4200     # CORS origin AND the origin OAuth posts back to
LOG_LEVEL=info                            # error | warn | info | debug
MAX_ACCOUNTS_PER_PLATFORM=5               # global ceiling (0 = unlimited)
MAX_UPLOAD_MB=100                         # per-file upload cap
APP_THEME=light                           # light | dark (whole-app theme)
```

**Supabase (database + customer auth)**
```
DATABASE_URL=        # pooled connection (port 6543, ?pgbouncer=true) — used by the app
DIRECT_URL=          # direct/session connection (port 5432) — used by Prisma migrations
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # SECRET — backend only
```

**Subscription plans** (prices in ZAR; all configurable with no rebuild)
```
PLAN_STARTER_PRICE_ZAR=169     PLAN_PRO_PRICE_ZAR=529     PLAN_AGENCY_PRICE_ZAR=1399
PLAN_STARTER_MAX_ACCOUNTS=1    PLAN_PRO_MAX_ACCOUNTS=5    PLAN_AGENCY_MAX_ACCOUNTS=0
TRIAL_DAYS=30
```

**Administrator login** (protects the Admin area)
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt hash — never plaintext>
ADMIN_JWT_SECRET=<a long random string>
ADMIN_TOKEN_TTL=8h
```
Generate the hash: `npm run hash-password -- "your-password"`, then paste it into `ADMIN_PASSWORD_HASH`.

**Per-platform OAuth** — one block each for Facebook, Instagram, YouTube, TikTok. A platform appears in the UI only when it is **enabled AND has credentials**:
```
FACEBOOK_ENABLED=true
FACEBOOK_CLIENT_ID=your_app_id
FACEBOOK_CLIENT_SECRET=your_app_secret
FACEBOOK_REDIRECT_URI=http://localhost:3000/api/auth/facebook/callback
FACEBOOK_SCOPES=pages_manage_posts,pages_read_engagement,pages_show_list,read_insights
FACEBOOK_API_VERSION=v21.0
```

> Most plan, theme, and platform settings are read on demand, so changes take effect on the next request. Supabase keys and the server port are read at boot — restart after changing those.

### Logs & debugging

The backend emits **structured JSON logs** (one object per line) to stdout/stderr — no setup or dependency needed. Each line has `ts`, `level`, `msg`, and context. Every request is logged with a `reqId` (also returned to the browser as the `X-Request-Id` response header), its method/path/status/duration, and the acting `customerId`/`admin` when known. Unhandled errors and OAuth failures are logged with detail (while the browser only gets a generic message).

Control verbosity with `LOG_LEVEL` (`error` | `warn` | `info` | `debug`; default `info`). To capture logs to a file:

```powershell
# dev
cd backend; node src/server.js *> app.log          # PowerShell: *> captures all streams
# or with npm
npm start 2>&1 | Tee-Object app.log
```

In Docker, logs go to the container's stdout — view with `docker compose logs -f backend`.

Example line:
```json
{"ts":"2026-10-05T12:00:00.000Z","level":"info","msg":"oauth start","reqId":"a1b2c3","platform":"facebook","redirectUri":"http://localhost:3000/api/auth/facebook/callback"}
```

**Debugging a failed "Connect":** watch the log while clicking Connect. You'll see `oauth start` (with the redirect URI), then on return `oauth callback ok` or an `oauth callback: token exchange failed` with the platform's reason. If the popup goes blank and you see `oauth callback ok` but the UI doesn't update, check that `postMessageOrigin` in that log line matches the origin you have the app open on (`FRONTEND_ORIGIN`) — a mismatch makes the browser silently drop the result.

### Health & monitoring

The backend exposes two probes for uptime checks / orchestrators:

- **`GET /api/health`** — liveness. Always 200 while the process is responsive; returns `{ status, version, uptimeSeconds, timestamp, enabledPlatforms }`. Cheap — no dependency checks.
- **`GET /api/ready`** — readiness. Pings the database and reports Supabase config; returns **200** when ready, **503** when not. Point your load balancer / k8s readiness probe here.

The owner can also see a **System status** panel on the Admin Dashboard (DB up/down + latency, Supabase, uptime, version, memory), backed by `GET /api/admin/health`.

Set `APP_VERSION` (e.g. a git tag) to surface a meaningful version in these. For external error tracking, set `SENTRY_DSN` and wire `@sentry/node` in `services/monitoring.js` (`captureException` is already the single funnel for all captured errors); without it, exceptions are just logged.

See [docs/TESTING_MONITORING.md](./docs/TESTING_MONITORING.md) for a step-by-step guide to testing these (including how to simulate a DB failure and verify the 503 readiness response).

### Testing guides

Hands-on, copy-pasteable guides for verifying each hardening/SaaS feature:

- [docs/TESTING_FEATURE_GATING.md](./docs/TESTING_FEATURE_GATING.md) — per-plan account caps (409) and trial-expiry gate (402).
- [docs/TESTING_AUDIT_LOG.md](./docs/TESTING_AUDIT_LOG.md) — the audit trail (who did what) and `GET /api/admin/audit`.
- [docs/TESTING_BILLING.md](./docs/TESTING_BILLING.md) — the subscribe → trial → cap → paid/cancel lifecycle with the mock provider (no real money).
- [docs/TESTING_SECURITY.md](./docs/TESTING_SECURITY.md) — security headers, admin-login rate limiting (429), size limits (413), error messages.
- [docs/TESTING_MONITORING.md](./docs/TESTING_MONITORING.md) — health/readiness probes, admin System status, error capture.
- [docs/ACCOUNT_PROFILE.md](./docs/ACCOUNT_PROFILE.md) — the account menu (name dropdown), the Profile page (edit name/phone), and password change, plus how Supabase + the backend stay in sync.
- [docs/SUPPORT_AND_EXPORT.md](./docs/SUPPORT_AND_EXPORT.md) — plan-aware "Contact support" (configurable `SUPPORT_EMAIL`, mailto with name + plan + priority) and the Agency-only analytics CSV export.
- [docs/SIGNUP_FLOW.md](./docs/SIGNUP_FLOW.md) — **proposed** sign-up → choose plan (show costs) → payment-page flow, and how it maps onto the existing billing setup gate.
- [docs/PLATFORM_OAUTH.md](./docs/PLATFORM_OAUTH.md) — per-platform OAuth setup, testing-mode gotchas (e.g. Google "test users"), and the **going-live verification** steps (Google/Meta/TikTok app review) required before the public can connect.
- [docs/PAYMENTS_PAYSTACK.md](./docs/PAYMENTS_PAYSTACK.md) — the Paystack billing integration: config, how the adapter + webhook signature work, testing, and going live.
- [docs/AI_ASSISTANT.md](./docs/AI_ASSISTANT.md) — the AI Content Assistant: the Gemini (primary) → OpenRouter (fallback) provider chain, the 5 MVP tools, config (`AI_ENABLED` + keys), the `/api/ai/*` API, and how to extend it.

### Getting app credentials (one-time, per platform)

Register a developer app to obtain the `client_id` / `client_secret` and register your redirect URI (exactly as in `.env`):

- **Facebook & Instagram** — [Meta for Developers](https://developers.facebook.com) (Instagram needs a Business/Creator account linked to a Page).
- **YouTube** — [Google Cloud Console](https://console.cloud.google.com): enable **YouTube Data API v3**, create OAuth credentials.
- **TikTok** — [TikTok for Developers](https://developers.tiktok.com): apply for the **Content Posting API** (approval required for production).

---

## Running with Docker (optional)

```powershell
# From the project root, with backend/.env filled in:
docker compose up --build
```

- Frontend (nginx) → http://localhost:8080
- Backend is internal; nginx proxies `/api` to it.

When using Docker, the app is reached on **port 8080**, so update `.env`:
- `FRONTEND_ORIGIN=http://localhost:8080`
- Each `*_REDIRECT_URI` → `http://localhost:8080/api/auth/<platform>/callback` (and register those in each platform's portal).

Behind a corporate proxy / internal registry, pass `HTTP_PROXY` / `HTTPS_PROXY` / `NPM_REGISTRY` as build args (see `docker-compose.yml`).

---

## Project layout

```
socialmediaapp/
├── README.md                 this file
├── ARCHITECTURE.md           how the code works
├── docker-compose.yml        one-command run (frontend + backend)
├── docs/MULTI_TENANT_PLAN.md SaaS build plan + progress log
├── backend/                  Node/Express (ESM)
│   ├── prisma/schema.prisma  Customer, ConnectedAccount, Post, AnalyticsSnapshot, UsageEvent
│   └── src/
│       ├── config/           env config + plans catalogue
│       ├── platforms/        one adapter per platform + factory (Strategy/Factory)
│       ├── billing/          one adapter per payment provider + factory (Strategy/Factory)
│       ├── ai/               AI provider adapters (Gemini, OpenRouter) + fallback factory
│       ├── services/         PublishService (Facade), AiService, AccountService, entitlements, crypto, ...
│       ├── middleware/       requireCustomer, requireAdmin, requireActiveAccess, securityHeaders, rateLimit
│       └── routes/           auth, platforms, publish, tokens, customer, analytics, ai, admin, plans, app-config
└── frontend/                 Angular 22
    └── src/app/
        ├── core/             models, services (auth, publish, plans, theme, ai, ...), guards, interceptors
        └── features/         landing, compose, connections, ai, analytics, billing, customer (auth), admin, help
```

Design patterns: **Strategy/Adapter** (one `PlatformPublisher` per platform; one `BillingProvider` per payment provider; one `AiProvider` per AI vendor), **Factory** (`PublisherFactory`; `getBillingProvider`; `generateWithFallback`), **Facade** (`PublishService.publishToMany`). Adding a platform = write an adapter, register it, add its env block. Adding an AI tool = add a prompt method in `AiService` + a thin route (no provider changes).

---

## Security & privacy notes

See [SECURITY.md](./SECURITY.md) for the full posture, a **secret-rotation checklist**, and a deployment checklist.

- **Per-customer isolation** — every customer-scoped query filters by the authenticated customer id; one customer can never see another's data.
- **Token storage** — customers' OAuth tokens are AES-256-GCM encrypted at rest in the database; the browser never sends or receives raw tokens for publishing (resolved server-side by account id).
- **Media** — uploaded files live in the OS temp dir only for the upload and are deleted in a `finally` block; posts/media are never persisted.
- **Hardening in place** — security headers (CSP, nosniff, frame-deny, HSTS over HTTPS), admin-login rate limiting, request body (100 kb) and upload (`MAX_UPLOAD_MB`) size limits, and generic error messages (no raw internals leaked).
- **Known gaps (not yet done):** no payment provider; no admin-action audit log; no app-level Supabase Row-Level Security (isolation is enforced in application code); rate limiting is in-process (per instance); no structured logging/metrics; scheduling for Instagram/TikTok relies on the browser tab staying open. **Rotate secrets before deploying and serve over HTTPS** — see [SECURITY.md](./SECURITY.md). Roadmap in `docs/MULTI_TENANT_PLAN.md`.
```
