# Project Memory — Social Cross-Poster

> Durable context for this workspace. The project lives in the nested
> `socialmediaapp/` folder (workspace root is `social-media-cross-poster/`).
> This file was seeded from the project's own docs (README, ARCHITECTURE,
> SECURITY, docs/MULTI_TENANT_PLAN) as an identical copy of an earlier project
> at `C:\Users\F5506166\Work\Kiro\socialmediaapp`. Keep it current as work lands.

## What the app is

A **multi-tenant SaaS** for composing a post once and publishing (or scheduling)
it to **Facebook, Instagram, YouTube, and TikTok**. Customers sign up, connect
their own social accounts via OAuth, and cross-post from one UI. Ships with
self-service subscription tiers (trial + upgrade/downgrade), per-platform
analytics, an AI content assistant, an owner/admin dashboard, and a configurable
light/dark theme.

Originally a single-tenant stateless tool; evolved into multi-tenant SaaS. The
posting engine, platform adapters, and admin config area are the original core;
the customer/DB/analytics/billing/AI layers were added on top.

## Tech stack

- **Frontend:** Angular 22 (standalone components, signals, `@if`/`@for`), TypeScript, `@angular/build`, nginx in Docker. Dev on `:4200`.
- **Backend:** Node ≥18 (tested v24), Express 4, ESM. `axios`, `multer`, `form-data`, `dotenv`, `bcryptjs` + `jsonwebtoken` (admin auth), Node `crypto` (AES token encryption). Dev on `:3000`.
- **Data:** Supabase (PostgreSQL + Auth) via Prisma 5. Schema at `backend/prisma/schema.prisma`; apply with `npm run db:push`.
- **Auth:** Supabase Auth for customers (JWT verified server-side via service_role key in `requireCustomer`); bcrypt + JWT for the single admin.
- **Secrets:** OAuth tokens AES-256-GCM encrypted at rest, per-customer, in DB (`connected_accounts.auth_enc`). Key = SHA-256 of `TOKEN_STORE_KEY`, shared via `services/crypto.js`.
- **Docker:** `docker compose up --build` → frontend (nginx) on `:8080`, backend internal with `/api` proxied.

## Architecture / key patterns

- **Strategy/Adapter:** one `PlatformPublisher` per platform; one `BillingProvider` per payment provider; one `AiProvider` per AI vendor.
- **Factory:** `PublisherFactory`, `getBillingProvider`, AI `generateWithFallback`.
- **Facade:** `PublishService.publishToMany()` fans out to many platforms; routes never touch adapters directly.
- **Live config:** platform/plan/theme config is recomputed from `process.env` per read (`config/index.js`, `config/plans.js`), so Admin `.env` edits take effect on the next request — no rebuild (server port + Supabase keys are boot-time, need restart).
- Adding a platform = new adapter + register in factory + `X_*` env block. Adding an AI tool = add a prompt method in `AiService` + a thin route.

### Backend layout (`backend/src/`)
`server.js` (middleware + route mounting), `config/` (env + plans catalogue),
`platforms/` (adapters + factory), `billing/` (providers + factory), `ai/`
(Gemini + OpenRouter + fallback factory), `services/` (PublishService, AiService,
AccountService, entitlements, crypto, audit, monitoring, subscriptionState, ...),
`middleware/` (requireCustomer, requireAdmin, requireActiveAccess,
securityHeaders, rateLimit, requestLogger), `routes/` (auth, platforms, publish,
tokens, customer, analytics, ai, admin, adminAuth, plans, appConfig, billing).

### Data model (Prisma)
`Customer` (id = Supabase auth user id; email, firstName/lastName/phone, plan,
subscriptionStatus, trialEndsAt, trialPostsUsed), `ConnectedAccount` (per customer;
platform, accountId, label, authEnc, scopes), `Post` (activity/history),
`AnalyticsSnapshot` (cached metrics), `UsageEvent` (pageview/login/publish...),
`AuditLog` (who-did-what, no FK so it outlives deleted rows), `Subscription`
(one per customer), `PaymentEvent` (idempotent by provider+eventId).

