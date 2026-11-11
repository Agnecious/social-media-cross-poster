# AI Content Assistant

Turns one piece of content into platform-optimized posts, rewrites, hashtags,
titles and translations. Two AI providers sit behind a **primary → fallback**
chain so the feature keeps working if one provider is down, misconfigured, or
blocked:

- **Primary: Google Gemini** — the Generative Language REST API
  (`generativelanguage.googleapis.com`), authenticated with a simple API key.
- **Fallback: OpenRouter** — an OpenAI-compatible gateway to many models, used
  only when Gemini is unconfigured or its call fails.

> **Tools (all shipped).** Ten tools in two phases:
> - **Core:** Generate platform content · Rewrite · Hashtags · Titles · Translate
> - **Advanced:** CTA generator · Content analysis (clarity/readability/engagement
>   scoring + suggestions) · Content expansion · Content shortening · Complete
>   content pack (everything in one click)
>
> Each tool is just a prompt-builder in `AiService` + a thin route; they all
> share the same provider chain, plan gate, rate limit and audit.

---

## How it fits the existing design

The AI layer mirrors the **Strategy pattern** already used for payment
providers (`BillingProvider`) and platform publishers (`PlatformPublisher`):

```
routes/ai.js
  -> services/AiService.js        (product logic: prompts + JSON parsing)
       -> ai/index.js             (factory + generateWithFallback)
            -> ai/GeminiProvider.js      (primary)   } both implement
            -> ai/OpenRouterProvider.js  (fallback)  } ai/AiProvider.js
                 -> services/http.js     (shared axios client w/ timeout)
```

- **`AiProvider`** — the abstract contract. One method: `complete({ system,
  user, maxTokens, temperature }) -> text`. Providers know nothing about
  "hashtags" or "platforms".
- **`AiService`** — all the product logic. Each tool composes a system + user
  prompt that demands **strict JSON**, calls the provider chain, then parses the
  result defensively (`extractJson` strips code fences / surrounding prose).
- **`generateWithFallback`** — tries Gemini first, then OpenRouter. Only
  *configured* providers (those with an API key) are attempted. If all fail, the
  last error surfaces; if none are configured, a clear config error is thrown.

Every outbound call uses the shared `http` client, which has a timeout — so on a
network that blocks egress the call fails fast with a logged error instead of
hanging (the same behaviour as the platform/billing integrations).

---

## Configuration

All read on demand from `.env` (no restart needed), like the other config.

