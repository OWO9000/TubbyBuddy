# API reference

Base: `http://<host>:8787/api` (port from `PORT`, default 8787). All bodies are JSON unless noted.
Source: `backend/src/app.ts` and `backend/src/routes/*.ts`.

## Conventions
- **Profile id** (`deviceId` in the API): sent as the `x-device-id` header, `body.deviceId` or `?deviceId=`. 4 to 128 chars
  of `[A-Za-z0-9._:-]`. Endpoints marked *device* need it; unknown ids are created on first use.
- **Accounts**: once a profile belongs to a Google account, every request that names it must also send
  `Authorization: Bearer <session token>` for that account, or it gets `401 {error:"sign_in_required"}`. Guest and demo
  profiles keep working with the id alone. The check runs for every id in the header, body and query.
- **Errors**
  - `400 {error:"validation_error", issues:[...]}`: input failed the zod schema
  - `4xx {error:"<message>", details?}`: business errors (402 not enough points, 403, 404, 409, 413, 415, 429)
  - `429 {error:"rate_limited", retryAfterSec}` + `Retry-After` header: a write rate limit was hit (see below)
  - `502 {error:"model_api_error", upstreamStatus, message}`: the Meta API failed
  - `503 {error:"META_MODEL_API_KEY is not set on the server"}`
  - `404 {error:"not_found"}`: unknown `/api` path
- **Write rate limits** (per device id, falling back to client IP; fixed 1-hour window; in-process):
  all mutating `/api` calls share a generous cap (default 600/hour), and sensitive endpoints add their own:
  `/points/earn` and `/points/burn` 240/hour, `/guard/unlock` 30/hour, `/offers/:id/redeem` 30/hour,
  `/store/buy` 60/hour, `/assistant/chat` 40/hour, `/cosmetic/generate` 10/hour. Reads (GET/HEAD/OPTIONS) are
  never limited. Defaults are env-tunable (`RATE_LIMIT_*`); `RATE_LIMITS=off` disables them for load tests.
  The server-side anti-farm rules still apply on top of these limits.
- **`Me` object** (returned by `/me` and merged into many responses):
  `{app, deviceId, balance, streak, bestStreak, lastStreakDay, achievements:[{id,name,emoji,description,unlocked,progress,detail}], ownedCosmetics:[Cosmetic], equipped:{color?:id, accessory?:id}, redemptions:[{id,code,status,points,at,title,business}] (last 10), recent:[{delta,kind,reason,at}] (last 20)}`
  `progress` is 0–1 and `detail` is a human string such as `3 / 10`.
- **`Cosmetic`**: `{id, name, slot: "color"|"accessory", price, emoji, imageUrl, generated}`
- **`Offer`**: `{id, business, title, description, category, items:[{name,price}], discountPercent, monthlyCap, pointsPrice, terms, imageUrl, source, redeemedThisMonth?, createdAt}`
- **`CoachSettings`**: `{tone:"warm"|"direct"|"playful"|"calm", brevity:"short"|"balanced", nudges:"off"|"sometimes"|"often", goals:string[] (≤6), apps:string[] (≤12)}`

## Health

### `GET /api/health`
Is the server up and which AI layers are live.
Response: `{ok:true, app, tagline, model, imageModel, metaConfigured, aiMode:"live"|"demo", assistantConfigured, assistantMode:"live"|"demo", assistantModel, googleSignIn, stale}`. `stale` is true when the server's code changed on disk after it started (restart it).

## Accounts (Sign in with Google)

Enabled when `GOOGLE_CLIENT_ID` is set. Only the `openid`, `email` and `profile` scopes are used.

### `GET /api/auth/config`
`{google: boolean, googleClientId: string|null}`

### `POST /api/auth/google`
Body: `{credential, deviceId?, label?}`. `credential` is the ID token from Google's button; the server checks its
signature, issuer, audience and expiry. A first sign-in keeps the progress of `deviceId` (unless it's a demo profile or
already owned). Response: `{token, isNew, account:{name, email, picture, profileId, onboarded}}`. The client then uses
`profileId` as its device id and sends the token as a bearer header. 30/hour per IP.