## Per-platform capabilities

| Platform | Text | Image | Video | Destination | Native scheduling | Analytics |
|----------|:----:|:-----:|:-----:|:-----------:|:-----------------:|:---------:|
| Facebook | ✓ | ✓ | ✓ | Page | ✓ | ✓ (real) |
| Instagram | ✗ | ✓ (public URL) | ✓ | IG Business acct | ✗ (browser fallback) | ✓ (needs scope+reconnect) |
| YouTube | ✗ | ✗ | ✓ | — | ✓ | ✓ (needs scope) |
| TikTok | ✗ | ✓ | ✓ | — | ✗ (browser fallback) | ✗ (gated API) |
| X (Twitter) | ✓ (≤280) | ✓ | ✓ | — | ✗ (browser fallback) | ✗ |

- FB/IG post to **Pages/Business accounts**, not personal profiles (Meta policy).
- Scheduling: FB/YouTube native (survive browser close); IG/TikTok/X use a browser `setTimeout` fallback that **needs the tab open**.
- **X (Twitter)** — full platform. API v2, **OAuth 2.0 + PKCE**; adapter `platforms/XPublisher.js`. Posts via `POST /2/tweets` (text ≤280; image single-shot + video chunked upload via v1.1 `upload.twitter.com`). No target picker, no native scheduling. **PKCE in the stateless OAuth flow:** the adapter mints the `code_verifier` in `getAuthUrl`, packs it (AES-GCM encrypted when `TOKEN_STORE_KEY` set, else base64url, with a CSRF nonce) into the OAuth `state`, and recovers it in `exchangeCode(code, state)`. `exchangeCode` now takes `state` (threaded from `routes/auth.js` callback → `PublishService` → adapter); other adapters ignore it. Env block `X_*` (ENABLED/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/SCOPES=tweet.read,tweet.write,users.read,offline.access), disabled by default. Registered in `config/index.js` PLATFORM_KEYS + `PublisherFactory` REGISTRY. X brand accent = black (`#000`). X is also in the AI assistant (`SUPPORTED_PLATFORMS`, platform-content/complete-pack prompts, Compose "rewrite for X" action, `/ai` platform chips). **Going live needs X developer app + app review** (like the other platforms).

## What's been built (DONE & verified)

