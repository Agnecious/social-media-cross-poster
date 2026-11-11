# Contact support & analytics export

Two customer-facing features:

1. **Contact support** — a plan-aware "email us" action whose subject encodes the
   customer's name, plan, and priority. The destination inbox is **configurable**.
2. **Analytics CSV export** — an **Agency-plan** perk to download the loaded
   insights as a spreadsheet-ready CSV.

---

## 1. Contact support

### How it works

There's **no mail server involved**. The action opens the customer's own mail
client via a `mailto:` link with the subject and body pre-filled — dependency-free,
no SMTP, no secrets, works immediately. The customer just hits send.

**Where to find it:**
- The **user dropdown** (top-right nav) → **✉ Contact support** → the dedicated
  **Support page** (`/support`).
- The **Profile** page has a small **"Need help? Contact support →"** link to the
  same page.

The Support page (`/support`, customer-guarded) is a standalone view — separate
from Profile, which now only holds account details + password. It shows the
customer's current priority and either an in-app message form or the mail-client
button depending on config (see below).

### The subject line (name + plan + priority)

The subject is built in `SupportService.openContactEmail()`:

```
[<Priority> priority] <Name> — <Plan> plan — Support request
```

e.g. `[High priority] Jane Doe — Agency plan — Support request`

Priority is derived from the plan in `priorityForPlan()`:

| Plan              | Priority     |
| ----------------- | ------------ |
| Agency            | **High**     |
| Pro               | **Normal**   |
| Starter / trial   | **Standard** |

The body is pre-filled with the customer's name, account email, plan, priority,
and a "How can we help?" prompt.

### Configuring the destination inbox

The address is read from the backend env var **`SUPPORT_EMAIL`** and defaults to
`mathema.business@gmail.com`:

```
# backend/.env
SUPPORT_EMAIL=mathema.business@gmail.com
```

- Backend: `supportEmail()` in `backend/src/config/index.js` (read on demand, so
  changing `.env` + restart is enough — no code change).
- It's served to the frontend via **`GET /api/app-config`** (alongside `theme`):
  ```json
  { "theme": "light", "supportEmail": "mathema.business@gmail.com" }
  ```
- Frontend: `AppConfigService` fetches `/app-config` once at startup and exposes
  `supportEmail` as a signal. `SupportService` uses it as the `mailto:` target.

> If the backend is unreachable, the frontend falls back to the same default so
> the button still works.

### Files

| File | Role |
| ---- | ---- |
| `backend/src/config/index.js` | `supportEmail()` config helper |
| `backend/src/routes/appConfig.js` | serves `supportEmail` in `GET /api/app-config` |
| `backend/.env(.example)` | `SUPPORT_EMAIL` setting |
| `frontend/src/app/core/services/app-config.service.ts` | fetches + caches the config (support email signal) |
| `frontend/src/app/core/services/support.service.ts` | builds the `mailto:` (subject + priority + body) + `sendMessage()` |
| `frontend/src/app/features/support/support.component.*` | the standalone Support page (`/support`) — form or mailto button |
| `frontend/src/app/features/profile/profile.component.html` | the "Need help? Contact support →" link to `/support` |
| `frontend/src/app/app.component.ts` | the dropdown "Contact support" link (→ `/support`) |

### Server-side send (optional, config-gated)

By default the feature uses `mailto:` (zero config). If you configure **SMTP**,
the app instead sends the email **directly from the server** — the customer
types their message into an in-app form and never leaves the site.

**It's additive and gated:** when SMTP isn't configured, everything falls back
to the `mailto:` behaviour. Nothing breaks either way.

**How the two modes are chosen:**
- Backend `mailConfig().enabled` is true only when `SMTP_HOST` + `SMTP_USER` +
  `SMTP_PASS` are all set. It's surfaced to the frontend as `mailEnabled` in
  `GET /api/app-config`.
- Frontend: on the **Support page** (`/support`), when `mailEnabled` is true it
  shows a **message form** (textarea → **Send message**); when false it shows the
  **✉ Contact support** button that opens the mail client. Either way the entry
  point (dropdown + Profile link) is the same — the page itself picks the mode.

**The send path:**
1. The form POSTs to **`POST /api/customer/support`** (`{ message }`), with the
   Supabase JWT attached automatically (URL matches `/api/customer/`).
2. The route (`requireCustomer`) derives **name, plan, and priority
   server-side** from the authenticated customer — the client can't spoof them.
