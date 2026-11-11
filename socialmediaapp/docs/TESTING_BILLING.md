# Testing billing (Layer 1, mock provider — no real money)

How to exercise the whole subscribe → trial → cap → paid/cancel lifecycle using
the **mock** provider, with zero real charges and no Peach account.

## What this covers

- New signups are `pending_setup` → **blocked** until they choose a plan + pay.
- Choosing a plan redirects to a **simulated hosted-checkout page**
  (`/mock-checkout`); clicking **Pay** makes the customer **`active`** — full
  access, **no trial** (charge-now model).
- The **trial** is the *unpaid* fallback (reached via an explicit "Start trial"),
  allowing **`TRIAL_MAX_POSTS`** successful cross-posts (default 1). One
  compose → fan-out counts as ONE.
- Webhook-driven state: `payment.succeeded → active`, `payment.failed → past_due`,
  `subscription.canceled → canceled`. Blocked states can't publish/connect.

> **Everything is off by default.** With `BILLING_ENABLED=false` (the default)
> the app keeps the old no-payment behaviour. The steps below assume you turn it on.

---

## 0. Prerequisites

1. Apply the schema (new tables/columns):
   ```powershell
   cd backend; npm run db:push
   ```
2. Enable billing in `backend/.env` and restart:
   ```
   BILLING_ENABLED=true
   BILLING_PROVIDER=mock
   TRIAL_MAX_POSTS=1
   # optional: BILLING_WEBHOOK_SECRET=some-dev-secret
   ```
3. Start backend + frontend. (Grab a customer token for API calls the same way
   as in TESTING_FEATURE_GATING.md — DevTools → Local Storage →
   `sb-...-auth-token` → `access_token`; then `$h = @{ Authorization = "Bearer $t" }`.)

---

## 1. New signup is blocked until setup (UI)

1. Sign up a fresh customer and sign in.
2. Try to go to **Compose** and publish, or **Connections** and connect — the
   action is blocked with **402** and a "Choose a plan…" message linking to **/billing**.
3. Check status via API:
   ```powershell
   Invoke-RestMethod http://localhost:3000/api/customer/billing -Headers $h | ConvertTo-Json -Depth 5
   ```
   Expect `subscriptionStatus: "pending_setup"`, `access.allowed: false`,
   `access.reason: "pending_setup"`.

---

## 2. Choose a plan → checkout page → pay → ACTIVE

> **Billing model: charge-now.** Paying makes the customer **`active`**
> immediately (full access, no trial). The **trial is the "haven't paid yet"
> fallback** — reached only via an explicit trial action, never by paying.

### UI
On **Plan & Billing**, the setup gate shows. Click **Choose Pro** (or any tier):

1. A brief "Redirecting to checkout…" toast, then the browser navigates to a
   **simulated hosted-checkout page** (`/mock-checkout`) — a full-screen payment
   page showing the plan + ZAR price and a (fake, inert) card form. This stands
   in for the real provider's hosted page.
2. Click **Pay** → it completes the mock payment and returns to `/billing` with
   **"Payment successful — your subscription is active."** `subscriptionStatus`
   is now **`active`** (no trial). Clicking **Cancel** returns without paying —
   you stay `pending_setup` (gated).

> To exercise the **trial** path instead (unpaid fallback), use the
> **Mock billing (dev)** panel on `/billing` → **Start trial**, or the API below
> with `outcome: "trial"`.

### API (equivalent)
```powershell
# Start checkout — returns a redirect URL to the (mock) hosted checkout page
Invoke-RestMethod -Method Post http://localhost:3000/api/customer/billing/subscribe `
  -Headers $h -ContentType 'application/json' `
  -Body '{"plan":"pro","returnUrl":"http://localhost:4200/billing"}' | ConvertTo-Json
# redirectUrl → http://localhost:4200/mock-checkout?plan=pro&sub=...&ret=...

# "Pay" on that page calls mock/complete with outcome=paid → ACTIVE
Invoke-RestMethod -Method Post http://localhost:3000/api/customer/billing/mock/complete `
  -Headers $h -ContentType 'application/json' -Body '{"outcome":"paid"}' | ConvertTo-Json -Depth 5
# → subscriptionStatus: "active", access.allowed: true