- Supabase + Prisma foundation; customer sign-up/login via Supabase Auth.
- **Per-customer isolation** — tokens in DB (AES-encrypted, keyed by customerId); `/api/tokens`, `/api/platforms/:p/targets`, `/api/publish`, `/api/analytics` all require the customer and scope by `req.customer.id`; tokens resolved server-side by accountId (never sent from browser). Verified B can't see A.
- **Activity logging** to `posts`.
- **Per-platform analytics (7–90 days)** — `/analytics` screen + adapter methods. FB real; IG/YouTube implemented (need scopes + reconnect); TikTok unsupported.
- **Built-in usage counter** — `/api/usage`, pageview on every route change.
- **Admin dashboard** (`/admin-dashboard`, admin-JWT) — customer metrics, traffic, plan breakdown, customer table with inline plan management (name/email/phone), System status panel, audit log table.
- **Trial + self-service plans (ZAR)** — no Free tier; Starter/Pro/Agency defined in `config/plans.js` with prices/trial from `.env`; served via `GET /api/plans`. Customer Plan/Billing screen at `/billing`.
- **Sign-up profile** — firstName/lastName/phone collected (required), stored as Supabase metadata + mirrored to `Customer`.
- **Configurable app theme** — `APP_THEME=light|dark` in `.env`, served via `GET /api/app-config`, applied via `ThemeService` before first render (CSS custom properties).
- **Feature gating** — per-plan account caps (`PLAN_*_MAX_ACCOUNTS`, 0 = unlimited → global ceiling); trial/subscription gate via `entitlements.js` + `requireActiveAccess` (402); surfaced in Connections/Compose with `/billing` nudge.
- **Security hardening (dependency-free)** — `securityHeaders.js` (nosniff, frame-deny, referrer, strict CSP, permissions-policy, HSTS over HTTPS, X-Powered-By off, trust proxy); `rateLimit.js` (admin login, 10/15min/IP → 429); body limit 100kb / upload `MAX_UPLOAD_MB` → 413; generic error messages; SECURITY.md.
- **Audit logging** — `AuditLog` model + `services/audit.js` (best-effort, never throws); captures admin config edits, plan changes, account connect/disconnect with readable actor/target labels; `GET /api/admin/audit`.
- **Monitoring (dependency-free)** — `services/monitoring.js` (readiness DB ping, captureException single choke point Sentry-ready via `SENTRY_DSN`, process handlers, metrics); `GET /api/health` (liveness, always 200), `GET /api/ready` (200/503), `GET /api/admin/health`.
- **Billing — Layer 1 (mock, no real money)** — `pending_setup → trialing → active | past_due | canceled` state machine (`subscriptionState.js`), provider-agnostic (`BillingProvider` + `MockBillingProvider` + `PeachBillingProvider` stub), `BILLING_ENABLED` off by default, trial capped at `TRIAL_MAX_POSTS` (default 1). Endpoints: `/api/customer/billing/subscribe`, `/api/customer/billing`, `/api/billing/webhook` (signed, idempotent), dev `/api/billing/mock/complete`.
- **AI Content Assistant (MVP)** — `/ai` screen, tools: platform content, rewrite (7 tones), hashtags, titles, translate, ctas, analyze, expand, shorten, complete-pack, **proofread** (grammar/spelling), **seo-keywords** (YouTube SEO). Gemini (primary) → OpenRouter (fallback) via `generateWithFallback`; logic in `AiService.js`. `AI_ENABLED` off by default; available only when enabled + ≥1 key. Routes `/api/ai/*` gated by requireCustomer + requireActiveAccess + requireAiAvailable + **requireAiPlan (Pro/Agency only → 403 upgrade_required)** + rate limit (20/5min). `GET /api/ai/config` is soft-auth, returns `planAllowed`.
- **AI-powered Compose** — the Compose caption field has an integrated **AI assist** panel (`features/compose/compose-ai.ts` catalogue + logic in `compose.component.ts`). One-click actions grouped as: improve/professional/casual/shorten/expand/grammar/CTA; rewrite-for-platform (FB/IG/LinkedIn/TikTok/YouTube); generate assets (hashtags/titles/YouTube title+description+SEO). Caption actions show a **preview → Apply/Edit/Discard**; the original is preserved and there's session **version history + Revert**. Asset actions produce copy-able/append-able cards. AI is optional — manual composing/publishing is unaffected when AI is off or the plan lacks it (shows an upgrade nudge to `/billing`). **X (Twitter) is intentionally not offered** (not a supported publishing platform). All AI calls reuse existing `/api/ai/*` endpoints.
- **Mobile-first Compose** — `styles.css` has a mobile-first pass for Compose: single-column base, sticky publish/schedule bar on phones (`.actions-panel`, safe-area inset), touch-sized chips/tiles/controls (≥40–48px), 16px inputs (no iOS zoom), AI chips wrap→single-column on small phones; tablet (768–1024px) two-column; desktop (1024px+) 1.15fr/0.85fr workspace; `prefers-reduced-motion` respected. Light/dark via existing CSS custom properties.

## Next up / roadmap

