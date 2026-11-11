# Sign-up → plan → payment flow (requirements)

**Status: proposed / to build.** This documents the desired end-to-end sign-up
experience: collect the customer's details, have them **choose a plan (with
costs shown)**, then **redirect to a payment page to capture bank/card details**
before their account becomes usable.

It also maps the desired flow onto what already exists (the billing "setup gate",
`pending_setup` state, and checkout redirect) so this is an extension, not a
rewrite.

> **Billing model (decided): charge-now.** A successful payment makes the
> customer **`active`** immediately — full, uncapped access, **no trial**. The
> **trial is the "haven't paid yet" fallback**: it only applies to customers who
> have *not* completed payment (and only via an explicit trial path). Paying is
> never routed through a trial. This is already how the backend behaves:
> `payment.succeeded → active`, while `trial.started → trialing` is a separate,
> capped state.

---

## Desired flow (what we want)

```
┌─────────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐   ┌───────────┐
│ 1. Account  │ → │ 2. Choose    │ → │ 3. Review &     │ → │ 4. Payment   │ → │ 5. Done   │
│    details  │   │    plan      │   │    confirm cost │   │   (bank/card)│   │  (ACTIVE  │
│ (name/email │   │ (see prices) │   │                 │   │  on provider │   │  on pay)  │
│  /phone/pw) │   │              │   │                 │   │  hosted page)│   │           │
└─────────────┘   └──────────────┘   └─────────────────┘   └──────────────┘   └───────────┘
```

### Step 1 — Account details
The existing sign-up form: first name, last name, phone, email, password +
confirm (all mandatory, password match enforced). On submit, the Supabase user
is created. **Nothing else changes here.**

### Step 2 — Choose a plan (show costs)
Immediately after the account is created, the customer **must pick a plan before
reaching the app**. They see the three tiers with **prices in ZAR** and what each
includes:

| Plan | Price (ZAR/mo) | Key limits |
| ---- | -------------- | ---------- |
| Starter | R169 | 1 account / platform, basic analytics |
| Pro | R529 | 5 accounts / platform, advanced analytics |
| Agency | R1,399 | unlimited accounts, analytics export |

> Prices and features come from the **plans catalogue** (`GET /api/plans`,
> backed by `config/plans.js` + env). The UI must render them from there — never
> hardcode amounts.

The screen states that choosing a plan and paying activates the subscription
immediately (full access). A **trial** only applies to customers who don't
complete payment — a limited window (`TRIAL_DAYS`, default 30) capped at
`TRIAL_MAX_POSTS` (default 1) successful cross-posts, after which they must pay
to continue.

### Step 3 — Review & confirm cost
A short confirmation showing the selected plan, its monthly ZAR price, and that
the subscription becomes active on payment. One clear **"Continue to payment"**
button.

### Step 4 — Payment (bank/card details)
Redirect to the **payment provider's hosted page** to capture bank/card details.

> **Important (compliance):** card/bank details are entered on the **provider's**
> page, never on our own form. The app never sees, stores, or transmits raw card
> numbers — this keeps us out of PCI scope. We only store a provider
> subscription/customer reference.

On completion the provider redirects back to a return URL; a webhook confirms the
result server-side.

### Step 5 — Done
- Payment succeeds → subscription becomes **`active`** (full, uncapped access).
  **No trial** — paying skips it entirely.
- The customer lands in the app (Compose) with access granted.
- If they **abandon payment**, they stay **`pending_setup`** (gated). The capped
  **trial** is the only no-payment access path, entered via an explicit trial
  action — not by reaching the payment page and leaving.

---

## How this maps onto what exists today

Most of the machinery is already built for billing Layer 1 — the gap is **moving
plan selection into the sign-up flow** and wiring a **real payment page**.

