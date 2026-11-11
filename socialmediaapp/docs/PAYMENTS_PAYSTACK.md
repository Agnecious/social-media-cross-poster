# Paystack billing integration

How the **Paystack** payment provider is wired in, how to configure it, and how
to test it. Paystack was chosen as the live provider (Africa-based payouts,
good developer experience, Stripe-backed). The app stays provider-agnostic, so
this is one adapter selected by `BILLING_PROVIDER=paystack`.

> **Charge-now model.** A successful Paystack payment makes the customer
> **`active`** (full access, no trial). The trial is the *unpaid* fallback. See
> [SIGNUP_FLOW.md](./SIGNUP_FLOW.md).

---

## How it fits the existing design

Nothing structural changed — the `BillingProvider` interface, the subscription
state machine, the routes, gating, and UI are all unchanged. Paystack is a new
adapter (`PaystackBillingProvider`) selected by the factory:

```
BILLING_PROVIDER=paystack  →  PaystackBillingProvider
                 mock      →  MockBillingProvider   (visible fake checkout)
                 peach     →  PeachBillingProvider  (stub)
```

The flow (same as every provider):
```
/billing → subscribe → startCheckout() → redirect to Paystack hosted page
        → customer pays → Paystack redirects back to returnUrl
        → Paystack POSTs a signed webhook → state machine → active
```

The app **never** sees card data — Paystack hosts the payment page.

---

## Configuration

From the **Paystack dashboard → Settings → API Keys & Webhooks**. Use the
**TEST** keys in dev (`sk_test_…` / `pk_test_…`), LIVE keys in production.

```
# backend/.env
BILLING_ENABLED=true
BILLING_PROVIDER=paystack
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx   # backend-only; also signs webhooks
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxx
PAYSTACK_BASE_URL=https://api.paystack.co
PAYSTACK_CURRENCY=ZAR                  # ZAR | NGN | GHS | USD | KES … (must be enabled on your account)
```

Then **register the webhook URL** in that same dashboard screen:
```
https://<your-domain>/api/billing/webhook
```
(For local testing, expose your backend with a tunnel — e.g. ngrok — and use
that HTTPS URL, since Paystack must reach it from the internet.)

Restart the backend after changing `.env`.

> **Secret key = webhook signer.** Paystack signs each webhook as
> `HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)` in the `x-paystack-signature`
> header. There is **no separate webhook secret** — `BILLING_WEBHOOK_SECRET` is
> not used by Paystack. Keep the secret key backend-only.

---

## How the adapter works (`backend/src/billing/PaystackBillingProvider.js`)

- **`startCheckout()`** → `POST /transaction/initialize` with the customer email,
  `amount` in minor units (price × 100 — kobo/cents), `currency`, a unique
  `reference`, `callback_url` (our returnUrl), and `metadata { customerId, plan }`.
  Returns Paystack's `authorization_url` as the `redirectUrl`.
- **`verifyWebhook(req)`** → recomputes `HMAC-SHA512(req.rawBody, secretKey)` and
  constant-time-compares it to `x-paystack-signature`. Uses the **raw body**
  captured by the `express.json({ verify })` hook in `server.js` (re-serialising
  would break the hash).
- **`parseWebhookEvent(body)`** → maps Paystack events onto our internal types:

  | Paystack event | Internal type | Result |
  | -------------- | ------------- | ------ |
  | `charge.success` | `payment.succeeded` | → **active** |
  | `subscription.create` | `subscription.activated` | → active |
  | `invoice.payment_failed` | `payment.failed` | → past_due |
  | `subscription.disable` / `subscription.not_renew` | `subscription.canceled` | → canceled |

  `customerId` + `plan` are read from the `metadata` we set at initialize;
  `eventId` is composed from the event name + reference for idempotency (our
  `PaymentEvent` unique `(provider, eventId)` makes duplicates a no-op).

- **`cancelSubscription(code, { token })`** → `POST /subscription/disable` with
  the Paystack subscription code + email token (both captured from the
  `subscription.create` webhook and stored on the `Subscription` row). Stops
  future charges.

### Recurring (auto-renew until cancel)
This adapter uses **Paystack Plans** so subscriptions **auto-renew monthly until
the customer cancels**:

1. Each tier maps to a Paystack **Plan** (amount + `monthly` interval). The
   adapter resolves-or-creates the Plan on demand (`#resolvePlanCode`) and caches
   its `plan_code`. The Plan name is `<planId>-<CUR>-<amount>`, so a **price
   change makes a new Plan** rather than silently keeping the old amount.