1. **Peach Payments (Layer 2)** — fill in the Peach adapter against sandbox then prod; turn tiers into enforced paid entitlements (posts/month, analytics-history window per plan); trial-expiry behaviour; admin UI to edit plan prices. (There's also a **Paystack** integration documented in `docs/PAYMENTS_PAYSTACK.md`.)
2. **Hardening** — Supabase Row-Level Security (second isolation net), rotate setup secrets, HTTPS in prod, optional token refresh.

## Known gaps / gotchas (remember these)

- **Corporate SSL inspection blocks npm/Node HTTPS** unless `NODE_EXTRA_CA_CERTS` / npm `cafile` point at the company CA. **The user runs `npm install` / `npm run build` / live-network calls** — I generally can't from this environment.
- **Supabase direct host** (`db.*.supabase.co:5432`) is unreachable on the corporate network — use the **pooler** host for BOTH `DATABASE_URL` (6543, `pgbouncer=true`) and `DIRECT_URL` (5432 session mode).
- **Egress blocked** — live Gemini/OpenRouter/Supabase/SMTP/OAuth calls can't run from the blocked corporate network.
- **OAuth redirect URIs must match exactly** (scheme/host/port/no trailing slash) between each platform console and `<PLATFORM>_REDIRECT_URI`; callback hits the **backend** (:3000 dev, :8080 Docker), not the frontend. `redirect_uri_mismatch` = fix in the console.
- **Schema changes require `npm run db:push`**; new routes/env require a backend restart.
- No Supabase RLS yet (isolation is application-code only — backend uses service_role key which bypasses RLS). No token refresh (connection ends on disconnect or token expiry). Rate limiting is in-process (per replica). IG/TikTok scheduling needs the tab open.
- `/billing` screen reuses pricing-card classes that live in `landing.component.css` (component-scoped) so they don't reach `/billing` yet — move to global `styles.css` when polishing.
- Legacy global `TokenStore` (`.tokens.enc`) is superseded by `AccountService` for customer flows — cleanup candidate.
- Secrets pasted during setup (Supabase DB password, service_role key, platform client secrets) should be **rotated** before production (see SECURITY.md checklist).

## Cross-platform / dev-on-phone

- **Prisma is cross-platform now** — `schema.prisma` `generator client` has `binaryTargets = ["native","darwin","darwin-arm64","windows","debian-openssl-3.0.x"]`. The old "only runs on Windows" failure was a Windows-only generated engine being copied to a Mac. Fix on any new machine: `npm run prisma:generate` (or `npm install`) once per OS. Do NOT copy `node_modules` across OSes without regenerating.
- **Phone testing on the LAN** — `frontend/proxy.conf.json` proxies `/api` → `http://localhost:3000`. A `mobile` build/serve config in `angular.json` swaps in `environments/environment.mobile.ts` (apiBaseUrl = relative `/api`) and serves on `0.0.0.0`. Run backend (`npm run dev`) + `npm run start:mobile` in the frontend, then open `http://<dev-machine-LAN-IP>:4200` on the phone. The proxy means no backend CORS/`FRONTEND_ORIGIN` change is needed (phone only talks to :4200; Node proxies to :3000). Supabase auth calls go phone→Supabase directly (fine).

## Verification norms

- Backend: `node --check <file>` on touched files; `prisma validate` after schema edits; runtime import/smoke tests where possible.
- Frontend: `ng build` must succeed (one pre-existing analytics NG8107 warning is known/acceptable).
- Don't run long-lived dev servers in-session; ask the user to run `npm run dev` / `npm start`.

## Reference docs (in the repo)

README.md, ARCHITECTURE.md (§12 = SaaS layer), SECURITY.md, docs/MULTI_TENANT_PLAN.md
(plan + progress log), docs/CONFIGURATION.md, docs/AI_ASSISTANT.md,
docs/PAYMENTS_PAYSTACK.md, docs/PLATFORM_OAUTH.md, docs/SIGNUP_FLOW.md,
docs/ACCOUNT_PROFILE.md, docs/SUPPORT_AND_EXPORT.md, and the TESTING_*.md guides.