### `GET /api/auth/session` (bearer)
`{account}` or `401`.

### `POST /api/auth/logout` (bearer)
Ends that session only.

### Signing in the phone and Windows apps
1. The app calls `POST /api/auth/link` with `{label}` and gets `{code, url, expiresAt}` (8 characters, 10 minutes).
2. It opens `url` (`/link?code=…`) in the browser. The person signs in with Google there and confirms
   (`GET /api/auth/link/:code/info` shows which app is asking; `POST /api/auth/link/:code/approve` with their bearer
   token approves it).
3. The app polls `GET /api/auth/link/:code`: `{status:"pending"}`, then once `{status:"approved", token, account}`. The
   token is handed over a single time; after that the code reads as `expired`.

## The cat's assistant

Tubby's chat runs on Muse Spark (`META_TEXT_MODEL`, minimal reasoning). Without `META_MODEL_API_KEY`, every endpoint below
answers from the offline coach and marks `mode: "demo"`.

### `GET /api/assistant/settings`
Device settings + status. Creates the anonymous user on first call.
Response: `{settings: CoachSettings, assistantMode, model}`

### `PUT /api/assistant/settings`
Partial update; only supplied fields change.
Request: `{tone?, brevity?, nudges?, goals?, apps?}`
Response: `{settings, ok:true}` · 400 `validation_error` on bad values.

### `POST /api/assistant/chat`
Request:
```json
{ "messages": [{ "role": "user", "content": "I want to scroll" }] }
```
`messages` is 1–20 turns, last one must be `user`, each content 1–1000 chars. The server injects the device's live context
(points, streak, goals, apps, closest reward, achievements, recent ledger) into the system prompt.
Response:
```json
{ "reply": "No points yet and no streak to lose. Close the app for 60 seconds and name five things you can see.",
  "mood": "worried", "model": "muse-spark-1.3", "latencyMs": 2900, "mode": "live" }
```
`mood` is one of `happy|proud|worried|neutral` and drives the cat's pose and the speech bubble. `mode` is `live` or
`demo`; `fallback:true` means Muse failed and the offline coach answered. Rate limits: **40 chats per device per hour** and
**120 AI calls per client IP per hour** across all AI endpoints (429).

### `POST /api/assistant/goals`
Splits free text into goals with Muse Spark (strict JSON schema) and stores each goal's themes, which rank the rewards.
Request: `{text}` (2–400 chars). Response: `{goals:[{goal, themes}], reply, mode:"live"|"demo"}`.

### `POST /api/assistant/hello`
One home-screen line, cached per device for 45 min (`nudges:"often"`), 2 h (`sometimes`), or skipped (`off` → static line).
Request: `{fresh?: boolean}` to force a new line.
Response: `{message, mood, mode:"live"|"demo"|"static"|"cached", cached:boolean, model?}`

## Demo mode

When `META_MODEL_API_KEY` is unset, the AI endpoints below answer from `backend/src/demo.ts` with the **same shapes**,
plus `mode: "demo"`. `model` is `"local-demo"` and `latencyMs` is 0. Live responses carry `mode: "live"`. Nothing else
changes: points, offers, codes, QR and caps are always real.

- `POST /nudge` → local template nudge (goal/streak/tone aware).
- `POST /nudges/batch` → local templates with `{points}`/`{streak}`/`{app}` placeholders, cached in SQLite as usual.
- `POST /merchant/offer-from-photo` → the bundled sample menu when the body has `sampleMenu: true`; otherwise a
  low-confidence editable skeleton with `notes` explaining that no vision model ran.
- `POST /redemptions/:id/verify-proof` → accepts with `confidence: 0.6` and a reason that says no vision check ran.
- `POST /agent/discover-merchants` → a deterministic 15-step tool-calling run over the fictional directory.

## Coach nudges (Muse Spark)