3. It's **rate-limited** (5 messages / 15 min / IP, via `rateLimit.js`) and the
   message is **length-capped** (4000 chars).
4. `MailService.sendSupportEmail()` sends via nodemailer to `SUPPORT_EMAIL`, with
   the customer's email as **Reply-To** (so you reply straight to them).
5. If mail isn't configured, the route returns **503** and the frontend
   transparently falls back to `mailto:`.

**Configuring Gmail (one-time):**
1. On the Google account (e.g. `mathema.business@gmail.com`), enable
   **2-Step Verification**.
2. Create an **App Password** (Google Account → Security → App passwords) — a
   16-character code. This is NOT your normal login password.
3. In `backend/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=mathema.business@gmail.com
   SMTP_PASS=<the 16-char app password>
   SMTP_FROM=mathema.business@gmail.com   # optional; defaults to SMTP_USER
   ```
4. Restart the backend. The Support page (`/support`) now shows the in-app form.

> **Gmail limits & deliverability:** a regular Gmail account sends ~500/day,
> which is fine for support volume. For higher volume or better inbox
> placement, point the same SMTP settings at a transactional provider
> (SendGrid / Postmark / SES) — no code change, just different credentials.

**Server-send files (in addition to the ones above):**

| File | Role |
| ---- | ---- |
| `backend/src/config/index.js` | `mailConfig()` (SMTP settings + `enabled`) |
| `backend/src/services/MailService.js` | nodemailer transport + `sendSupportEmail()` (builds subject server-side) |
| `backend/src/routes/customer.js` | `POST /api/customer/support` (rate-limited, validated, 503 → mailto fallback) |
| `backend/.env(.example)` | `SMTP_HOST/PORT/USER/PASS/FROM` |
| `frontend/.../support.service.ts` | `sendMessage()` + `serverSendEnabled` |
| `frontend/.../features/support/support.component.*` | the `/support` page — form vs button based on `mailEnabled` |

---

## 2. Analytics CSV export (Agency only)

### How it works

On the **Analytics** page, Agency customers get a **⬇ Export CSV** button on the
gradient header. It flattens every **loaded** account's metrics — across all
categories, including monetisation — into a CSV and downloads it **client-side**
(no server round-trip), via a `Blob` + temporary `<a download>`.

CSV columns:

```
Platform, Account, Category, Metric, Value, Period (days)
```

The file is named `analytics-YYYY-MM-DD.csv`.

### Plan gating

- The component reads the customer's plan (`PlansService.subscription()`), and
  `canExport = plan === 'agency'`.
- **Agency**: the real **Export CSV** button shows. It's disabled until at least
  one account's insights have been loaded (nothing to export otherwise).
- **Non-Agency**: instead of the button, a muted **"⬇ Export · Agency"** chip
  links to `/billing`, signalling it's an upgrade perk.

Only metrics you've actually **loaded** (pressed "Load insights" for) are
included — the export reflects exactly what's on screen.

### Files

| File | Role |
| ---- | ---- |
| `frontend/src/app/features/analytics/analytics.component.ts` | plan gating (`canExport`), `exportCsv()`, CSV + download helpers |
| `frontend/src/app/features/analytics/analytics.component.html` | the Export button / upgrade chip |

---

## Manual test checklist

**Contact support — mailto mode (no SMTP configured)**
1. Sign in, open the top-right dropdown → **Contact support**. Your mail client
   opens with a subject like `[<priority>] <you> — <plan> plan — Support request`
   addressed to `SUPPORT_EMAIL`.
2. On an **Agency** account the priority is **High**; **Pro** → Normal; Starter/
   trial → Standard.
3. Change `SUPPORT_EMAIL` in `backend/.env`, restart the backend, reload — the
   address shown on the Support page (and used in the email) updates.

**Contact support — server-send mode (SMTP configured)**
4. Set the `SMTP_*` vars (see the Gmail steps above) and restart the backend.
5. Open **/support** (dropdown → Contact support). It now shows a **message
   form**. Type a message → **Send message** → a success toast appears and the
   email lands in `SUPPORT_EMAIL` with the plan/priority subject and your address
   as Reply-To.
6. Rate limit: sending more than 5 messages in 15 minutes returns a "Too many
   support messages" error.

**Analytics export**
4. As an **Agency** customer: load insights for an account, then **Export CSV** →
   a `.csv` downloads with the loaded metrics. Before loading anything the button
   is disabled.
5. As a **non-Agency** customer: you see the **Export · Agency** chip linking to
   `/billing` instead of the button.
