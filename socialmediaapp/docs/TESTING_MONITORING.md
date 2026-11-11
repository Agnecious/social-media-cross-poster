# Testing the monitoring features

How to verify the health/readiness probes, the admin System status panel, and
the error-capture behaviour added in the Monitoring milestone. Commands are
PowerShell (the project's shell); adjust quoting for bash.

> Assumes the backend runs on `http://localhost:3000` (the default `PORT`). If
> you changed `PORT`, substitute it below.

---

## 0. Start the backend

```powershell
cd backend
node src/server.js *> app.log      # all logs (JSON lines) go to app.log
```

In a second terminal you can tail the log while testing:

```powershell
Get-Content backend\app.log -Wait -Tail 20
```

On startup you should see a `backend started` line, e.g.:

```json
{"ts":"...","level":"info","msg":"backend started","port":3000,"version":"dev","enabledPlatforms":["facebook"],"logLevel":"debug"}
```

---

## 1. Liveness — `GET /api/health`

Should always return **200** while the process is up. No auth.

```powershell
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json
```

Expected (shape):

```json
{
  "status": "ok",
  "version": "dev",
  "uptimeSeconds": 12,
  "timestamp": "2026-10-26T20:00:00.000Z",
  "enabledPlatforms": ["facebook"]
}
```

Checks:
- HTTP 200.
- `uptimeSeconds` increases if you call it again a few seconds later.
- `version` reflects `APP_VERSION` from `.env` (or `dev` if unset). Set
  `APP_VERSION=1.2.3`, restart, and confirm it changes.

To see the status code explicitly:

```powershell
(Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing).StatusCode   # 200
```

---

## 2. Readiness — `GET /api/ready`

Returns **200** when dependencies are healthy, **503** when not. This is the
one a load balancer / k8s readiness probe should hit. No auth.

```powershell
# -SkipHttpErrorCheck lets us see the body even on a 503 (PowerShell 7+)
Invoke-WebRequest http://localhost:3000/api/ready -UseBasicParsing -SkipHttpErrorCheck |
  Select-Object StatusCode, Content
```

Expected when healthy (**200**):

```json
{
  "ready": true,
  "checks": {
    "database": { "ok": true, "latencyMs": 42 },
    "supabase": { "ok": true, "configured": true }
  },
  "timestamp": "..."
}
```

> Note: the first DB ping after startup can take a few seconds (cold pooler
> connection over the network); subsequent calls are fast.

### Simulate a FAILED readiness (the important test)

This proves `/api/ready` actually gates on the DB rather than always saying OK.

1. Stop the backend.
2. Temporarily break the DB connection — in `backend/.env`, point
   `DATABASE_URL` at a bad host/port, e.g. change the port to `6544`:
   ```
   DATABASE_URL=postgresql://...@...pooler.supabase.com:6544/postgres?pgbouncer=true
   ```
3. Start the backend and call it again:
   ```powershell
   Invoke-WebRequest http://localhost:3000/api/ready -UseBasicParsing -SkipHttpErrorCheck |
     Select-Object StatusCode, Content
   ```
   Expected (**503**):
   ```json
   {
     "ready": false,
     "checks": {
       "database": { "ok": false, "latencyMs": 5000, "error": "..." },
       "supabase": { "ok": true, "configured": true }
     },
     "timestamp": "..."
   }
   ```
4. **Restore** the correct `DATABASE_URL` and restart. Confirm `/api/ready` is
   200 again.

> `/api/health` (liveness) should STAY 200 throughout step 3 — that's the point
> of separating them: a DB blip shouldn't make an orchestrator kill the pod,
> only stop routing new traffic.

To test "supabase missing": blank out `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`,
restart, and `checks.supabase.configured` becomes `false` (the DB is still the
hard gate, so `ready` stays tied to the DB).

---

## 3. Admin System status — `GET /api/admin/health`

Admin-only. First log in to get a token, then call the endpoint.

```powershell
# Log in (use your ADMIN_USERNAME / password from .env; default user is 'admin')
$login = Invoke-RestMethod -Method Post http://localhost:3000/api/auth/admin/login `
  -ContentType 'application/json' `
  -Body (@{ username = 'admin'; password = 'YOUR_ADMIN_PASSWORD' } | ConvertTo-Json)

# Call the protected health endpoint with the Bearer token
Invoke-RestMethod http://localhost:3000/api/admin/health `
  -Headers @{ Authorization = "Bearer $($login.token)" } | ConvertTo-Json -Depth 5
```

Expected (shape):

```json
{
  "ready": true,
  "checks": { "database": { "ok": true, "latencyMs": 40 }, "supabase": { "ok": true, "configured": true } },
  "metrics": {
    "version": "dev",
    "nodeVersion": "v24.x",
    "uptimeSeconds": 120,
    "memory": { "rssMb": 72, "heapUsedMb": 13, "heapTotalMb": 19 }
  },
  "timestamp": "..."
}
```

Without a token you should get **401**:

```powershell
Invoke-WebRequest http://localhost:3000/api/admin/health -UseBasicParsing -SkipHttpErrorCheck |
  Select-Object StatusCode    # 401
```

### In the UI

1. Start the frontend (`cd frontend; npm start`) and open the app.
2. Go to **Administrator**, log in.
3. Open the **Admin Dashboard** — the **System status** panel shows chips:
   Ready/Degraded, DB up/down + latency, Supabase, Uptime, Version, Memory, Node.
4. Repeat the "break the DB" test from section 2 and reload the dashboard — the
   DB chip should show **down** and the status should read **Degraded**.

---

## 4. Error capture

Every unhandled error is funnelled through `captureException` and logged (and
forwarded to Sentry if `SENTRY_DSN` is set).

### Express error handler
Trigger a 500 and confirm it's logged while the client only gets a generic
message (no stack leak). Any route that throws works; watch `app.log` for:

```json
{"level":"error","msg":"exception","where":"express","reqId":"...","path":"/api/...","error":{"name":"...","message":"...","stack":"..."}}
```

The HTTP response body to the client should be the generic
`{"error":"Internal server error"}` — confirm the stack is in the log, NOT the
response.

### Process-level handlers
`unhandledRejection` and `uncaughtException` are captured. Quick isolated check
with a throwaway script (doesn't affect the app):

```powershell
cd backend
# unhandled rejection is logged via captureException, process keeps running
node -e "import('./src/services/monitoring.js').then(m => { m.installProcessHandlers(); Promise.reject(new Error('test-rejection')); setTimeout(()=>process.exit(0), 200); })"
```

You should see an `exception` log line with `"where":"unhandledRejection"`.

### Sentry wiring (optional)
Set `SENTRY_DSN=<dsn>` in `.env` and restart. With `LOG_LEVEL=debug` you'll see
a `sentry forward (stub)` debug line when an error is captured — confirming the
hook fires. Actually sending requires installing `@sentry/node` and
uncommenting the forward in `services/monitoring.js`.

---

## 5. Quick checklist

- [ ] `GET /api/health` → 200, version/uptime present
- [ ] `GET /api/ready` → 200 with `database.ok: true`
- [ ] Break `DATABASE_URL` → `/api/ready` → 503, `/api/health` still 200
- [ ] Restore `DATABASE_URL` → `/api/ready` → 200
- [ ] `GET /api/admin/health` → 401 without token, 200 with token
- [ ] Admin Dashboard shows the System status panel (and Degraded when DB down)
- [ ] An error produces an `exception` log line; client gets a generic message

> Reminder: set `LOG_LEVEL` back to `info` for production (it's `debug` during
> active debugging), and set `APP_VERSION` to a real release value.
