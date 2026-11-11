# Platform OAuth setup & going live

How to connect each social platform's OAuth, the **testing-mode gotchas** that
block connections during development, and — most importantly — the
**verification steps required before going to production** so real users (not
just you) can connect.

> **TL;DR for production:** every platform starts in a restricted "test/dev"
> mode where only accounts *you* whitelist can connect. To let the public
> connect, you must **publish + pass the platform's app review** (privacy
> policy, demo video, scope justification). This takes days–weeks per platform,
> so start early. See [Going live](#going-live-production-checklist).

---

## How OAuth works in this app (shared pattern)

Each platform is an OAuth 2.0 "Web application" client. The app never stores
passwords — the user logs in on the platform's own site and grants scopes.

Per-platform `.env` keys (see [CONFIGURATION.md](./CONFIGURATION.md)):

```
<PLATFORM>_ENABLED=true
<PLATFORM>_CLIENT_ID=...
<PLATFORM>_CLIENT_SECRET=...
<PLATFORM>_REDIRECT_URI=http://localhost:3000/api/auth/<platform>/callback
<PLATFORM>_SCOPES=...
```

**The redirect URI is the #1 source of errors.** It must match **character for
character** between your `.env` and what's registered in the platform's
developer console — same scheme (`http` vs `https`), host (`localhost` vs
`127.0.0.1`), **port 3000** (the backend, not the 4200 frontend), no trailing
slash, and pasted into the **"redirect URI"** field (not "JavaScript origins").
A mismatch yields errors like Google's `Error 400: redirect_uri_mismatch`.

> **Important — API key ≠ OAuth client.** An **API key** only reads public data
> and **cannot** be used here. This app needs an **OAuth Client ID + Client
> Secret** (created separately under the console's "Credentials → OAuth client
> ID → Web application").

---

## YouTube / Google (console.cloud.google.com)

### Dev setup (one-time)
1. **APIs & Services → Library** → enable **YouTube Data API v3** and
   **YouTube Analytics API**.
2. **OAuth consent screen** → User type **External**; fill app name, support
   email, developer email; add scopes:
   - `https://www.googleapis.com/auth/youtube.upload` (upload videos — **sensitive**)
   - `https://www.googleapis.com/auth/yt-analytics.readonly` (analytics)
3. **Credentials → Create Credentials → OAuth client ID → Web application**;
   add redirect URI **exactly**:
   `http://localhost:3000/api/auth/youtube/callback`
4. Copy the **Client ID + Secret** into `.env` (`YOUTUBE_CLIENT_ID` /
   `YOUTUBE_CLIENT_SECRET`), restart the backend.

### Testing mode gotcha (what you hit)
While the consent screen is in **"Testing"**, only **test users** you list can
connect — everyone else sees *"…has not completed the Google verification
process… can only be accessed by developer-approved testers."*

- Fix during dev: **OAuth consent screen → Audience → Test users → Add users**,
  enter the Google/YouTube account email you'll connect with (including your
  own). Up to **100** test users. Save, retry.
- Known quirk: in Testing mode, **refresh tokens can expire after 7 days** — fine
  for dev, another reason to verify before production.

### Going live (Google verification) — **do before public launch**
To let *any* user connect, **OAuth consent screen → Publish app** (→ "In
production"). Because `youtube.upload` is a **sensitive** scope, publishing
triggers **Google's OAuth verification**, which requires:
- A hosted **privacy policy** URL (and terms) on your production domain.
- **Domain verification** (Search Console) of the app's homepage + privacy
  policy domain.
- A **demo video** showing the full OAuth flow and how each scope is used.
- **Justification** for every scope requested.
- Review time: **days to several weeks**. Until approved, the app shows an
  "unverified app" warning (and restricted scopes may be blocked).

Also update the **redirect URI** (console + `.env` `YOUTUBE_REDIRECT_URI`) to
the real domain, e.g. `https://app.yourdomain.com/api/auth/youtube/callback`.

---

## Facebook & Instagram / Meta (developers.facebook.com)

### Dev setup
- Create an app; add **Facebook Login**; set the redirect URIs
  (`.../api/auth/facebook/callback`, `.../api/auth/instagram/callback`).
- Scopes in `.env` already include what's needed (publishing + `read_insights` /
  `instagram_manage_insights` for analytics).
- Instagram requires a **Business/Creator** account linked to a Facebook **Page**.

### Testing mode gotcha
A Meta app in **Development mode** only works for people with a **role** on the
app (Admin/Developer/Tester). Add testers under **App Roles → Roles**. Others
can't connect until the app is Live + reviewed.

### Going live (Meta App Review) — **do before public launch**
- Switch the app to **Live**, and submit the advanced permissions for
  **App Review**: `pages_manage_posts`, `pages_read_engagement`, `read_insights`,
  `instagram_content_publish`, `instagram_manage_insights`, etc.
- Requires: **Business Verification**, a privacy policy URL, a screencast
  demoing each permission, and valid use-case descriptions.
- Review time: **days to weeks**. Unreviewed permissions only work for app
  roles.

---

## TikTok (developers.tiktok.com)

### Dev setup
- Create an app; add the **Content Posting API**; register the redirect URI
  (`.../api/auth/tiktok/callback`); scopes `video.publish`, `video.upload`.

### Testing mode gotcha
TikTok apps start **unaudited** — only the app's own registered test accounts
can post, and the Content Posting API is limited until approval.

### Going live (TikTok App Review) — **do before public launch**
- Submit the app for **review/approval** for production posting; TikTok requires
  app details, scope justification, and often a demo. Review time varies.

---

## Going live (production) checklist

When you move off `localhost` to a real domain, for **each enabled platform**:

- [ ] **Host a privacy policy + terms** on the production domain (required by
      all three for review).
- [ ] **Update redirect URIs** in every platform console to the production URL
      (`https://.../api/auth/<platform>/callback`) **and** update the matching
      `<PLATFORM>_REDIRECT_URI` in `.env`. Keep `http://localhost:...` too if you
      still test locally.
- [ ] **Serve over HTTPS** (platforms require https redirect URIs in production).
- [ ] **YouTube/Google:** publish the consent screen + pass OAuth verification
      (privacy policy, domain verification, demo video, scope justification).
- [ ] **Meta:** switch app to Live + complete App Review + Business
      Verification for the publish/insights permissions.
- [ ] **TikTok:** complete app review for the Content Posting API.
- [ ] Start each review **early** — they run days to weeks and are the long pole
      for launch.
- [ ] Rotate any dev client secrets if they were ever shared (see
      [SECURITY.md](../SECURITY.md)).

> These platform reviews are independent of your own app's billing/hardening
> work. Track them alongside the production items in
> [MULTI_TENANT_PLAN.md](./MULTI_TENANT_PLAN.md).

---

## Quick troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Error 400: redirect_uri_mismatch` | Redirect URI not registered / not identical | Add the **exact** `.../api/auth/<platform>/callback` to the console's redirect URIs; match scheme/host/port, no trailing slash |
| "…can only be accessed by developer-approved testers" (Google) | Consent screen in **Testing** | Add the account under **Test users**, or publish + verify for production |
| "Access blocked: this app's request is invalid" | Bad OAuth params (usually redirect URI, or wrong client type) | Ensure a **Web application** OAuth client; check redirect URI |
| Connect popup opens then does nothing | `FRONTEND_ORIGIN` / redirect origin mismatch, or **backend can't reach the platform** (blocked egress) | Match origins; test from an unrestricted network |
| Only you can connect, nobody else | App still in test/dev mode | Publish + pass the platform's review |