### `POST /api/nudge`
One live nudge for the block screen (about 2.5 to 4.5 s).
Request:
```json
{
  "deviceId": "optional",
  "goals": "string (2-300)" ,
  "appName": "TikTok",
  "pointsAtRisk": 40,
  "streak": 4,
  "tone": "playful | tough-love | calm | hype | witty (optional)",
  "nextReward": "optional, max 120 chars",
  "history": [{"nudge": "...", "outcome": "backed_off | opened_anyway"}]
}
```
`goals` may also be an array of 1 to 6 strings (2 to 200 chars each). `history` is optional, max 10.
Response: `{nudge, tone, model, latencyMs}`

### `POST /api/nudges/batch`
Pre-generate several nudges as templates and store them (used by Android and the web Setup page).
Request: same as `/nudge` plus `"count": 1-12` (default 6).
Response: `{contextKey, nudges:[{id, template, tone, preview}], model, latencyMs}`. Templates contain `{points}`, `{streak}`, `{app}`.

### `GET /api/nudges/next?deviceId=&appName=&points=&streak=`
Pop the next unused cached nudge with placeholders filled. No model call, instant.
Response: `{id, nudge, tone, remaining}`. `404` when the cache for that device and app is empty.

## Points, store, companion

### `GET /api/me` *(device)*
Response: `Me` = `{deviceId, balance, streak, bestStreak, penaltyUntil, unlocksLeft, dailyUnlockCap, difficulty: "normal"|"hard",
emergencyPassesLeft, achievements, ownedCosmetics, equipped, redemptions, recent}`.

### `GET /api/journal?days=14` *(device)*
Read-only patterns view ("Tubby's journal"). `days` is clamped to 7–31. Days are local calendar days
(DST-safe). Response:
`{days: [{date, earned, burned, putdowns, slips, focusMinutes}] (oldest first, zero-filled), byHour: [{hour, putdowns, slips}] (24),
totals: {earned, burned, putdowns, slips, focusMinutes, activeDays, sessions}, bestDay: day | null, peakHour: number | null}`.
`burned` and `slips` count only giving in to a guarded app; store purchases and rewards are spending, not slips. `peakHour` is
the hour with the most temptations (put-downs + slips). Focus minutes are parsed from focus-session earn reasons.

### `GET /api/report/weekly[?note=false]` *(device)*
This week's **Focus Score** (0–100) for the last 7 local days:
40 for resisting (share of temptations put down; an active week with none gets half), 30 for focus minutes toward 150,
20 for active days out of 7, 10 for the streak toward 7 days.
Response: `{score, parts: {resist, focus, consistency, streak}, lastScore, delta, week: totals & {from, to}, lastWeek, days,
focusTargetMinutes, note, noteMode: "live"|"offline"}`. `note` is one sentence from Muse Spark, cached until the score changes;
`note=false` skips it (the home screen only needs the number).

### `POST /api/demo/profile`
Creates a fresh demo profile with two weeks of history. Response `201`: `{deviceId}`. `403` when `ALLOW_DEMO_GRANTS=false`;
20 per IP per hour.

### `POST /api/difficulty`
Request: `{deviceId, level: "normal" | "hard"}`. Hard mode doubles every slip (burns and chat unlocks), caps chat unlocks at
3 a day, makes the slow-earn penalty 60 minutes, and pays 30 instead of 20 for a focus session (only if hard mode was on for
the whole session). The guards stay escapable; hard mode changes points only. Response: `Me`.

### `POST /api/focus/quit`
Request: `{deviceId, minutes}`. Ending a focus session early. Normal mode: free (`cost: "none"`). Hard mode: spends the
weekly emergency pass (`cost: "pass"`, resets Monday), or without one burns a doubled slip and resets the streak
(`cost: "burn"`). Response: `{cost, burned, usedPass, ...Me}`.

### `POST /api/points/earn`
Request: `{deviceId, event: "focus_session" | "resisted_temptation" | "streak_day" | "demo_grant", appName?, day?: "YYYY-MM-DD", tzOffset?: minutes, amount?: 1-5000, minutes?: 5-180}`
- `resisted_temptation` pays **0** (it is logged for badges and the Focus Score); `focus_session` +20 (30 in hard mode).
  **`appName` is required for a put-down** (400 without it) and the server
  logs it at most once per app per 10 minutes, with a 60-second gap between logs, at most 8 different apps and 10 logs per
  local day. Response `{earned: 0, counted: true|false, reason, ...Me}`; a skipped log is HTTP 200, not an error.
