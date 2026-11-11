# Testing the security hardening

How to verify the hardening pass: security headers, admin-login rate limiting,
request body / upload size limits, and generic (non-leaking) error messages.

> Backend on `http://localhost:3000`. PowerShell examples. See also
> [../SECURITY.md](../SECURITY.md) for the posture overview and rotation
> checklist.

---

## 1. Security headers

Every response should carry the hardening headers, and `X-Powered-By` should be
gone.

```powershell
$r = Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing
$r.Headers | Format-Table -AutoSize
```

Confirm:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: geolocation=(), camera=(), microphone=()`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- **No** `X-Powered-By` header (Express's default is disabled)

Quick assertion:
```powershell
'X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Content-Security-Policy' |
  ForEach-Object { "$_ = $($r.Headers[$_])" }
"X-Powered-By present? " + $r.Headers.Contains('X-Powered-By')   # should be False
```

### HSTS (HTTPS only)
`Strict-Transport-Security` is sent **only** over HTTPS (or when a trusted proxy
sets `X-Forwarded-Proto: https`). Over plain `http://localhost` it should be
**absent** — that's correct. To see it appear without real TLS, simulate the
proxy header:
```powershell
(Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing `
  -Headers @{ 'X-Forwarded-Proto' = 'https' }).Headers['Strict-Transport-Security']
# max-age=31536000; includeSubDomains
```

> Note: the OAuth callback (`/api/auth/:platform/callback`) deliberately sends a
> *looser* CSP with a per-request nonce so its inline bridge script can run.
> That's expected — see the connect flow docs.

---

## 2. Admin-login rate limiting (429)

The admin login is limited to **10 attempts / 15 min per IP**. The 11th within
the window is rejected with **429**.

```powershell
# Fire 12 bad logins and print each status
1..12 | ForEach-Object {
  $s = (Invoke-WebRequest -Method Post http://localhost:3000/api/auth/admin/login `
    -ContentType 'application/json' -Body '{"username":"x","password":"y"}' `
    -UseBasicParsing -SkipHttpErrorCheck).StatusCode
  "attempt $_`t=> $s"
}
```

Expected: the first 10 return **401** (bad credentials), then **429** for the
rest. A 429 response also carries a `Retry-After` header and
`X-RateLimit-Remaining: 0`:
```powershell
$r = Invoke-WebRequest -Method Post http://localhost:3000/api/auth/admin/login `
  -ContentType 'application/json' -Body '{"username":"x","password":"y"}' `
  -UseBasicParsing -SkipHttpErrorCheck
$r.StatusCode; $r.Headers['Retry-After']; $r.Headers['X-RateLimit-Remaining']
```

> The window is in-process. To reset immediately, restart the backend. (Only
> the login path is limited — normal API calls are not.)

---

## 3. Request body size limit (413)

JSON/form bodies are capped at **100 kb**. A larger JSON body → **413**.

```powershell
# ~200 kb JSON payload to a JSON endpoint
$big = '{"x":"' + ('a' * 200000) + '"}'
Invoke-WebRequest -Method Post http://localhost:3000/api/usage `
  -ContentType 'application/json' -Body $big `
  -UseBasicParsing -SkipHttpErrorCheck | Select-Object StatusCode, Content
```
Expected **413** `{ "error": "Request is too large." }`.

A normal small body to the same endpoint should succeed (200):
```powershell
Invoke-WebRequest -Method Post http://localhost:3000/api/usage `
  -ContentType 'application/json' -Body '{"type":"pageview","path":"/test"}' `
  -UseBasicParsing | Select-Object StatusCode
```

---

## 4. Upload size limit (413)

Media uploads are capped at `MAX_UPLOAD_MB` (default 100), one file per request.
Easiest way to test is to lower the cap so you don't need a 100 MB file:

1. In `backend/.env` set `MAX_UPLOAD_MB=1` and restart.
2. In the UI (**Compose**), attach an image larger than 1 MB and try to
   publish — the request is rejected with **413** ("Request is too large.").
   (You'll need a connected account + selected destination for the button to be
   enabled; the size check fires when the file streams to the backend.)
3. Restore `MAX_UPLOAD_MB=100` and restart.

> The upload cap is enforced by multer before the handler runs; the central
> error handler maps it to a clean 413 (no stack trace).

---

## 5. Generic error messages (no leakage)

Customer-facing failures must return a generic message while the detail goes to
the server log only.

- **Publish failure:** when a platform publish fails, the client gets
  `{ "results": [...] }` with a generic per-target error, and the server log has
  the full reason (`publish: some targets failed` / `publish error`). It should
  never return a stack trace or raw upstream payload.
- **Targets failure:** `POST /api/platforms/:p/targets` for a broken account
  returns `"Could not load destinations for this account. Please try
  reconnecting it."` — not the raw Graph API error (which is logged instead).
- **Any 500:** the body is `{ "error": "Internal server error" }`; the stack is
  in the log under `msg: "unhandled error"` / `exception`.

Spot-check that a 500 body carries no stack:
```powershell
# (hit any endpoint you can force to error) — body should be generic:
# { "error": "Internal server error" }
```

---

## Checklist
- [ ] Headers present: nosniff, frame DENY, referrer no-referrer, CSP; no X-Powered-By
- [ ] HSTS absent over http, present with X-Forwarded-Proto: https
- [ ] 11th admin login in the window → 429 with Retry-After
- [ ] >100 kb JSON body → 413
- [ ] Oversized upload (with MAX_UPLOAD_MB lowered) → 413
- [ ] Errors return generic messages; detail only in the logs
