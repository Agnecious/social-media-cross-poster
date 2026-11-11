# Testing the audit log

How to verify that sensitive actions are recorded in `audit_logs` with a
readable actor + target, and surfaced via `GET /api/admin/audit` and the admin
dashboard.

Actions captured:

| Action | Triggered by | Actor | Target |
|--------|--------------|-------|--------|
| `admin.config.update` | Admin edits a platform's config | admin username | platform (e.g. `facebook`) |
| `admin.customer.plan.change` | Admin changes a customer's plan | admin username | affected customer email |
| `customer.plan.change` | Customer changes own plan | customer email | `self` (same as actor) |
| `account.connect` | Customer connects an account | customer email | `platform — label` |
| `account.disconnect` | Customer disconnects an account | customer email | `platform — accountId` |

> **Prerequisite:** run `npm run db:push` so the `audit_logs` table (and the
> `actor_label` / `target_label` columns) exist. Backend on `http://localhost:3000`.
>
> Audit writes are **best-effort** — if the table is missing, the action still
> succeeds and you'll see an `audit write failed` line in the logs instead.

---

## 1. Generate some audit entries

Do a few of these (UI is easiest):

- **Customer plan change:** sign in as a customer → **Plan** → switch tier.
- **Account connect/disconnect:** **Connections** → connect, then disconnect.
- **Admin plan change:** log in as admin → **Admin Dashboard** → change a
  customer's plan in the table.
- **Admin config edit:** **Administrator** → edit a platform's scopes/redirect
  and save.

Each one also prints a live `audit` log line (watch `app.log`):
```json
{"level":"info","msg":"audit","action":"customer.plan.change","actorType":"customer","actorLabel":"alice@example.com","targetType":"customer","targetId":"...","targetLabel":"alice@example.com"}
```

---

## 2. Read the audit log via the admin API

```powershell
# Admin login → token
$login = Invoke-RestMethod -Method Post http://localhost:3000/api/auth/admin/login `
  -ContentType 'application/json' `
  -Body (@{ username = 'admin'; password = 'YOUR_ADMIN_PASSWORD' } | ConvertTo-Json)
$ah = @{ Authorization = "Bearer $($login.token)" }

# Most recent entries
(Invoke-RestMethod "http://localhost:3000/api/admin/audit?limit=20" -Headers $ah).entries |
  Format-Table createdAt, actorType, actorLabel, action, targetLabel
```

Each entry has: `actorType`, `actorId`, `actorLabel`, `action`, `targetType`,
`targetId`, `targetLabel`, `metadata`, `ip`, `createdAt`.

### Filters
```powershell
# By action
Invoke-RestMethod "http://localhost:3000/api/admin/audit?action=customer.plan.change" -Headers $ah |
  Select-Object -ExpandProperty entries | Format-Table actorLabel, targetLabel, @{n='detail';e={$_.metadata | ConvertTo-Json -Compress}}

# By actor type (admin | customer | system)
(Invoke-RestMethod "http://localhost:3000/api/admin/audit?actorType=admin" -Headers $ah).entries.Count
```

### Verify readable labels (the point of the recent fixes)
- A **customer plan change** row: `actorLabel` = the email, `targetLabel` = the
  same email (the dashboard collapses this to **"self"**), `metadata` =
  `{ from, to, subscriptionStatus }`.
- An **admin plan change** row: `actorLabel` = admin username, `targetLabel` =
  the **affected customer's email**, `metadata` = `{ from, to }`.
- A **config edit** row: `targetLabel` = platform; `metadata.fields` lists the
  **field names** changed — confirm **no secret values** appear anywhere.

---

## 3. In the admin dashboard

Open **Admin Dashboard** → **Audit log** table. Columns: When, Actor, Action,
Target, Detail. Confirm:
- Actor shows `customer: alice@example.com` / `admin: admin` (not a bare UUID).
- Target shows the email / platform / `platform — label`, and **"self"** when
  the customer acted on themselves.
- Detail shows `starter → pro`, or the changed config field names.

---

## 4. Durability & safety checks

- **Survives deletion:** the labels are stored on the row at write time, so an
  entry stays readable even after the referenced customer is deleted (there's
  no FK). You can confirm by deleting a test customer in Supabase and seeing
  the old audit rows still show their email.
- **No secrets:** inspect a `admin.config.update` row's `metadata` — it must
  contain only field names (e.g. `{"fields":["clientSecret","redirectUri"]}`),
  never the secret values.
- **Best-effort:** audit failures never break the action — the user's plan
  change / connect still succeeds regardless of the audit write.

---

## Checklist
- [ ] `npm run db:push` applied (table + label columns exist)
- [ ] Each action (config edit, admin plan change, customer plan change, connect, disconnect) creates a row
- [ ] `GET /api/admin/audit` returns entries; `?action=` and `?actorType=` filters work
- [ ] Actor/target show emails/usernames, not UUIDs; self-change shows "self"
- [ ] Config-edit metadata lists field names only — no secret values
- [ ] 401 without an admin token
