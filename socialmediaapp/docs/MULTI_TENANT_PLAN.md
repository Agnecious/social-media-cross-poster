# Multi-Tenant SaaS Plan (future work — not yet implemented)

This is a **design note**, not built features. It records the plan and decisions for turning the app from its current **single-tenant** form into a **self-service, multi-tenant SaaS**:

- Customers **sign up and log in** for themselves, fully **isolated** (each sees only their own accounts and activity).
- Once connected, customers can view **per-platform analytics** over a selectable period (**7–90 days**), using each platform's own insights APIs and date ranges.
- The **Administrator** area gains a dashboard: website **traffic/usage**, number of **active customers onboarded**, and **pricing/plan** management.
- A **pricing model** (tiers) and, later, **billing**.

> Status (updated): **In progress — foundation + analytics DONE.** See "Progress log" immediately below. The rest of this doc is the original plan; sections it references remain the reference for the not-yet-built parts.

---

## Progress log

**Done and verified working:**
- ✅ Supabase (PostgreSQL + Auth) connected; Prisma schema pushed (`customers`, `connected_accounts`, `posts`, `analytics_snapshots`, `usage_events`). Both dev + prod will use Supabase (dev project live).
- ✅ Customer **sign-up / login** via Supabase Auth (`/login`); customer sessions distinct from Administrator.
- ✅ **Per-customer isolation:** connected accounts moved to DB (AES-encrypted, keyed by `customerId`); `/api/tokens`, `/api/platforms/:p/targets`, `/api/publish` all require the customer and are scoped; tokens resolved server-side by `accountId` (never sent from browser). Verified customer B cannot see customer A's accounts.
- ✅ **Activity logging** to `posts` per customer.
- ✅ **Per-platform analytics (7–90 days)** — `/analytics` screen + backend adapter methods. Facebook working (real Page insights, metric-by-metric, resilient to Meta's deprecations); Instagram/YouTube implemented (need their scopes + reconnect); TikTok not supported. Requires extra OAuth scopes (added to `.env`).
- ✅ **Built-in usage counter** — `/api/usage` records events to `usage_events`; the frontend now records a `pageview` on every route change (`UsageService` + AppComponent NavigationEnd).
- ✅ **Admin dashboard** (`/admin-dashboard`, admin-JWT protected) — customer metrics (total / active-30d / new this month / signups-7d), website traffic (page views today / 7d / 30d), plan breakdown, and a customer table with **inline plan management** (change a customer's plan). Backend: `GET /api/admin/dashboard`, `GET /api/admin/customers`, `PATCH /api/admin/customers/:id/plan`. Nav "Dashboard" link appears when the admin is logged in.

- ✅ **Trial + self-service plan selection (no payments yet)** — **no Free tier**. New customers start a **30-day free trial on the Starter plan** and can **upgrade/downgrade to any tier at any time** (DB only, no card). Currency is **South African Rand (ZAR)**.
  - Tiers, features and limits are defined in **one place**: `backend/src/config/plans.js`. **Prices and trial length are now read from `.env`** (`PLAN_STARTER_PRICE_ZAR`=169, `PLAN_PRO_PRICE_ZAR`=529 (highlighted), `PLAN_AGENCY_PRICE_ZAR`=1399, `TRIAL_DAYS`=30), with sensible fallbacks if unset and "blank = custom/contact us". The catalogue is computed **on demand** (not frozen at import), so editing `.env` changes prices everywhere with just a backend restart — no rebuild. Served publicly via **`GET /api/plans`** (`backend/src/routes/plans.js`) and consumed by both the pricing section and the customer Plan screen — the frontend never hardcodes amounts.
  - `Customer` model gained `plan` (default now **`starter`**), `trialEndsAt`, `subscriptionStatus` (`trialing`→`active`). Set on first authenticated request in `requireCustomer` (trial = now + `trialDays()`). **Requires `npm run db:push`.**
  - Customer endpoints: **`GET /api/customer/subscription`** (plan, status, trial days left) and **`PUT /api/customer/plan`** (validated upgrade/downgrade anytime). Both behind `requireCustomer`.
  - Landing `#pricing` section now reads `/api/plans` (ZAR, no Free tier, "Start 30-day trial" CTAs) and the three tier cards are **centered** (flex layout — was a stale 4-column grid left over from the Free tier). New **Plan/Billing screen** (`/billing`, customer-guarded) shows current plan + trial days left and lets the customer switch tiers; "Plan" nav link appears when signed in.
  - Verified: backend `node --check` clean + a runtime import test confirmed env prices/trial inject correctly; frontend `ng build` succeeds (only a pre-existing analytics NG8107 warning remains).

- ✅ **Sign-up profile (firstName, lastName, phone)** — the customer sign-up form now collects **first name, last name and phone number, all required** (shown only in sign-up mode; `canSubmit()` gates the button). They ride along as **Supabase user metadata** (`signUp` `options.data`) and are mirrored into the `Customer` row on first authenticated request in `requireCustomer` (set on create, backfilled on update). Schema: `Customer` gained nullable `firstName`/`lastName`/`phone` (nullable so existing rows + the pre-confirmation window are fine; **requires `npm run db:push`**). The **admin dashboard customer table** now shows **Name** and **Phone** columns (`GET /api/admin/customers` returns them). Verified: backend `node --check` + `prisma validate` clean; frontend `ng build` succeeds.

- ✅ **Configurable app-wide theme (light/dark)** — a single shipped theme for the whole app (no per-user toggle), set in the backend `.env` via **`APP_THEME=light|dark`** (default `light`; invalid → light). Read on demand by `appTheme()` in `config/index.js` and served by a public **`GET /api/app-config`** (`routes/appConfig.js`). The frontend `ThemeService` fetches it via an `provideAppInitializer` (before first render) and sets `data-theme` on `<html>`; if the call fails it stays light. Styling is driven by CSS custom properties: `styles.css` has the app palette in `:root` + a `[data-theme="dark"]` override, and the **landing page** was converted from hardcoded hex to its own `--lp-*` variables (with a dark override) so it themes too. Also fixed two blockers (`color-scheme` follows theme; selected-tile tint is now a variable). Change the theme = edit `.env` + restart backend, no rebuild. Verified: backend `node --check` clean; frontend `ng build` succeeds.

- ✅ **Feature gating / plan enforcement (no payments)** — plan tiers are now ENFORCED, not just displayed.
  - **Per-plan account limits** come from the configurable plans catalogue. Each tier has an env-overridable cap (`PLAN_STARTER_MAX_ACCOUNTS=1` / `PLAN_PRO_MAX_ACCOUNTS=5` / `PLAN_AGENCY_MAX_ACCOUNTS=0`=unlimited), resolved in `config/plans.js` via `planAccountCap(planId)` (unknown/legacy plans fall back to the Starter cap). `AccountService.effectiveAccountCap(plan)` uses the plan cap, and when a plan is "unlimited" defers to the global `MAX_ACCOUNTS_PER_PLATFORM` as an operator ceiling. `AccountService.add` enforces this on connect; `tokens.js` PUT passes the customer's plan and returns a 409 with an upgrade nudge at the limit.
  - **Trial / subscription gate** — `services/entitlements.js` (`hasActiveAccess`: subscription `active` OR trial not expired) + `middleware/requireActiveAccess.js` (402 `{error, reason}`), applied to **connect** (`tokens.js` PUT) and **publish** (`publish.js` POST). An expired trial with no active plan blocks these actions; listing/removing accounts stays open. (Note: the backend still provisions the trial via `requireCustomer`.)
  - **Frontend surfacing** — `GET /api/tokens` now returns the customer's effective `maxAccountsPerPlatform`; `AuthService.planAccountCap` holds it. Connections shows "X of N account(s) connected on your plan" and disables Connect at the cap; both Connections and Compose show the server message and a **"→ /billing"** nudge on limit (409) / trial-expired (402) errors.
  - Verified: backend `node --check` on all touched files + a runtime test of caps/overrides/fallbacks; frontend `ng build` succeeds (only the pre-existing analytics NG8107 warning). No DB migration needed.

- ✅ **Security hardening (dependency-free)** — first pass, no new npm deps (corp SSL blocks installs, so helmet/express-rate-limit equivalents are hand-rolled).
  - **Security headers** (`middleware/securityHeaders.js`, applied first): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, strict `Content-Security-Policy` (JSON API), `Permissions-Policy`, HSTS over HTTPS; `X-Powered-By` disabled; `trust proxy` enabled for correct IP/scheme behind nginx.
  - **Rate limiting** (`middleware/rateLimit.js`): in-process fixed-window limiter on the **admin login** (default 10 / 15 min, per IP) → 429 with `Retry-After`. (Per-process — swap for a shared store behind multiple replicas.)
  - **Request size limits**: JSON/form bodies capped at 100 kb; uploads capped at `MAX_UPLOAD_MB` (default 100 MB), 1 file/request; oversize → 413. Central error handler maps body-parser/multer limit errors to 413/400.
  - **No raw error leakage**: `publish.js` and `platforms.js` now log details server-side and return generic messages.
  - **Scrubbed `.env.example`**: the admin bcrypt hash and JWT secret are now obvious placeholders (were real-looking); added generation commands + `MAX_UPLOAD_MB`.
  - **New [SECURITY.md](../SECURITY.md)**: posture summary, a **secret-rotation checklist** (Supabase DB password + service_role, `ADMIN_JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `TOKEN_STORE_KEY`, platform client secrets), and a deployment checklist.
  - Verified: `node --check` on all touched files + a middleware unit test (headers correct, HSTS https-only, limiter blocks past the max). Known remaining: no RLS, no audit log, no structured logging/metrics; dependency-based hardening (helmet) deferred.

- ✅ **Audit logging** — a persistent trail of *who did what* for sensitive, deliberate actions, distinct from the structured request/error log.
  - New Prisma model **`AuditLog`** (`audit_logs`): `actorType` (admin|customer|system), `actorId`, `action`, `targetType`, `targetId`, `metadata` (JSON), `ip`, `createdAt`; indexed on createdAt/actorType/action. Intentionally **no FK** so the trail outlives deleted customers/accounts. **Requires `npm run db:push`.**
  - **`services/audit.js`** — `recordAudit(req, {...})` writes best-effort (**never throws** into the request path; failures are logged), resolving actor + IP from the request; mirrors to the structured logger. Secrets are never stored (admin config edits record only the **field names** changed, not values).
  - **Events captured:** admin platform-config edit (`admin.config.update`), admin plan change (`admin.customer.plan.change`, before→after), customer self-service plan change (`customer.plan.change`, before→after), account connect (`account.connect`) and disconnect (`account.disconnect`).
  - **Readable actor & target:** each entry stores an `actorLabel` (customer **email** / admin username) AND a `targetLabel` (affected customer email, platform name, or `platform — account`), both captured at write time — so the dashboard shows "customer: alice@example.com" and a readable target instead of bare UUIDs, and stays readable even after the referenced row is deleted.
  - **`GET /api/admin/audit`** (admin-only, filters `action`/`actorType`, default 100 / max 500) + an **Audit log table** on the admin dashboard (when, actor, action, target, detail).
  - Verified: `node --check` + `prisma validate` clean; frontend `ng build` succeeds.

- ✅ **Monitoring / observability (dependency-free)** — the app is now operable and its health is visible.
  - **`services/monitoring.js`**: `checkReadiness()` (pings the DB via `prisma.$queryRaw SELECT 1` + reports Supabase config), `captureException()` (single error choke point — always logs, Sentry-ready via `SENTRY_DSN` when `@sentry/node` is wired), `installProcessHandlers()` (catches `unhandledRejection` / `uncaughtException` instead of dying silently), `processMetrics()` (version, node, uptime, memory), `appVersion()`.
  - **Probes:** `GET /api/health` is a cheap **liveness** check (status, version, uptime, timestamp, enabled platforms — always 200 while responsive); new **`GET /api/ready`** is a **readiness** check that returns **200/503** based on the DB ping, so an orchestrator can gate traffic.
  - The central Express error handler and process now funnel through `captureException`.
  - **`GET /api/admin/health`** (admin-only) returns readiness + runtime metrics, surfaced as a **System status** panel on the admin dashboard (Ready/Degraded, DB up/down + latency, Supabase, uptime, version, memory, node).
  - New env: `APP_VERSION` (health/version display), `SENTRY_DSN` (optional error forwarding). Verified: `node --check` + a runtime readiness test (DB reachable) + `ng build` clean.

- ✅ **Billing — Layer 1 (provider-agnostic, mock provider, no real money)** — the trial is now a card-on-file, capped test drive.
  - **New trial model:** new signups start `pending_setup` and are **blocked** until they choose a plan + add billing. Setup starts the trial, during which they get **`TRIAL_MAX_POSTS` (default 1)** successful cross-posts (one compose → fan-out = one). Then payment converts them to `active`.
  - **Provider-agnostic core** (`src/billing/`): `BillingProvider` interface (Strategy), a **`MockBillingProvider`** (fake checkout + webhook-shaped events, charges nothing), and a **`PeachBillingProvider` stub** (REST, no SDK — fills in when the Peach account exists). `BILLING_PROVIDER` selects; `BILLING_ENABLED` is the master switch (**off by default** → old no-payment behaviour preserved).
  - **Data:** `Subscription` (one per customer) + `PaymentEvent` (idempotent by `(provider, eventId)`); `Customer` gained `trialPostsUsed` and the `pending_setup` default. Prices still come from `plans.js` — no duplication.
  - **State machine** (`services/subscriptionState.js`): `pending_setup → trialing → active | past_due | canceled`, driven by webhooks, never ad-hoc toggles. `accessState()` gates the app; `trialPublishAllowance()` enforces the post cap.
  - **Endpoints:** `POST /api/customer/billing/subscribe`, `GET /api/customer/billing`, public `POST /api/billing/webhook` (signature-verified, idempotent), dev-only `POST /api/billing/mock/complete`.
  - **Frontend:** the Plan/Billing screen is the mandatory setup gate for new signups, shows a trial banner (posts used), handles the mock checkout return, and surfaces blocked states — with a `/billing` nudge on any 402. **No card data ever touches the app** (provider-hosted).
  - Testing: [TESTING_BILLING.md](./TESTING_BILLING.md). Needs `npm run db:push` + `BILLING_ENABLED=true`. Verified: `node --check` + `prisma validate` + `ng build` clean.
  - **Next (Layer 2/3):** implement the Peach adapter against a sandbox account (real checkout + webhook formats), then go live.

**Next up (in order):**
1. **Peach Payments integration (Layer 2)** — fill in the Peach adapter in sandbox, then production. (e.g. `MAX_ACCOUNTS_PER_PLATFORM` becomes per-plan via `plans.js` `limits`; posts/month; analytics-history window). This turns the pricing tiers into enforced, paid entitlements. Also: expiry behaviour when the 30-day trial ends without a chosen plan; admin UI to edit the plan prices (the price/trial env vars are a natural fit for the existing Administrator `.env` editor).
2. **Hardening** — Supabase Row-Level Security as a second isolation net; rotate the setup secrets; HTTPS in production; token refresh (optional).

**Known small gaps (noted, not yet done):**
- The Plan/Billing screen (`/billing`) reuses the pricing-card classes (`.lp-pricing`/`.price-card`), but those styles live in `landing.component.css` (component-scoped), so they don't reach `/billing` yet. Move them to global `styles.css` (or copy into the billing component) when polishing that screen.

**Before public launch — platform OAuth verification (easy to forget):**
- Each social platform starts in a restricted test/dev mode where **only
  whitelisted accounts can connect**. To let the public connect you must publish
  + pass each platform's **app review** (Google OAuth verification, Meta App
  Review + Business Verification, TikTok app review) — privacy policy, demo
  video, scope justification, days–weeks each. **Start early.** Full steps +
  troubleshooting in **[PLATFORM_OAUTH.md](./PLATFORM_OAUTH.md)**.
- Dev workaround (Google): add the connecting account under OAuth consent screen
  → **Test users** to connect while unverified.

- ✅ **AI Content Assistant (MVP)** — turn one idea into platform-optimized content. Five tools behind a tabbed `/ai` screen: **generate platform content** (Facebook/Instagram/LinkedIn/TikTok/YouTube title+description+hashtags), **rewrite** (7 tones), **hashtag generator** (10–20), **title generator**, **translate** (meaning/tone-preserving).
  - **Provider-agnostic core** (`src/ai/`): `AiProvider` interface (Strategy, one method `complete()`), **`GeminiProvider`** (PRIMARY — Google Generative Language REST, API-key auth) and **`OpenRouterProvider`** (FALLBACK — OpenAI-compatible gateway). `ai/index.js` factory runs **`generateWithFallback`** (Gemini → OpenRouter; only configured providers are tried; last error surfaces if all fail). All product logic (prompt building + strict-JSON parsing via `extractJson`) lives in **`services/AiService.js`** — providers know nothing about platforms/hashtags.
  - **API** (`routes/ai.js`, mounted `/api/ai`): `GET /config` + `POST /{platform-content,rewrite,hashtags,titles,translate}`. Gated by `requireCustomer` + `requireActiveAccess` (paid/trial) + an availability guard (503 when off/unconfigured) + rate limit (20/5 min/IP); each call audited (tool + provider, **no content stored**).
  - **Config** (read on demand): `AI_ENABLED` master switch (**off by default**), `GEMINI_API_KEY`/`GEMINI_MODEL`, `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`. "Available" only when enabled **and** ≥1 key set; the UI hides the feature otherwise.
  - **Frontend:** `/ai` `AiAssistantComponent` (signals, tabbed, copy-able result cards) + `ai.service.ts`/`ai.model.ts`; `/api/ai/` added to the customer-auth interceptor; nav link added. No DB migration needed.
  - Verified: backend `node --check` on all 7 files + frontend `ng build` clean (EXIT 0, no warnings). **Egress caveat:** live Gemini/OpenRouter calls can't run from the blocked corporate network (same block as Supabase/SMTP/OAuth). Full details in **[AI_ASSISTANT.md](./AI_ASSISTANT.md)**.

**Known gotchas to remember next time:**
- Corporate SSL inspection: npm/Node need `NODE_EXTRA_CA_CERTS` / npm `cafile` = company CA. Supabase direct host (`db.*.supabase.co:5432`) is unreachable — use the **pooler** host for both `DATABASE_URL` (6543) and `DIRECT_URL` (5432 session mode).
- OAuth redirect URIs must match **exactly** (scheme/host/port/no trailing slash) between each platform console and `<PLATFORM>_REDIRECT_URI`; the callback goes to the **backend** (:3000), not the frontend. `redirect_uri_mismatch` = fix in the console.
- Schema changes require `npm run db:push`; backend restart needed for new routes/env.
- My npm is blocked by SSL inspection, so **you run `npm install` / `npm run build`** in your terminal.

---

## (Original plan follows)

---

## Goal

Customers sign up for themselves. Each customer is **isolated**: they can view and manage only their own social accounts, posts, schedules, analytics, and activity — never another customer's. The owner (Administrator) gets business visibility (usage, active customers) and can manage pricing.

---

## Current state (why it's single-tenant today)

- **No customer login.** The only auth is the single **Administrator** account (`ADMIN_*` in `.env`). Regular visitors don't log in.
- **Connected accounts are global.** `TokenStore` keeps all accounts in one shared, encrypted `.tokens.enc` file (`{ platform: { accountId: {...} } }`). Anyone using the app sees and can post from every connected account.
- **No database.** By original design the app persists nothing except the encrypted token file. True per-customer isolation is not possible without a datastore keyed by customer.
- **Shared UI state.** Compose, Connections, and results reflect the same global state for everyone.

**Consequence:** giving the app to two customers as-is would let them see and control each other's accounts. Multi-tenancy closes that gap.

---

## Database & auth decision

**Supabase (managed PostgreSQL + built-in Auth) for BOTH development and production, via two separate free projects. Prisma as the ORM.**

- **Why Supabase:** free managed PostgreSQL (no server to maintain) **plus** a built-in **Auth** system (email/password, magic links, social login, password resets, email verification) that pairs with Postgres Row-Level Security. It covers both the database and the customer-login requirement in one free product.
- **Two projects for isolation of environments:** `socialposter-dev` and `socialposter-prod`. Same free tier; each has its own `DATABASE_URL` and API keys, so test data never mixes with real customers.
- **Prisma** is the data layer (`provider = "postgresql"`). App data code stays the same across dev/prod — only `DATABASE_URL` differs.
- **Customer auth = Supabase Auth (recommended).** Less code, battle-tested, handles resets/verification, and integrates with Row-Level Security as a second safety net for tenant isolation. The existing **Administrator** login stays separate (own JWT), or can migrate to Supabase later.

### Supabase setup (owner does this once, per environment)

1. Create a Supabase account and a project at supabase.com (free tier). Choose the closest region (e.g. EU-West) for South Africa latency. Do this twice: a **dev** and a **prod** project.
2. Project Settings → **Database**: copy the **connection string**. Supabase provides a **pooled** connection (port 6543) for app queries and a **direct** connection (port 5432) for Prisma migrations. Both go in `.env`.
3. Project Settings → **API**: copy the **Project URL**, the **anon** public key (frontend), and the **service_role** key (backend only — secret).
4. Put these in the backend `.env` (new keys): `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Keep dev and prod values in their respective environments.
5. No local database to install — Prisma + the Supabase JS client are npm packages.

---

## Data model (sketch)

Every customer-owned row carries a `customer_id` foreign key. (If using Supabase Auth, `customers` maps to the Supabase `auth.users` id.)

- **customers** — `id`, `email` (unique), `created_at`, `plan` (free/starter/pro/agency), `plan_status`. (Password handled by Supabase Auth; no local hash needed if we use it.)
- **connected_accounts** — `id`, `customer_id`, `platform`, `account_id`, `label`, `auth` (encrypted token), `scopes`, `created_at`. Replaces the global `.tokens.enc`.
- **posts** (activity/history) — `id`, `customer_id`, `platform`, `account_id`, `text`, `media_type`, `scheduled_at?`, `status` (published/scheduled/failed), `result_url?`, `error?`, `created_at`.
- **analytics_snapshots** (optional cache) — `id`, `customer_id`, `connected_account_id`, `metric`, `value`, `period_start`, `period_end`, `fetched_at`. Caches platform insights so we don't hit their APIs on every view.
- **usage_events** (optional, for admin metrics) — `id`, `customer_id?`, `type` (login/publish/schedule/pageview), `created_at`.
- (optional later) **scheduled_jobs**, **audit_log**, **subscriptions** (billing).

---

## Build stages (in order)

Foundation (multi-tenancy) — do these first; everything else depends on them:

1. **Supabase + Prisma + customer model** — connect to Supabase Postgres via Prisma; create `customers` (or map to Supabase `auth.users`).
2. **Customer sign-up + login** — Supabase Auth (register, login, reset, verify); customer sessions distinct from the Administrator role.
3. **Scope everything by `customerId`** — THE security-critical core. Every query/API filters on the logged-in customer; back it with Supabase Row-Level Security. Connected accounts, compose targets, results, history become "this customer only."
4. **Move tokens into the DB** — from the single `.tokens.enc` file to `connected_accounts` keyed by customer; encrypt per customer.
5. **Per-customer activity/history** — persist a `posts` log so each customer sees their own activity.

Then the new capabilities:

6. **Per-platform analytics (7–90 days)** — see the Analytics section. Roll out platform-by-platform (FB/IG/YouTube first, TikTok if API allows).
7. **Admin dashboard** — active customers (our data) + website traffic (via an analytics tool) + plan management. See the Admin Dashboard section.
8. **Pricing page** — a public pricing section (see Pricing). Static first.
9. **Billing (later)** — Stripe/Paddle subscriptions + enforce tier limits. Its own milestone.
10. **Harden throughout** — no endpoint returns another customer's data, rate limiting, HTTPS in production.

---

## Per-platform analytics (7–90 days)

Once an account is connected, show insights per platform for a selectable period. Use each platform's **own insights API and date ranges** (default 7 days, up to 90).

- **Facebook / Instagram** — Graph API **Insights** (impressions, reach, engagement, follower changes). Supports date ranges. Needs extra read scopes (e.g. `read_insights`, `instagram_manage_insights`).
- **YouTube** — **YouTube Analytics API** (views, watch time, subscribers gained) with date ranges. Needs the analytics read scope.
- **TikTok** — more limited; some metrics via their API, often gated behind app review/elevated access.

Design notes:
- **Extra OAuth scopes required** beyond current posting scopes — request insights scopes at connect time; existing connections may need re-consent.
- **Cache results** in `analytics_snapshots` so we don't call platform APIs on every page view (respects rate limits).
- UI: a period selector (7 / 14 / 30 / 90 days), per-platform cards + simple charts, scoped to the customer's connected accounts.
- **Honest caveat:** completeness depends on what each platform grants the app; build strongest-first (FB/IG/YouTube), treat TikTok analytics as best-effort.

---

## Admin dashboard

Extends the existing Administrator area (which today only manages platform config). New, owner-only views:

- **Active customers onboarded** — from our own data: total customers, active (e.g. posted/logged in within 30 days), new this month, plan breakdown. Straightforward once `customers` + `usage_events` exist.
- **Website traffic / usage** — **built-in counter (confirmed).** Record page views and key actions in `usage_events` and show simple totals/trends (views today, this week, this month; top pages) in the admin dashboard. No external analytics tool for now. (Can add Plausible/GA later if more depth is needed.)
- **Plan/pricing management** — view/edit tiers, see who's on which plan. Ties into billing later.

---

## Pricing model (suggested)

Per-capability tiers. Prices are starting-point suggestions in **USD** (localize to **ZAR** as needed). The natural upgrade levers are **accounts, scheduling, analytics depth, and volume** — which map directly to features we already have or are planning.

| Feature | Free | Starter ($9/mo) | Pro ($29/mo) | Agency ($79/mo) |
|---|---|---|---|---|
| Connected accounts / platform | 1 | 3 | 10 | Unlimited |
| Platforms | 2 | All 4 | All 4 | All 4 |
| Posts / month | 10 | 100 | Unlimited | Unlimited |
| Scheduling | ❌ | ✅ | ✅ | ✅ |
| Analytics history | — | 7 days | 30 days | 90 days |
| Team members | 1 | 1 | 3 | 10 |
| Support | Community | Email | Priority | Priority + onboarding |

Notes:
- **Analytics history (7 → 30 → 90 days)** is a clean tier differentiator and maps directly to the analytics date-range feature.
- The existing global `MAX_ACCOUNTS_PER_PLATFORM` becomes a **per-plan** limit once billing exists.
- Showing the pricing page is easy and can ship early; **charging** money (Stripe/Paddle) is a separate later milestone.
- Consider annual pricing (~2 months free) once billing is in.

---

## Key risks & notes

- **Reverses the "store nothing" principle.** Multi-tenancy requires persisting customer records, tokens, history, and analytics cache. Update the app's privacy messaging when this ships.
- **Data scoping is the critical risk.** A single missed `customer_id` filter leaks one customer's data to another. Stage 3 must be done carefully, tested per endpoint, and backed by Supabase Row-Level Security.
- **Token custody.** You become custodian of many customers' social tokens — encrypt at rest (reuse the AES pattern in `TokenStore`) and require HTTPS in production.
- **Analytics needs extra OAuth scopes** — insights permissions beyond posting scopes; existing connections may need re-consent, and TikTok analytics may need elevated API access.
- **Admin vs customer are different roles.** Keep the Administrator area (config + business dashboard) separate from customer logins.
- **Secrets grow** — Supabase `service_role` key and DB connection strings are highly sensitive; backend-only, never in the frontend, never committed.
- **The multi-account work already done carries over** — it becomes "accounts per customer" rather than "accounts globally," so that effort is not wasted.

---

## What already helps

- Bcrypt + JWT auth (built for Admin) — the pattern reuses cleanly; customers will use Supabase Auth.
- AES-256-GCM token encryption (in `TokenStore`) — reuse per customer when tokens move to the DB.
- Multi-account model (accounts keyed by platform + accountId) — extend with `customer_id`.
- Per-platform adapters (Strategy) — extend each with an insights/analytics method for the analytics feature.
- `MAX_ACCOUNTS_PER_PLATFORM` — becomes a per-plan limit once pricing/billing exists.

---

## Confirmed decisions

1. **Customer auth:** ✅ **Supabase Auth** (email/password; resets & verification handled by Supabase).
2. **Web traffic analytics:** ✅ **Basic built-in counter** — record page views/usage in the `usage_events` table and show simple totals in the admin dashboard (no external tool for now).
3. **Pricing:** ✅ Tier structure approved (Free / Starter $9 / Pro $29 / Agency $79). Currency to finalize at build time (USD base; ZAR display optional).
4. **Build order:** foundation (stages 1–5) first, then analytics, then admin dashboard, then pricing, then billing.