- The slow-earn penalty halves every real earning (focus sessions, check-ins) while it lasts.
- `focus_session`: **`minutes` is required** (400 without it) and the server allows at most 8 focus sessions per local day
  (429 after that).
- `streak_day`: `10 + min(5 x streak, 50)`; `409` if already counted for that day. The day is the client's calendar day:
  `tzOffset` (from `Date.getTimezoneOffset()`) or an explicit `day`. A `day` more than one day ahead of UTC, more than two days
  back (offline replay), or earlier than the last check-in is refused with `409`, so a script can't count up the calendar.
- `demo_grant`: `amount` (default 500); `403` when `ALLOW_DEMO_GRANTS=false`.
Response: `{earned, reason, ...Me}`

### `POST /api/guard/unlock`
Request: `{deviceId, appName}`. Used by the desktop guard after the user confirms in chat.
- With **10+ points**: burns 25% (min 10, max 150; doubled in hard mode) and unlocks that app/site for 10 minutes.
- With **0–9 points**: burns nothing, unlocks for 10 minutes, and sets a **30-minute slow-earn penalty** (60 in hard mode;
  earn events pay 50%).
- **Daily cap:** at most 6 unlocks per local day, 3 in hard mode (`DAILY_UNLOCK_CAP` env to tune). The cost still applies to every
  unlock. Past the cap: `429 {error: "No unlocks left today…", details: {unlocksLeft: 0, dailyCap}}`: the guard stays
  up. `Me.unlocksLeft` reports the remaining count.
Response: `{allowed, unlockedUntil, burned, penaltyMinutes, penaltyUntil, reason, ...Me}`

### `POST /api/points/burn`
Request: `{deviceId, reason: string (2-200), amount: 1-100000, appName?, breaksStreak?: boolean (default false), difficultyApplied?: boolean}`
Burns `min(amount × multiplier, balance)`; the balance never goes below 0. The multiplier is 2 in hard mode unless the client
says it already applied it (`difficultyApplied`, used by clients that show the doubled stake). `breaksStreak` sets the streak to 0.
Response: `{burned, requested, multiplier, ...Me}`

### `GET /api/store` *(device optional)*
The cosmetics catalog: 7 fur colors + 6 accessories. Response: `{items:[Cosmetic & {owned}]}`. Classic (price 0) is always owned.

### `POST /api/store/buy`
Request: `{deviceId, cosmeticId}`. `404` if not a wearable cosmetic, `409` already owned, `402` not enough points.
Buying does not equip; the client calls `/store/equip` next.
Response: `{bought: Cosmetic, ...Me}`

### `POST /api/store/equip`
Request: `{deviceId, slot?: "color"|"accessory" (default color), cosmeticId: string | null}`. `null` or `color-classic`
clears that slot. `403` if not owned or the slot does not match.
Response: `Me`

### `POST /api/cosmetic/generate` (Muse Image)
Generate cosmetic art from a prompt. Limited to 10 per device (or IP) per hour; takes about 7 to 28 s. Not shown in the current UI.
Request: `{deviceId?, prompt: string (3-300), slot?: "hat"|"eyes"|"aura"|"held" (default hat), name?, price?: 50-5000 (default 300)}`
Response `201`: `{cosmetic:{id,name,slot,price,imageUrl,generated:true}, url:"/media/cosmetics/<id>.png", latencyMs}`. `429` over the limit.

## Offers and rewards

### `GET /api/offers`
All published offers, merchant offers first, then seeded demo offers. Response: `{offers: [Offer]}` with `redeemedThisMonth`.

### `GET /api/offers/:id/qr?origin=https://your.host`
Poster QR that links to `<origin>/?offer=<id>`. Response: `{url, qrDataUrl, title, business}`. `404` unknown offer.