2. `startCheckout` passes `plan: <plan_code>` to `transaction/initialize`. When
   the first charge succeeds, **Paystack auto-creates a subscription** on that
   card and keeps charging every interval.
3. The **`subscription.create`** webhook carries the `subscription_code` +
   `email_token` — we persist them (`providerSubscriptionId` + `providerToken`
   on the `Subscription` row) so we can cancel later.
4. Each renewal fires another `charge.success` → stays `active`. A failed
   renewal → `invoice.payment_failed` → `past_due`.

### Cancelling
- Customer clicks **Cancel subscription** on `/billing` (shown on the active
  banner) → `POST /api/customer/billing/cancel`.
- Backend `cancelSubscription()` calls Paystack `subscription/disable` with the
  stored code + token (best-effort; a provider error doesn't block the local
  cancel), then marks the customer + subscription **`canceled`** (access gated).
- Paystack also emits `subscription.disable` / `subscription.not_renew`
  webhooks → both normalise to `subscription.canceled` (idempotent).

> **Schema:** this added a nullable `providerToken` column to the `Subscription`
> model — run **`npm run db:push`** before using Paystack.

---

## Local testing (test mode, on your laptop — no real money)

Paystack **test mode** lets you run the full flow locally with fake cards and
zero charges. Three pieces: test keys, a tunnel for webhooks, and a test card.

### 0. First, can your machine even reach Paystack?
Restricted/corporate networks sometimes block outbound HTTPS to external APIs.
Check with the built-in diagnostic (admin-authenticated):
```
GET /api/admin/billing-check
```
- `{ reachable: true, authOk: true }` → good to go.
- `{ reachable: true, authOk: false }` → network is fine, but the key is wrong.
- `{ reachable: false, error: "ETIMEDOUT" | "ECONNREFUSED" | "ENOTFOUND" }` →
  **this network blocks Paystack**. Do the test from an unrestricted network
  (home wifi / mobile hotspot).

### 1. Test keys
From the Paystack dashboard → Settings → API Keys & Webhooks, copy the **test**
keys. In `backend/.env`:
```
BILLING_ENABLED=true
BILLING_PROVIDER=paystack
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYSTACK_CURRENCY=ZAR
```
Then apply the schema + restart:
```
cd backend
npm run db:push        # adds the providerToken column
npm start
```

### 2. Expose the backend for webhooks (the key local step)
Paystack confirms payment by POSTing a webhook to your backend — but it must
reach you from the public internet, and your backend is on `localhost:3000`.
Tunnel it:
```
ngrok http 3000
```
Copy the HTTPS URL it prints (e.g. `https://abc123.ngrok-free.app`) and set it in
the Paystack dashboard → Webhooks:
```
https://abc123.ngrok-free.app/api/billing/webhook
```

### 3. Run the flow
1. Sign up a customer → `/billing` → **Choose a plan** → redirected to
   Paystack's hosted checkout.
2. Pay with a **Paystack test card** (from their docs, e.g.
   `4084 0840 8408 4081`, any future expiry, any CVV).
3. Paystack redirects back to `/billing`; the `charge.success` +
   `subscription.create` webhooks arrive → customer becomes **`active`** with a
   recurring subscription. Verify:
   ```powershell
   (Invoke-RestMethod http://localhost:3000/api/customer/billing -Headers $h).subscriptionStatus
   # → active
   ```
4. Hit **Cancel subscription** on `/billing` → Paystack `subscription/disable` is
   called and the status becomes `canceled`.
5. Check the Admin **Audit log** for `billing.checkout.start` / `billing.cancel`.

> **Without a tunnel:** you can still see the checkout + pay with the test card,
> but the status won't auto-flip to `active` (that relies on the webhook, by
> design). The tunnel is what makes it end-to-end.

> **No Paystack keys handy / blocked network?** Keep `BILLING_PROVIDER=mock` —
> the visible `/mock-checkout` page simulates the exact same flow (choose plan →
> pay → active) with no keys, no tunnel, no network dependency.

---

## Going live

- Swap test keys for **LIVE** keys (`sk_live_…` / `pk_live_…`) and update the
  webhook URL to your production `https://…/api/billing/webhook`.
- Complete Paystack's account activation/compliance for live payments.
- Confirm `PAYSTACK_CURRENCY` is enabled on your account for your target markets.
- Serve over HTTPS (Paystack requires reachable HTTPS webhooks).
