# Testing feature gating (plan limits & trial)

How to verify the two enforced entitlements:

1. **Per-plan account caps** — a plan limits how many accounts you can connect
   per platform (`PLAN_STARTER_MAX_ACCOUNTS=1`, `PLAN_PRO_MAX_ACCOUNTS=5`,
   `PLAN_AGENCY_MAX_ACCOUNTS=0`=unlimited; `0` defers to the global
   `MAX_ACCOUNTS_PER_PLATFORM`).
2. **Trial / subscription gate** — once the free trial expires and the
   subscription isn't `active`, connecting accounts and publishing are blocked
   with **HTTP 402**.

> Customer-scoped endpoints require a **Supabase access token**, which is
> awkward to mint from a script. So the easiest path is the **UI**; an
> API-with-token path is given where useful. Backend on `http://localhost:3000`.
>
> **Grab a customer token** (for the API examples): sign in to the app, open
> DevTools → Application → Local Storage → the `sb-...-auth-token` entry →
> copy `access_token`. Then in PowerShell:
> ```powershell
> $t = "PASTE_ACCESS_TOKEN"
> $h = @{ Authorization = "Bearer $t" }
> ```

---

## A. Per-plan account caps

### Setup
In `backend/.env`, make the cap small so it's easy to hit, and restart:
```
PLAN_STARTER_MAX_ACCOUNTS=1
```
Make sure your test customer is on **Starter** (the default; or set it on the
Plan screen).

### UI test
1. Go to **Connections**. The hint reads "0 of 1 account(s) connected on your plan."
2. Connect one Facebook account → hint becomes "1 of 1", and **Connect**
   becomes disabled with "Limit reached."
3. (If you force a second via API — see below — you get a 409.)

### API test
```powershell
# Connecting a 2nd account for a platform already at the cap → 409
Invoke-WebRequest -Method Put `
  "http://localhost:3000/api/tokens/facebook/test-account-2" `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ auth = @{ accessToken = 'dummy' }; label = 'second' } | ConvertTo-Json) `
  -UseBasicParsing -SkipHttpErrorCheck | Select-Object StatusCode, Content
```
Expected **409**:
```json
{ "error": "Account limit reached: your plan allows at most 1 facebook account(s). Upgrade your plan to connect more.", "reason": "limit", "max": 1 }
```

### Confirm the cap follows the PLAN (not a global constant)
1. On the **Plan** screen, upgrade the customer to **Pro** (cap 5).
2. Reload **Connections** — the hint now reads "… of 5". You can connect more.
3. The authoritative cap is also returned by `GET /api/tokens`:
   ```powershell
   (Invoke-RestMethod http://localhost:3000/api/tokens -Headers $h).maxAccountsPerPlatform
   ```
   Starter → `1`, Pro → `5`, Agency → `0` (then it falls back to the global
   `MAX_ACCOUNTS_PER_PLATFORM`).

### Unit-level check (no HTTP/token needed)
Proves the resolution logic and env overrides directly:
```powershell
cd backend
$env:PLAN_STARTER_MAX_ACCOUNTS="2"; $env:MAX_ACCOUNTS_PER_PLATFORM="7"
node --input-type=module -e "import('./src/services/AccountService.js').then(async a=>{const p=await import('./src/config/plans.js'); console.log('starter', p.planAccountCap('starter')); console.log('agency (0 -> global)', a.effectiveAccountCap('agency'));})"
Remove-Item Env:\PLAN_STARTER_MAX_ACCOUNTS, Env:\MAX_ACCOUNTS_PER_PLATFORM
```
Expected: `starter 2`, `agency (0 -> global) 7`.

---

## B. Trial / subscription gate (402)

The gate blocks **connect** (`PUT /api/tokens/...`) and **publish**
(`POST /api/publish`) when the trial has expired AND `subscriptionStatus` isn't
`active`.

### Check current status
```powershell
Invoke-RestMethod http://localhost:3000/api/customer/subscription -Headers $h | ConvertTo-Json
```
Shows `trialActive`, `trialDaysLeft`, `subscriptionStatus`.

### Force the trial to be EXPIRED
There's no admin endpoint for this by design, so set it directly in the DB
(Supabase → SQL editor), using your customer's email:
```sql
update customers
set trial_ends_at = now() - interval '1 day',
    subscription_status = 'trialing'
where email = 'you@example.com';
```

### Verify the block
- **UI:** reload the app. On **Compose**, Publish fails; on **Connections**,
  Connect fails — both show "Your free trial has ended. Choose a plan to
  continue." with a **→ /billing** link.
- **API:**
  ```powershell
  Invoke-WebRequest -Method Put "http://localhost:3000/api/tokens/facebook/x" `
    -Headers $h -ContentType 'application/json' -Body '{"auth":{"accessToken":"x"}}' `
    -UseBasicParsing -SkipHttpErrorCheck | Select-Object StatusCode, Content
  ```
  Expected **402**:
  ```json
  { "error": "Your free trial has ended. Choose a plan to continue.", "reason": "trial_expired" }
  ```

### Verify choosing a plan UN-blocks
On the **Plan** screen pick any tier (or `PUT /api/customer/plan {"plan":"pro"}`).
Because the trial has ended, `subscriptionStatus` becomes `active`:
```powershell
Invoke-RestMethod -Method Put http://localhost:3000/api/customer/plan `
  -Headers $h -ContentType 'application/json' -Body '{"plan":"pro"}' | ConvertTo-Json
```
Now connect/publish succeed again (`subscriptionStatus: "active"`).

### What should STILL work during an expired trial
Listing and removing accounts are intentionally **not** gated — confirm
`GET /api/tokens` and `DELETE /api/tokens/...` still work so a lapsed customer
can see/manage what they have.

### Cleanup
Restore a future trial (or leave them `active`):
```sql
update customers set trial_ends_at = now() + interval '30 days',
                     subscription_status = 'trialing'
where email = 'you@example.com';
```

---

## Checklist
- [ ] Starter cap 1 → connecting a 2nd account → 409 with `reason: limit`
- [ ] `GET /api/tokens` `maxAccountsPerPlatform` matches the plan (1/5/0)
- [ ] Upgrade to Pro → cap rises to 5 in the UI
- [ ] Expired trial → connect & publish → 402 `trial_expired`; UI shows /billing nudge
- [ ] Expired trial → list/remove accounts still work
- [ ] Choosing a plan after expiry → `active` → connect/publish work again
