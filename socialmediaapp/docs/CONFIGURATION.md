# Configuration reference

Everything that makes this app behave differently lives in **`backend/.env`**
(copied from `backend/.env.example`). There is no database-stored config and no
hardcoded secrets — the backend reads env vars, and the frontend gets the few
UI-relevant values it needs from `GET /api/app-config`.

This document is the single reference for **what each setting does, its default,
and when it takes effect.**

---

## How configuration is loaded

There are two timing models, and it matters:

| When read | Behaviour | Examples |
| --------- | --------- | -------- |
| **On demand** (per request/use) | Edit `.env`, **no restart needed** for most helpers — the next call re-reads `process.env`. The Admin UI edits also take effect immediately. | platform credentials, plan prices, account caps, theme, support email, SMTP, billing flags |
| **At boot** | Fixed when the process starts; **requires a restart** to change. | `PORT`, `FRONTEND_ORIGIN` (`serverConfig`), the Supabase clients, `ADMIN_*` |

> Rule of thumb: credentials and feature toggles are hot-reloaded; the server
> socket/CORS and auth secrets need a restart. When in doubt, restart.

Two ways to change values:

1. **Edit `backend/.env`** directly (everything is here).
2. **Admin UI** (`/admin` → platform config) — edits the per-platform OAuth
   fields and writes them back to `.env` via `EnvFileService`. Only the
   platform block fields are editable this way; everything else is `.env`-only.

What the **frontend** sees (served by `GET /api/app-config`, no auth):

```json
{ "theme": "light", "supportEmail": "...", "mailEnabled": false }
```

Nothing secret is ever sent to the browser. The Supabase **anon** key lives in
the frontend build (safe by design); the **service_role** key is backend-only.

---

## Server & runtime

| Var | Default | What it does | Restart? |
| --- | ------- | ------------ | -------- |
| `PORT` | `3000` | Backend listen port. | Yes |
| `FRONTEND_ORIGIN` | `http://localhost:4200` | CORS origin. **Must match the URL you open the app on** — OAuth posts results back to this exact origin; a mismatch makes the connect popup silently do nothing. | Yes |
| `LOG_LEVEL` | `info` | `error`/`warn`/`info`/`debug`. Logs are JSON lines on stdout/stderr. | On demand |
| `APP_VERSION` | `dev` | Version shown in `/api/health` + admin System status. | On demand |
| `SENTRY_DSN` | _(blank)_ | If set, captured exceptions forward to your tracker (needs `@sentry/node` wiring). Blank = just log. | On demand |
| `HTTP_TIMEOUT_MS` | `15000` | Timeout for outbound platform API calls (media uploads exempt). | On demand |
| `MAX_ACCOUNTS_PER_PLATFORM` | `5` | Global ceiling on connected accounts per platform (`0` = unlimited). Per-plan caps below override it. | On demand |
| `MAX_UPLOAD_MB` | `100` | Max single upload size; oversize → HTTP 413. | On demand |

## UI

| Var | Default | What it does |
| --- | ------- | ------------ |
| `APP_THEME` | `light` | App-wide theme `light`/`dark` (whole app incl. landing). No per-user toggle. Served via `/api/app-config`. |

## Contact support & email

The "Contact support" feature has **two modes**, chosen automatically by whether
SMTP is configured:

- **`mailto:` (default, zero config)** — opens the customer's own mail client
  with a pre-filled, plan-aware message. Works with no setup.
- **Server-side send (optional)** — when the `SMTP_*` vars are set, the app
  sends the email itself and the Profile page shows an in-app message form.

| Var | Default | What it does |
| --- | ------- | ------------ |
| `SUPPORT_EMAIL` | `mathema.business@gmail.com` | The inbox support messages are addressed to. Used in both modes. Served via `/api/app-config`. |
| `SMTP_HOST` | _(blank)_ | SMTP server host. **Blank → mailto mode.** |
| `SMTP_PORT` | `465` | SMTP port. `465` = implicit TLS; `587` = STARTTLS. |
| `SMTP_USER` | _(blank)_ | SMTP username (your email). |
| `SMTP_PASS` | _(blank)_ | SMTP password. **For Gmail use a 16-char App Password, not your login password.** |
| `SMTP_FROM` | = `SMTP_USER` | Visible From address. |