| Variable             | Default               | Purpose                                            |
| -------------------- | --------------------- | -------------------------------------------------- |
| `AI_ENABLED`         | `false`               | Master switch. `false` → endpoints 503, UI hides it |
| `GEMINI_API_KEY`     | —                     | Primary provider key ([AI Studio](https://aistudio.google.com/app/apikey)) |
| `GEMINI_MODEL`       | `gemini-1.5-flash`    | Gemini model id                                    |
| `OPENROUTER_API_KEY` | —                     | Fallback provider key ([OpenRouter](https://openrouter.ai/keys)) |
| `OPENROUTER_MODEL`   | `openai/gpt-4o-mini`  | Any model slug from openrouter.ai/models           |

The feature is **available** only when `AI_ENABLED=true` **and** at least one
provider key is set. You can run with only one provider configured.

---

## Plan gating

The assistant is a **per-plan feature**, defined in the plans catalogue
(`config/plans.js`) alongside the account caps — one source of truth. Each tier
carries a boolean `limits.aiAssistant`, overridable via `PLAN_<TIER>_AI`:

| Plan | Default | Env override |
| ---- | ------- | ------------ |
| Starter | **excluded** | `PLAN_STARTER_AI` |
| Pro | included | `PLAN_PRO_AI` |
| Agency | included | `PLAN_AGENCY_AI` |

Enforcement is **server-side and authoritative**: the generation routes run
behind `requireAiPlan`, which checks `planHasAi(req.customer.plan)` and returns
**403 `{ reason: 'upgrade_required' }`** for a plan that doesn't include it
(unknown/legacy plan ids fall back to the entry tier's capability). `GET
/api/ai/config` reports `planAllowed` (true/false, or null when not signed in /
unreachable) so the UI shows an **upgrade prompt** instead of the tools. The
per-plan flag is also exposed in `GET /api/plans` (`limits.aiAssistant`) and
reflected as an "AI Content Assistant" feature line on Pro/Agency.

---

## API

All generation routes are customer-scoped and run behind `requireCustomer` +
`requireActiveAccess` (a live subscription/trial) + an availability guard
(503 when AI is off/unconfigured) + a plan guard (`requireAiPlan`, 403
`upgrade_required`) + a rate limit (20 requests / 5 min / IP). The customer's
Supabase token is attached automatically by the frontend `customer-auth`
interceptor. Every call records a light audit line (tool used + which provider
answered — **no content is stored**). `GET /api/ai/config` is soft-authenticated
(works without a token; adds `plan`/`planAllowed` when one is present).

| Method | Path                        | Body                                              | Returns |
| ------ | --------------------------- | ------------------------------------------------- | ------- |
| GET    | `/api/ai/config`            | —                                                 | `{ enabled, configured, available, plan, planAllowed, platforms[], tones[], expandFormats[], shortenFormats[] }` |
| POST   | `/api/ai/platform-content`  | `{ content, platforms?[], tone? }`                | `{ result: { facebook?, instagram?, linkedin?, tiktok?, youtubeTitle?, youtubeDescription?, hashtags[] }, provider }` |
| POST   | `/api/ai/rewrite`           | `{ content, tone }`                               | `{ rewritten, provider }` |
| POST   | `/api/ai/hashtags`          | `{ content }`                                     | `{ hashtags[], provider }` |
| POST   | `/api/ai/titles`            | `{ content, count? }` (3–15, default 7)           | `{ titles[], provider }` |
| POST   | `/api/ai/translate`         | `{ content, targetLanguage }`                     | `{ translated, provider }` |
| POST   | `/api/ai/ctas`              | `{ content, goal?, count? }` (3–15, default 8)    | `{ ctas[], provider }` |
| POST   | `/api/ai/analyze`           | `{ content }`                                     | `{ analysis: { clarity, readability, engagement, overall, summary, suggestions[] }, provider }` |
| POST   | `/api/ai/expand`            | `{ content, format, tone? }`                      | `{ expanded, provider }` |
| POST   | `/api/ai/shorten`           | `{ content, format }`                             | `{ shortened, provider }` |
| POST   | `/api/ai/complete-pack`     | `{ content, platforms?[], tone? }`                | `{ pack: { posts{}, hashtags[], titles[], ctas[], summary }, provider }` |

**Platforms:** `facebook`, `instagram`, `linkedin`, `tiktok`, `youtube`.
**Tones:** `professional`, `casual`, `corporate`, `sales`, `educational`,
`funny`, `motivational`.
**Expand formats:** `marketing_copy`, `product_announcement`, `long_form_post`,
`landing_page`. **Shorten formats:** `short_caption`, `summary`, `social_post`,
`sms` (hard-capped at 160 chars). **Analysis scores** are 0–100 integers.

Error mapping: validation problems → **400**; provider/parse failures → **502**;
feature off/unconfigured → **503**; not entitled → **402**.

---

## Admin health check (reachability)

The admin dashboard's **System status** panel shows an **AI assistant** tile so a
config-only "looks fine" can't hide an egress block. Like the Supabase tile, it
does a real network probe — `checkAiReachable()` (`src/ai/index.js`) pings the
configured provider host(s) in the primary → fallback order (`provider.ping()`
is a cheap GET that treats any HTTP response as reachable; only a thrown
connection error means blocked). The probe runs **only** on the admin deep
health check (`GET /api/admin/health` → `checkReadiness({ deep: true })`), not on
the public `/api/ready` liveness path.

The tile has four states:

| State | When | Shown |
| ----- | ---- | ----- |
| **Off** | `AI_ENABLED=false` | grey "Off" (not a problem) |
| **No provider key** | on, but no key set | red ⚠ — the assistant can't run |
| **Unreachable** | on + configured, but the host can't be reached | red ⚠ — generations will fail from this network |
| **Reachable** | on + configured + host responded | green, with provider + latency |

This is what surfaces the corporate-network egress block for AI, the same way the
Supabase tile surfaces it for customer auth.

## Frontend

- **Route:** `/ai` (`AiAssistantComponent`, `customerGuard`-protected), linked
  from the main nav as **AI Assistant**.
- Tabbed UI (one tab per tool), signal-based state, results render as copy-able
  cards with a **Copy** / **Copy all** action. The page checks
  `GET /api/ai/config` on load and shows an "unavailable" panel when AI is off
  or unconfigured, so customers never hit a dead button.
- Service: `core/services/ai.service.ts`; types: `core/models/ai.model.ts`.

---

## Notes & limits

- Input is capped at **6000 characters** per request (cost/latency control).
- Prompts instruct the models to return strict JSON; `extractJson` repairs the
  common "wrapped in a code fence / extra prose" cases, but a model can still
  occasionally return something unparseable → the request fails with a 502 and
  the customer can retry.
- **This network blocks outbound HTTPS from the backend** (the same block that
  affects Supabase, SMTP and OAuth). Gemini and OpenRouter calls will fail here
  until you run on an unrestricted network or add an egress proxy — the feature
  is coded and builds clean, but can't be exercised end-to-end from the blocked
  environment.

## Extending

Adding a new tool is a four-touch change, no provider work: a prompt-building
method in `AiService` (strict-JSON prompt + defensive parse), a route in
`routes/ai.js` (reuse `...genGuards` + `handle()`), a method in the frontend
`ai.service.ts`, and a tab in `AiAssistantComponent`. All ten current tools
follow exactly this shape.

Possible future ideas: scheduled/bulk generation, brand-voice presets saved per
customer, and image-prompt generation.