| Flow step | Already exists | To build / change |
| --------- | -------------- | ----------------- |
| 1. Account details | ✅ `CustomerAuthComponent` sign-up (name/phone/email/pw + confirm) | — |
| 2. Choose a plan | ✅ plans catalogue + tier cards on `/billing`; new customers are `pending_setup` and gated | Surface plan choice **right after sign-up** (redirect to a plan step instead of landing on a gated app), ideally as a guided step rather than the generic `/billing` screen |
| 3. Review cost | ⚠️ partial (tier cards show price) | A dedicated confirm step showing selected plan + cost + trial terms |
| 4. Payment page | ✅ `POST /api/customer/billing/subscribe` returns a `redirectUrl`; **mock** provider returns a fake page today | Implement the **real provider** (Peach) hosted checkout so `redirectUrl` is a real bank/card page |
| 5. Done | ✅ webhook-driven `pending_setup → active` on payment (`payment.succeeded`); `requireActiveAccess` gates the app | — |

### The existing state machine (unchanged)

```
                       ┌──payment succeeds──────────────▶ active ──renewal fails──▶ past_due
pending_setup ──pay────┘                                    │
      │                                                     └──cancel──▶ canceled
      │
      └──start trial (no payment)──▶ trialing ──pay──▶ active
                                         │
                                         └──trial expires / no pay──▶ gated
```

- **Pay → `active`** directly (no trial). This is the normal path.
- **`trialing`** is only reached via an explicit "start trial" (the no-payment
  fallback), and paying from a trial also moves to `active`.
- `payment.failed → past_due`, `subscription.canceled → canceled` (both gated).

`BILLING_ENABLED=true` turns this on. With it **off** (today's default), sign-up
grants an immediate trial with no payment — so this paid flow only applies once
billing is enabled.

---

## Concrete changes to implement

1. **Post-signup redirect.** After `signUp()` succeeds (and email is confirmed,
   if confirmation is on), route the customer to a **plan-selection step**
   instead of the app. Because new customers are already `pending_setup`, the
   guard/gate will keep them out of the app until setup completes — we just make
   the *first thing they see* the plan chooser.

2. **Guided plan + cost step.** Either enhance `/billing`'s setup mode or add a
   dedicated `/signup/plan` view that:
   - lists tiers with ZAR prices + features from `GET /api/plans`,
   - states the trial terms,
   - on select → calls `POST /api/customer/billing/subscribe` with a `returnUrl`.

3. **Confirm-cost step (optional but recommended).** Before redirecting, show a
   small summary (plan, R price/mo, "active on payment"). Keeps the charge
   expectation explicit.

4. **Real payment page.** Implement the **Peach** provider adapter so
   `subscribe()` returns a real hosted-checkout `redirectUrl` (bank/card entry).
   Today only the mock provider returns a fake page. See
   [TESTING_BILLING.md](./TESTING_BILLING.md) and the Peach stub in `src/billing/`.

5. **Return + webhook.** On return, read the result; the webhook
   (`POST /api/billing/webhook`, signature-verified, idempotent) is the source of
   truth. A `payment.succeeded` event flips `pending_setup → active` (no trial).

   > Make sure the real provider's "payment succeeded" webhook maps to the
   > `payment.succeeded` event type. Only emit `trial.started` if you deliberately
   > offer a no-payment trial.

---

## Decided

- **Trial vs. charge-now → CHARGE-NOW.** Paying activates the subscription
  immediately (`active`, full access). The trial is the **unpaid fallback** only.
  Implemented: `payment.succeeded → active`; the mock checkout "Pay" uses the
  `paid` outcome (not `trial`).

## Things to decide before building
- **Email confirmation timing:** if Supabase email confirmation is on, the plan
  step happens **after** the user confirms and signs in. If off, it can flow
  straight through. Decide the UX for the confirmation gap.
- **Abandoned setup:** how long may a `pending_setup` account linger, and do we
  prompt/remind? Today it simply stays gated.
- **Plan change later:** the customer can still change tiers afterwards via
  `/billing` → `PUT /api/customer/plan` / re-subscribe.

---

## Out of scope / guardrails

- **No raw bank/card data in our app or DB.** Always use the provider's hosted
  page. We store only a provider reference + subscription status.
- **Prices stay single-source.** Always read from `config/plans.js` via
  `GET /api/plans`; never hardcode amounts in the signup UI.
- **Gating stays server-enforced.** The app remains blocked for `pending_setup`
  regardless of what the UI shows — the client flow is convenience, not the
  security boundary.