### `POST /api/offers/:id/redeem` *(device)*
Spend points and issue a one-time code.
Response `201`: `{redemption:{id, code:"TUBB-XXXX-XXXX", offerId, business, title, points}, qrPayload:"tubbybuddy:redeem:<code>", qrDataUrl, balance}`.
`402` not enough points, `409` monthly cap reached, `404` unknown offer.

### `POST /api/redemptions/:id/verify-proof` *(device)* (Muse Spark vision)
Upload a photo of the visit. Request: multipart `image` or JSON `{imageBase64}`.
Response: `{result:{isRealVisit, confidence, reason}, verified, bonusPoints (25 the first time, else 0), balance, imageUrl, latencyMs}`.
`403` if the redemption belongs to another device, `404` unknown redemption.

## Business endpoints

Merchant onboarding, the counter check and the scout agent are tested but not used by the apps. Treat them as
admin-only.

### `POST /api/merchant/offer-from-photo` (Muse Spark vision)
Turn a menu or flyer photo into a draft offer.
Request: multipart with field `image` (+ optional `businessName`), **or** JSON `{imageBase64: "data:image/jpeg;base64,..." | raw base64, mimeType?, businessName?, sampleMenu?}`.
`sampleMenu: true` only matters in demo mode: it returns the transcribed Ember & Oak Café sample instead of a generic skeleton.
jpeg/png/webp/gif, max 8 MB (`413` too large, `415` wrong type). The photo is saved under `/media/uploads/`.
Response:
```json
{
  "draft": {
    "business": "", "offerTitle": "", "description": "",
    "items": [{"name": "", "price": 0}],
    "regularPrice": 0, "suggestedDiscountPercent": 0, "monthlyCap": 0, "pointsPrice": 0,
    "terms": "", "category": "food|drinks|fitness|experience|class|retail|other",
    "confidence": 0.0, "notes": "", "flags": [], "adjustments": []
  },
  "raw": {"...": "the model's unmodified output"},
  "imageUrl": "/media/uploads/<file>",
  "model": "muse-spark-1.3", "latencyMs": 0, "usage": {}
}
```

### `POST /api/merchant/offers`
Publish an offer. Explicit consent is required.
Request: `{consent: true, consentName: string (2-80), imageUrl?, offer: {business, offerTitle, description?, items?, suggestedDiscountPercent (5-100), monthlyCap (1-10000), pointsPrice (10-100000), terms?, category?}}`
Response `201`: `{offer: Offer}`. Without `consent: true` it returns `400`.

### `POST /api/merchant/redemptions/validate`
Counter check. Request: `{code}` (a raw code or a scanned `tubbybuddy:redeem:<code>` payload). One-time use.
Response: `{ok:true, redemptionId, title, business}`. `404` unknown code, `409` already used.

### Merchant scout agent (Muse Spark tool calling)

#### `GET /api/agent/cities`
Response: `{cities:["San Francisco","Oakland"], categories:["any", ...], note}`

#### `POST /api/agent/discover-merchants`
Request: `{city: string (2-60), category?: string (default "any"), topN?: 1-5 (default 3)}`
Response:
```json
{
  "runId": "run_...",
  "input": {"city": "Oakland", "category": "any", "topN": 3},
  "complete": true,
  "ranked": [{"businessId": "b07", "name": "", "category": "", "neighborhood": "", "score": 0, "reasons": [""]}],
  "drafts": [{"id": "draft_...", "businessId": "", "businessName": "", "to": "owner+b07@example.com", "subject": "", "body": "", "proposedOffer": "", "status": "draft_not_sent"}],
  "summary": "2-3 sentences",
  "totalMs": 0,
  "model": "muse-spark-1.3",
  "outreachSent": false,
  "steps": [{"n": 1, "kind": "tool_call | message", "tool": "", "args": {}, "result": {}, "text": "", "ms": 0}]
}
```
Each run is stored in the `agent_runs` table.

## Static files
- `GET /media/uploads/*`, `GET /media/cosmetics/*`: uploaded photos and generated art.
- Everything else (not `/api` or `/media`) serves the built web app when `web/dist` exists.