**Server-send turns on only when `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` are all
set** (`mailConfig().enabled`). See [SUPPORT_AND_EXPORT.md](./SUPPORT_AND_EXPORT.md)
for the Gmail App Password walkthrough and the send path.

## Subscription plans & feature gating

Prices are in **ZAR** and drive the pricing page + Plan screen with no rebuild.
Blank price = "custom / contact us". Caps are the **enforced** per-plan limits.

| Var | Default | What it does |
| --- | ------- | ------------ |
| `PLAN_STARTER_PRICE_ZAR` | `169` | Starter monthly price. |
| `PLAN_PRO_PRICE_ZAR` | `529` | Pro monthly price. |
| `PLAN_AGENCY_PRICE_ZAR` | `1399` | Agency monthly price. |
| `TRIAL_DAYS` | `30` | Free-trial length in days. |
| `TRIAL_MAX_POSTS` | `1` | Successful cross-posts allowed during trial (one compose → fan-out = ONE). |
| `PLAN_STARTER_MAX_ACCOUNTS` | `1` | Accounts per platform on Starter (`0` = unlimited). |
| `PLAN_PRO_MAX_ACCOUNTS` | `5` | Accounts per platform on Pro. |
| `PLAN_AGENCY_MAX_ACCOUNTS` | `0` | Accounts per platform on Agency (`0` = unlimited). |

See [TESTING_FEATURE_GATING.md](./TESTING_FEATURE_GATING.md).

## Billing

| Var | Default | What it does |
| --- | ------- | ------------ |
| `BILLING_ENABLED` | `false` | Master switch. `false` = no payment, old immediate-trial behaviour. `true` = new signups must choose a plan + add billing before access. |
| `BILLING_PROVIDER` | `mock` | `mock` (no real money, for testing) / `paystack` (live) / `peach` (stub). |
| `BILLING_WEBHOOK_SECRET` | _(blank)_ | Verifies mock/peach webhooks (`X-Billing-Signature`). **Not used by Paystack** (it signs with its secret key). |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | _(blank)_ | Paystack API keys (only when `BILLING_PROVIDER=paystack`). Secret key authorises API calls **and** signs webhooks (HMAC-SHA512) — backend-only. |
| `PAYSTACK_BASE_URL` / `PAYSTACK_CURRENCY` | `https://api.paystack.co` / `ZAR` | Paystack API base + charge currency. See [PAYMENTS_PAYSTACK.md](./PAYMENTS_PAYSTACK.md). |
| `PEACH_ENTITY_ID` / `PEACH_ACCESS_TOKEN` / `PEACH_BASE_URL` | _(blank / test URL)_ | Peach REST creds (only when `BILLING_PROVIDER=peach`; stub). |

See [TESTING_BILLING.md](./TESTING_BILLING.md).

## AI Content Assistant

Primary → fallback provider chain (Gemini → OpenRouter). Off by default;
"available" only when `AI_ENABLED=true` **and** at least one provider key is set.
All read on demand (no restart).

| Var | Default | What it does |
| --- | ------- | ------------ |
| `AI_ENABLED` | `false` | Master switch. `false` → `/api/ai/*` return 503 and the UI hides the feature. |
| `GEMINI_API_KEY` | _(blank)_ | **Primary** provider key (Google AI Studio). |
| `GEMINI_MODEL` | `gemini-1.5-flash` | Gemini model id. |
| `OPENROUTER_API_KEY` | _(blank)_ | **Fallback** provider key (OpenRouter). Used only when Gemini is unconfigured or fails. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Any model slug from openrouter.ai/models. |