# (Trial fallback — only if you want to test the unpaid trial path)
# Invoke ... -Body '{"outcome":"trial"}'  → subscriptionStatus: "trialing"
```

---

## 3. Trial post cap (1 cross-post)

> This section tests the **trial** (unpaid) path. Put the customer in `trialing`
> first via `/billing` → **Mock billing (dev)** → **Start trial** (or
> `mock/complete` with `outcome: "trial"`). A `paid`/`active` customer has
> **no** post cap — this gate only applies while `trialing`.

1. In **Compose**, connect an account, select it, and **Publish** once. It
   succeeds, and `trial.postsUsed` becomes 1.
2. Try to publish again → **402** `{ reason: "trial_post_limit" }` with an
   "Upgrade to keep posting" message.
3. Confirm:
   ```powershell
   (Invoke-RestMethod http://localhost:3000/api/customer/billing -Headers $h).trial
   # postsUsed = 1, maxPosts = 1, publishAllowed = false
   ```

> One compose → fan-out to several platforms counts as **one** post. Scheduled
> posts don't count against the trial (only immediate publishes).

---

## 4. Convert to paid (active) → full access

Simulate a successful payment webhook. Two ways:

**Dev shortcut (mock complete):**
```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/customer/billing/mock/complete `
  -Headers $h -ContentType 'application/json' -Body '{"outcome":"paid"}' | ConvertTo-Json -Depth 5
```
Or in the UI: the **Mock billing (dev)** panel → **Mark paid (active)**.

Now `subscriptionStatus: "active"`, publishing is unlimited again.

**Real webhook path (what Peach will use later):**
```powershell
# Simulate the provider POSTing a webhook (include the secret if you set one)
Invoke-WebRequest -Method Post http://localhost:3000/api/billing/webhook `
  -ContentType 'application/json' `
  -Headers @{ 'X-Billing-Signature' = 'some-dev-secret' } `
  -Body (@{ eventId = 'evt_1'; type = 'payment.succeeded'; customerId = 'CUSTOMER_UUID' } | ConvertTo-Json) `
  -UseBasicParsing | Select-Object StatusCode, Content
```
- Re-POST the **same `eventId`** → response `{ ok: true, duplicate: true }` (idempotency works).
- A wrong/missing signature (when a secret is set) → **400**.

---

## 5. Failed payment / cancel → blocked

```powershell
# Payment failed → past_due (blocked)
Invoke-RestMethod -Method Post http://localhost:3000/api/customer/billing/mock/complete `
  -Headers $h -ContentType 'application/json' -Body '{"outcome":"failed"}'

# Canceled → blocked
Invoke-RestMethod -Method Post http://localhost:3000/api/customer/billing/mock/complete `
  -Headers $h -ContentType 'application/json' -Body '{"outcome":"canceled"}'
```
In each case, publishing/connecting returns **402** with the matching reason
(`past_due` / `canceled`), and the Plan screen shows the blocked banner with a
prompt to choose a plan again.

---

## 6. Audit + prices

- Each billing action writes an audit row — check the Admin Dashboard **Audit
  log** for `billing.checkout.start` and `billing.mock.complete`.
- Prices come from the catalogue (`plans.js` / `GET /api/plans`) — the billing
  screen never hardcodes amounts. Change `PLAN_PRO_PRICE_ZAR`, restart, and the
  plan cards reflect it.

---

## Checklist
- [ ] `npm run db:push` applied; `BILLING_ENABLED=true`, `BILLING_PROVIDER=mock`
- [ ] New signup is `pending_setup` and blocked (402) from publish/connect
- [ ] Choose plan → **visible `/mock-checkout` page** → **Pay** → `active` (no trial), access allowed
- [ ] **Cancel** on the checkout page → stays `pending_setup` (still gated)
- [ ] Trial path (dev "Start trial") → `trialing`: 1 cross-post allowed, 2nd → 402 `trial_post_limit`
- [ ] `paid` → `active`, unlimited posting
- [ ] Webhook idempotency (same eventId → duplicate), bad signature → 400
- [ ] `failed` → `past_due`, `canceled` → `canceled` both block with correct reason
- [ ] Audit log shows billing events; prices match the catalogue

> When you have a Peach account: set `BILLING_PROVIDER=peach` + `PEACH_*` creds
> and fill in `PeachBillingProvider` (startCheckout/verifyWebhook/parseWebhookEvent).
> Nothing else changes — the state machine, endpoints, gating and UI stay the same.
