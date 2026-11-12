# Mobile / LAN testing guide

How to run the app on a **physical phone or tablet** on the same Wi-Fi as your
dev machine, for real-device responsive and UX testing. Also covers the
**cross-platform Prisma** setup that makes the backend run on macOS/Linux as
well as Windows (the two were set up together).

> TL;DR
> ```bash
> # 1) backend (terminal 1)
> cd backend && npm install && npm run prisma:generate && npm run dev
> # 2) frontend (terminal 2)
> cd frontend && npm install && npm run start:mobile
> # 3) on the phone (same Wi-Fi): open  http://<your-dev-machine-LAN-IP>:4200
> ```

---

## Why a special setup is needed

In normal dev, the frontend calls the backend at `http://localhost:3000/api`
(`src/environments/environment.ts`). That works on your laptop because
`localhost` is the laptop. **On a phone, `localhost` is the phone itself**, so
every API call would fail.

The fix is a **dev-server proxy**: the phone loads the app from
`http://<laptop-ip>:4200` and the Angular dev server (running on the laptop)
forwards all `/api` calls to the backend on `:3000`. The phone only ever talks
to port 4200 — it never needs to know the backend's address.

```
 Phone (browser)                 Dev machine (laptop)
 ┌───────────────┐   HTTP        ┌──────────────────────────────────────┐
 │ http://<ip>:  │ ───────────►  │ ng serve :4200 (0.0.0.0)             │
 │ 4200          │               │   app assets  ───────────────────────┤
 │  calls /api/* │ ───────────►  │   /api/*  ──proxy──►  backend :3000  │
 └───────────────┘               └──────────────────────────────────────┘
        │
        └── Supabase auth calls go phone ──► Supabase directly (not proxied; fine)
```

**Bonus:** because API calls are proxied server-side, the backend sees them
coming from the proxy, not the phone — so there is **no CORS / `FRONTEND_ORIGIN`
change required** for this to work.

---

## What was added

| File | Change | Purpose |
|------|--------|---------|
| `frontend/proxy.conf.json` | **new** | Proxies `/api` → `http://localhost:3000`. |
| `frontend/src/environments/environment.mobile.ts` | **new** | Dev env with a **relative** `apiBaseUrl: '/api'` so calls route through the proxy. |
| `frontend/angular.json` | **edited** | Added a `mobile` **build** configuration (file-replacement to `environment.mobile.ts`) and a `mobile` **serve** configuration (`host: 0.0.0.0` + `proxyConfig`). |
| `frontend/package.json` | **edited** | Added script `start:mobile` → `ng serve --configuration mobile`. |

### `frontend/proxy.conf.json`
```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false,
    "changeOrigin": true,
    "logLevel": "debug"
  }
}
```

### `frontend/src/environments/environment.mobile.ts`
Identical to `environment.ts` except:
```ts
apiBaseUrl: '/api',   // relative — resolved against the phone's origin, then proxied
```

### `frontend/angular.json` (the two additions)
Under `architect.build.configurations`:
```json
"mobile": {
  "optimization": false,
  "extractLicenses": false,
  "sourceMap": true,
  "fileReplacements": [
    { "replace": "src/environments/environment.ts", "with": "src/environments/environment.mobile.ts" }
  ]
}
```
Under `architect.serve.configurations`:
```json
"mobile": {
  "buildTarget": "socialmediaapp:build:mobile",
  "host": "0.0.0.0",
  "proxyConfig": "proxy.conf.json"
}
```

### `frontend/package.json`
```json
"start:mobile": "ng serve --configuration mobile"
```

---

## Step-by-step

### 1. Start the backend
```bash
cd backend
npm install
npm run prisma:generate   # ensures the Prisma engine for THIS OS exists (see below)
npm run dev               # http://localhost:3000
```

### 2. Start the frontend in mobile mode
```bash
cd frontend
npm install
npm run start:mobile      # serves on 0.0.0.0:4200 with the /api proxy
```

### 3. Find your dev machine's LAN IP
- **macOS:** `ipconfig getifaddr en0` (Wi-Fi) — e.g. `192.168.1.42`
- **Windows:** `ipconfig` → the Wi-Fi adapter's **IPv4 Address**
- **Linux:** `hostname -I` (first address)

### 4. Open the app on the phone
On the phone's browser (same Wi-Fi), go to:
```
http://<your-dev-machine-LAN-IP>:4200
```
e.g. `http://192.168.1.42:4200`.

---

## Cross-platform Prisma (why the backend now runs on macOS too)

The backend failed to start on macOS because the Prisma **query-engine binary**
is OS-specific, and it had been generated only for Windows (then copied to the
Mac). The schema now declares all the targets the team needs so
`prisma generate` bundles the right engines:

`backend/prisma/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
  binaryTargets = ["native", "darwin", "darwin-arm64", "windows", "debian-openssl-3.0.x"]
}
```
- `native` — the machine running `prisma generate`
- `darwin` — Intel Mac · `darwin-arm64` — Apple Silicon (M1/M2/M3)
- `windows` — Windows
- `debian-openssl-3.0.x` — the Linux/Docker image

**Rule of thumb:** run `npm run prisma:generate` once per OS. Do **not** copy
`node_modules` between operating systems and expect Prisma to work — the engine
is a native binary; regenerate instead.

---

## Troubleshooting

- **Phone can't load `:4200` at all** — the dev machine's firewall is blocking
  inbound connections to Node on 4200. Allow it (macOS: System Settings →
  Network → Firewall → allow `node`; Windows: allow the app on Private
  networks). Confirm both devices are on the **same** Wi-Fi (and the network
  isn't "client isolation"/guest mode, which blocks device-to-device traffic).
- **App loads but every API call fails** — make sure you started the frontend
  with `npm run start:mobile` (not plain `npm start`), and the backend is
  running on `:3000`. Watch the dev-server console: the proxy logs each `/api`
  request (`logLevel: "debug"`).
- **"Invalid Host header" / blocked host** — the `mobile` serve config sets
  `host: 0.0.0.0`; if a stricter Angular version still rejects the LAN origin,
  add `"allowedHosts": true` to the `mobile` serve configuration in
  `angular.json`.
- **OAuth "Connect <platform>" doesn't finish on the phone** — expected. Each
  platform's redirect URI is registered as `http://localhost:3000/...` in its
  developer console, which the phone can't reach. OAuth connect must be done on
  the laptop (or register a LAN/https redirect URI in the platform console).
  Everything else — composing, the AI assistant, analytics, billing screens,
  navigation, responsive layout — works for on-device testing.
- **Prisma error on macOS/Linux** — run `npm run prisma:generate` on that
  machine. If it mentions a missing engine for your platform, confirm the
  `binaryTargets` above are present in `schema.prisma`.

---

## Production note

This setup is **dev-only**. In production the app is served by nginx (Docker),
which serves the built frontend and proxies `/api` to the backend — see
`docker-compose.yml` and `frontend/nginx.conf`. `environment.prod.ts` already
uses a relative `/api` for that reason.