**Plan gating** — the AI assistant is a per-plan feature. Each tier has a
boolean override (`true/false`, also `1/0`, `yes/no`); blank/unset uses the
default. Customers whose plan excludes it see an upgrade prompt; the API returns
**403 `upgrade_required`**.

| Var | Default | What it does |
| --- | ------- | ------------ |
| `PLAN_STARTER_AI` | `false` | Starter includes AI? (off by default) |
| `PLAN_PRO_AI` | `true` | Pro includes AI? |
| `PLAN_AGENCY_AI` | `true` | Agency includes AI? |

See [AI_ASSISTANT.md](./AI_ASSISTANT.md).

## Supabase (database + customer auth)

| Var | What it does | Secret? |
| --- | ------------ | ------- |
| `DATABASE_URL` | Pooled connection (Transaction mode, port 6543) — used by the app. | Yes |
| `DIRECT_URL` | Direct connection (port 5432) — used by Prisma migrations. | Yes |
| `SUPABASE_URL` | Project URL. | No |
| `SUPABASE_ANON_KEY` | Public anon key (also in the frontend build — safe). | No |
| `SUPABASE_SERVICE_ROLE_KEY` | **Backend only** — bypasses RLS. Never expose. | **Yes** |

## Administrator login

| Var | Default | What it does |
| --- | ------- | ------------ |
| `ADMIN_USERNAME` | `admin` | Admin login username. |
| `ADMIN_PASSWORD_HASH` | _(placeholder)_ | **bcrypt hash** of the password — never plaintext. Generate: `npm run hash-password -- "your-password"`. |
| `ADMIN_JWT_SECRET` | _(placeholder)_ | Long random string signing admin tokens. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `ADMIN_TOKEN_TTL` | `8h` | How long an admin login stays valid. |

## Connection persistence

| Var | Default | What it does |
| --- | ------- | ------------ |
| `TOKEN_STORE_KEY` | _(blank)_ | If set, OAuth tokens are saved **encrypted** to `.tokens.enc` so connections survive restarts. Blank = in-session only. The app's one deliberate exception to "store nothing". |

## Social platforms (one block each)

Each platform (`FACEBOOK`, `INSTAGRAM`, `YOUTUBE`, `TIKTOK`) has the same shape.
A platform is **enabled only when `<P>_ENABLED=true` AND it has a client id +
secret.** These are the fields editable via the **Admin UI**.

| Field (per `<PLATFORM>_` prefix) | What it does |
| -------------------------------- | ------------ |
| `_ENABLED` | `true`/`false` — show this platform in the app. |
| `_CLIENT_ID` | OAuth app client id (from the platform's developer portal). |
| `_CLIENT_SECRET` | OAuth app secret (**secret** — masked in the Admin UI). |
| `_REDIRECT_URI` | OAuth callback; must exactly match the portal + your origin. |
| `_SCOPES` | Comma- (or space-, for YouTube) separated OAuth scopes. |
| `_API_VERSION` | Graph/API version where applicable. |

**Scopes that unlock Analytics** (add these, then **reconnect** the account so
the new permission is granted):
- Facebook: `read_insights`
- Instagram: `instagram_manage_insights`
- YouTube: `yt-analytics.readonly` (plus, for revenue, the Partner Program +
  the monetary scope — see the Analytics notes)

> **Redirect URI gotcha:** `_REDIRECT_URI` and `FRONTEND_ORIGIN` must line up
> with the URL you actually open the app on. A mismatch is the usual cause of an
> OAuth popup that opens and closes without connecting.

---

## Quick-start: minimum to run

1. `cp backend/.env.example backend/.env`
2. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (via `npm run hash-password`),
   and `ADMIN_JWT_SECRET`.
3. Set the Supabase vars (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and run `npm run db:push`.
4. Enable at least one platform block (`<P>_ENABLED=true` + client id/secret).
5. (Optional) set `SMTP_*` for server-side support email; otherwise `mailto:`
   works out of the box.
6. Leave `BILLING_ENABLED=false` until you're ready to test billing.

Everything else has a working default.
