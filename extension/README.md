# TubbyBuddy for Chrome (Manifest V3)

Guards distracting websites. When you open a blocked site, Tubby covers the page with a short line from Muse Spark,
your points at risk and your streak, and two choices: **Put it down** (the tab closes, points and streak stay safe) or
**Continue anyway** (points burn and the site stays open for 10 minutes).

Plain JS, HTML and CSS. No build step, no frameworks, no remote code, no API keys in the extension.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → this folder.
3. It uses the hosted server by default. To change it: popup → **Open options** → backend URL → **Test connection**.

## Options

Saved to `chrome.storage.sync`:

- **Backend URL**: default `https://tubbybuddy-production.up.railway.app` (use `http://localhost:8787` for a local server). **Test connection** calls `GET /api/health`.
- **Device id**: generated on install as `ext-` + UUID. Paste your phone's id to share one profile.
- **Goals**: up to 6 lines; sent with each nudge request.
- **Blocked sites**: `tiktok.com`, `instagram.com`, `x.com`, `youtube.com/shorts`, `reddit.com` by default. A bare
  domain blocks the host and its subdomains; an entry with a path blocks that path prefix.
- **Points at risk**: default 50 per slip (1–10,000), doubled in hard mode, never more than the balance.
- **Nudge tone**: playful, tough-love, calm, hype or witty.

The ledger, cooldowns and offline queue live in `chrome.storage.local`.

## How it works

- The content script runs at `document_start` and exits immediately on sites that don't match. Single-page navigation
  (YouTube Shorts) is caught by `webNavigation.onHistoryStateUpdated` and a URL watcher in the page.
- On a match, a Shadow DOM overlay blocks scrolling, pauses media, asks the backend for a nudge (4 s timeout, then a
  built-in line), and shows the stake and streak.
- **Put it down** logs `resisted_temptation` (no points) and closes the tab. **Continue anyway** posts a burn and
  starts the cooldown for that site.
- All network calls go through the service worker. If the backend is offline, actions apply to a local ledger and queue
  for retry (on popup open and every 5 minutes); the popup shows `pending sync: N`.

## Backend calls

All requests are JSON with `x-device-id`. See [`docs/03-API-REFERENCE.md`](../docs/03-API-REFERENCE.md).

- `POST /api/nudge`, `POST /api/points/earn`, `POST /api/points/burn`, `GET /api/me`, `GET /api/health`

## Files

```text
manifest.json
icons/                            # Tubby app icon, 16–128 px
assets/                           # Tubby overlay art
src/shared/                       # constants, site matching, offline nudges, storage, API client
src/background/service-worker.js  # network, ledger, queue flush, alarms, navigation events
src/content/content.js            # overlay and SPA watcher
src/popup/                        # balance, streak, recent activity, sync status
src/options/                      # goals, sites, stake, backend, device id, tone
tests/match.test.mjs              # npm test
```
