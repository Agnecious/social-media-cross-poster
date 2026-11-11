# Account menu, profile editing & password change

How the signed-in customer's **account menu** (the name dropdown in the top
nav), the **Profile** page (edit name/phone), and **password change** work —
end to end, across the frontend and Supabase, with notes on how the backend
stays in sync.

## What this covers

- The top-nav **user dropdown** (avatar + display name → Profile / Plan / Sign out),
  and the matching **admin** dropdown.
- The **`/profile`** page: edit first name, last name, phone (email is read-only).
- **Change password**: current + new + confirm, with the current password
  verified before the change is applied.
- How these changes propagate to the backend `Customer` row automatically.

> There are **no new backend endpoints** for this feature. Profile and password
> updates go directly through the Supabase client; the backend re-syncs on the
> next authenticated request. See [Why no backend changes](#why-no-backend-changes).

---

## 1. The account menu (top-right nav)

When a customer is signed in, the nav no longer shows a bare `Sign out (email)`
button. Instead it shows a **user chip**:

```
[ A ] Aaron Smith ▾
```

- The **avatar** is the first character of the display name.
- The **display name** is resolved in `CustomerAuthService.displayName()` with
  this fallback chain:
  1. `"First Last"` (if either name is set)
  2. the email local-part (text before `@`)
  3. `"Account"`
- Clicking the chip opens a dropdown:
  - **👤 Profile** → `/profile`
  - **💳 Plan & billing** → `/billing`
  - **↪ Sign out**

The **admin** chip (when an admin is logged in) mirrors this:
**📊 Dashboard / ⚙ Platform config / ↪ Admin logout**.

**Behaviour**
- Click the chip to toggle; opening one menu closes the other.
- Clicking anywhere else, or pressing **Escape**, closes the menu
  (`@HostListener('document:click')` / `document:keydown.escape` in
  `AppComponent`).
- The menus are only rendered inside the app chrome, so they don't appear on the
  chromeless routes (landing, `/login`, `/admin-login`).

**Where it lives:** `frontend/src/app/app.component.ts` (template + the
`userMenuOpen` / `adminMenuOpen` signals and `toggle*/close*` methods). Styling
is in `frontend/src/styles.css` under `--- Nav user dropdown ---`.

---

## 2. The Profile page (`/profile`)

Route: `{ path: 'profile', component: ProfileComponent, canActivate: [customerGuard] }`
in `app.routes.ts`. The guard redirects to `/login` if not signed in.

The page (`frontend/src/app/features/profile/`) has two independent cards.

### Card 1 — Profile details
- **Email** — shown **read-only**. It's the Supabase sign-in identity and isn't
  editable here.
- **First name**, **Last name**, **Phone** — editable; all three are required
  before **Save changes** enables.
- On save → `CustomerAuthService.updateProfile({ firstName, lastName, phone })`.

### Card 2 — Change password
- **Current password**, **New password**, **Confirm new password**.
- **Update password** enables only when: current is filled, new is ≥ 6
  characters, and new === confirm. A mismatch shows a red inline
  "Passwords don't match." and keeps the button disabled.
- On save the component:
  1. calls `verifyPassword(current)` — re-authenticates to confirm identity,
  2. then `updatePassword(new)`,
  3. clears the three fields and toasts success.

Both cards use toast notifications for success/failure.

---

## 3. CustomerAuthService API (frontend)

File: `frontend/src/app/core/services/customer-auth.service.ts`. Backed by the
Supabase browser (anon) client, which operates on the **currently signed-in
user**.

**Reactive signals (derived from the Supabase session):**

| Signal            | Meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `isAuthenticated` | session is present                                   |
| `email`           | user's email                                         |
| `firstName`       | `user_metadata.firstName`                            |
| `lastName`        | `user_metadata.lastName`                             |
| `phone`           | `user_metadata.phone`                                |
| `displayName`     | friendly name (see the fallback chain above)         |
| `authReady`       | true once the initial session restore has completed  |

**Methods:**

- `updateProfile({ firstName, lastName, phone })`
  → `supabase.auth.updateUser({ data: {...} })`. Writes the fields to the user's
  **`user_metadata`** (the same keys used at sign-up), then reflects the fresh
  user into the local session signal so the nav/UI update immediately.
- `updatePassword(newPassword)`
  → `supabase.auth.updateUser({ password })`.
- `verifyPassword(currentPassword)`
  → `supabase.auth.signInWithPassword({ email, password })`; throws
  "Current password is incorrect." on failure. Used as an identity re-check
  before a password change.

The profile keys are **exactly** `firstName`, `lastName`, `phone` — the same
ones `signUp()` stores — so edits stay consistent with what was captured at
registration.

---

## 4. How the backend stays in sync

### Why no backend changes

Profile and password updates are performed client-side via Supabase. Supabase is
the source of truth for auth + `user_metadata`. The backend doesn't need a
profile endpoint because of how `requireCustomer` already works:

- Every customer-scoped API request carries the Supabase JWT (attached by
  `customerAuthInterceptor`).
- `requireCustomer` (backend) verifies the token, reads
  `user.user_metadata.{firstName,lastName,phone}`, and **upserts** them into the
  local `Customer` row:

  ```js
  prisma.customer.upsert({
    where:  { id: user.id },
    update: { email, firstName, lastName, phone }, // re-mirrored every request
    create: { ...createData },
  });
  ```

So the moment a customer edits their profile and then hits any authenticated
endpoint (Compose, Connections, Billing, etc.), the `Customer` row is refreshed
with the new values. No manual write, no extra route, no risk of the two stores
drifting apart.

### Data flow (profile edit)

```
Profile page  ──updateProfile()──▶  Supabase user_metadata (source of truth)
     │                                        │
     │ session signal refreshes               │ next authenticated API request
     ▼                                        ▼
 Nav / UI update instantly        requireCustomer upserts Customer row (DB)
```

### Data flow (password change)

```
Profile page ──verifyPassword(current)──▶ Supabase (identity re-check)
             └─updatePassword(new)──────▶ Supabase Auth (password stored/hashed)
```

Passwords are managed entirely by Supabase Auth — the app never stores or sees
the password hash.

---

## 5. Files involved

| File | Role |
| ---- | ---- |
| `frontend/src/app/core/services/customer-auth.service.ts` | Profile/password signals + `updateProfile` / `updatePassword` / `verifyPassword` |
| `frontend/src/app/features/profile/profile.component.ts` / `.html` | The Profile page (details + password cards) |
| `frontend/src/app/app.routes.ts` | `/profile` route (customerGuard) |
| `frontend/src/app/app.component.ts` | Nav user/admin dropdowns + open/close logic |
| `frontend/src/styles.css` | Dropdown + profile page styles |
| `backend/src/middleware/requireCustomer.js` | Re-mirrors Supabase metadata → `Customer` row (no change needed) |

---

## 6. Manual test checklist

1. **Sign in.** The top-right nav shows your name chip (not an email button).
2. **Open the chip.** It drops down with Profile / Plan & billing / Sign out.
   Click elsewhere or press Escape — it closes.
3. **Profile → edit.** Change your first name, Save. A success toast appears and
   the nav name updates immediately.
4. **Verify DB sync.** Hit any app page (e.g. Compose) and then check the admin
   dashboard customer table (or the DB) — the new name is reflected.
5. **Change password — mismatch.** Type different new/confirm values: the field
   goes red and the button stays disabled.
6. **Change password — wrong current.** Enter a wrong current password: you get a
   "Current password is incorrect." error toast; password is unchanged.
7. **Change password — success.** Correct current + matching new (≥ 6 chars):
   success toast, fields clear. Sign out and back in with the new password.
8. **Admin chip.** Log in as admin: the admin chip shows Dashboard / Platform
   config / Admin logout and behaves the same way.
