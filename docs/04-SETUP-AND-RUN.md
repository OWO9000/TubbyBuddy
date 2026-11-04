# Setup and run

## Quick version

1. Put your Meta Model API key in `.env` (`META_MODEL_API_KEY`).
2. Run the backend and web app with one command: `npm start` → `http://localhost:8787`.
3. The Android APK, the Windows app and the Chrome extension use the hosted server by default; each can point at
   another one.

## Requirements

- Node.js 20+, **Node 22 recommended**. `better-sqlite3` may fail to load under Node 24; switching Node versions requires
  `npm rebuild better-sqlite3`.
- A Meta Model API key from https://dev.meta.ai. Every AI feature uses it. Without one, the app runs offline with fixed
  coach lines and labels itself **demo coach**.
- JDK 17 + Android SDK 34 for an APK build.
- Chrome/Edge for the extension and for browser voice input.

## Environment variables

Copy `.env.example` to `.env` (git ignores it). The server loads `.env` in both dev and production. On a host, set the same
names as secrets.

| Name | Used by | Purpose | Default |
|---|---|---|---|
| `META_MODEL_API_KEY` | backend | Meta Model API key: coach chat, greetings, nudges, weekly note, vision, images | none (offline mode) |
| `GOOGLE_CLIENT_ID` | backend + web | Google OAuth **Web** client id for "Continue with Google". Not a secret. Unset = no sign-in, guest profiles only | none |
| `PORT` | backend | HTTP port | `8787` |
| `META_BASE_URL` | backend | Meta API base URL | `https://api.meta.ai/v1` |
| `META_TEXT_MODEL` | backend | Muse Spark model for chat, nudges and vision | `muse-spark-1.3` |
| `META_IMAGE_MODEL` | backend | Muse Image model | `muse-image-1.0` |
| `META_DAILY_CALL_CAP` | backend | Server-wide Meta calls per UTC day; past it, AI routes answer offline | `3000` |
| `DATA_DIR` | backend | Where `burn.db` lives | `backend/data` |
| `MEDIA_DIR` | backend | Uploaded photos and generated art | `backend/media` |
| `DB_FILE` | backend | Full path to SQLite (overrides `DATA_DIR`) | `DATA_DIR/burn.db` |
| `ALLOW_DEMO_GRANTS` | backend | Set `false` to disable `demo_grant` | enabled |
| `DAILY_UNLOCK_CAP` | backend | Chat guard unlocks per local day (hard mode uses at most 3) | `6` |
| `COSMETIC_GEN_LIMIT` | backend | Muse Image generations per device per hour | `10` |
| `RATE_LIMITS` | backend | Set `off` to disable all rate limits (load tests) | on |
| `RATE_LIMIT_WRITES_PER_HOUR` | backend | Global mutating-`/api` cap per device/IP | `600` |
| `RATE_LIMIT_EARN_PER_HOUR` | backend | `/points/earn` cap per device | `240` |
| `RATE_LIMIT_BURN_PER_HOUR` | backend | `/points/burn` and `/focus/quit` cap per device | `240` |
| `RATE_LIMIT_UNLOCK_PER_HOUR` | backend | `/guard/unlock` cap per device | `30` |
| `RATE_LIMIT_REDEEM_PER_HOUR` | backend | `/offers/:id/redeem` cap per device | `30` |
| `RATE_LIMIT_BUY_PER_HOUR` | backend | `/store/buy` cap per device | `60` |
| `RATE_LIMIT_AI_PER_HOUR` | backend | Calls to any AI endpoint per client IP | `120` |
| `TRUST_PROXY` | backend | Set `true` behind a reverse proxy so limits key on the real client IP | off |
| `SKIP_IMAGE_GEN` | live tests | `1` skips the Muse Image test | off |
| `BURN_BACKEND_URL` | Android build | Backend baked into a new APK | the hosted server (`http://localhost:8787` with `adb reverse` for local) |
| `API_URL` | Vite dev server | Where `/api` and `/media` proxy | `http://localhost:8787` |
| `BURN_KEYSTORE_PROPS` | Android build | Release signing properties file (outside the repo) | see below |

With no Meta key the app uses offline lines and shows **demo coach** (Settings → About says which mode is active).

## Sign in with Google (optional)

1. In the Google Cloud console, create a project, then **Google Auth Platform → Branding** (app name, support email) and
   **Audience → External**.
2. **Clients → Create client → Web application**. Add every address the web app is served from under **Authorized
   JavaScript origins**: `http://localhost:8787`, `http://localhost:5173` for development, and the hosted `https://` URL.
3. Put the client id in `GOOGLE_CLIENT_ID` and restart. No client secret is needed.

Only `openid`, `email` and `profile` are requested, so any Google account can sign in without Google's app review. The
phone and Windows apps sign in through the browser with a short link code, so they need no extra Google setup. Google
only allows `localhost` or `https` origins, so phones sign in against the hosted server.

## Run

```bash
cd TubbyBuddy
cp .env.example .env        # add META_MODEL_API_KEY
npm install
npm run build               # web/dist + backend/dist
npm start                   # http://localhost:8787
```

Development loop:

```bash
npm run dev                 # API :8787 + Vite :5173 (proxies /api and /media)
```

Check:

- `http://localhost:8787/api/health` → `assistantMode: "live"|"demo"`, `assistantModel`, `metaConfigured`.
- `http://localhost:8787/` → the cat. Settings → About repeats the live/demo status.

The database is created and seeded (fur colors and demo offers) on first start. Delete `backend/data/` to start clean.

### Hosting

The included `Dockerfile` builds the backend and web app into one image (it sets `DATA_DIR=/data`, `MEDIA_DIR=/data/media`
and `TRUST_PROXY=true`); `railway.json` configures Railway. Mount a persistent volume at `/data`, set
`META_MODEL_API_KEY` as a secret and `GOOGLE_CLIENT_ID`, and add the hosted URL to the Google client's JavaScript
origins. Any Node 22 host works the same way: `npm install && npm run build`, then `npm start`.

## Android build

```bash
cd android
./build.sh                        # unit tests + lint + debug APK
./build.sh assembleRelease        # signed release (needs a keystore)
```

Windows:

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk17'
$env:ANDROID_HOME = 'C:\path\to\android-sdk'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Outputs: `app/build/outputs/apk/debug/app-debug.apk` (installable, debug-signed) and
`app/build/outputs/apk/release/app-release.apk` (needs a keystore).

A fresh install points at the hosted server. Bake another URL with `-Pburn.backendUrl=…` or
`BURN_BACKEND_URL`, or change it on the phone under Settings, Phone guard, Server. The app loads its screens from that
server, so it always matches the web. To try it without a phone, install the APK on an Android 34 emulator
(`adb install -r app-debug.apk`) and run `adb reverse tcp:8787 tcp:8787` so the emulator's localhost reaches the
server on your computer.

**Signing**: set `BURN_KEYSTORE_PROPS` or `-Pburn.keystoreProps=/path` to a properties file with `storeFile`,
`storePassword`, `keyAlias`, `keyPassword`. Debug and release use the same key when present. Back it up.

## Install the APK

1. Get the APK on the phone (download link, Drive, or `adb install -r app-release.apk`).
2. Allow **Install unknown apps** when asked.
3. If Play Protect warns: **More details → Install anyway**.
4. Open TubbyBuddy and follow onboarding.

## Phone permissions (Settings → Phone guard, or the last step of setup)

| Permission | Why | What to do |
|---|---|---|
| **Usage access** (required) | Lets TubbyBuddy see which app is in front | Open, find TubbyBuddy, enable "Permit usage access" |
| **Display over other apps** (required) | Draws the block screen over TikTok | Open, enable "Allow display over other apps" |
| **Notifications** (recommended) | Keeps the foreground guard alive | Allow (Android 13+) |
| **Unrestricted battery** (recommended) | Stops the phone killing the guard | Allow / "Unrestricted" |

## Point the phone at another server

Settings → **Phone guard** → **Server**. Use `https://…` when hosted, or `http://192.168.1.20:8787` on the same Wi-Fi.
The guard keeps working offline (built-in nudges, local points) and syncs later.

## Windows app

```powershell
npm run build -w web
cd desktop
npm install
npm start                 # run it
npm run pack              # portable app in desktop/release/
```

It uses the hosted server; change it under tray → Desktop guard settings → Server. See
[06-DESKTOP-APP.md](06-DESKTOP-APP.md).

## Load the Chrome extension

1. `chrome://extensions` (or `edge://extensions`) → Developer mode.
2. **Load unpacked** → the `extension/` folder.
3. It uses the hosted server. To change it: popup → **Open options** → Backend URL → **Test connection**.
4. Optional: paste the phone's device id to share points.
5. Visit `tiktok.com` to see the Tubby overlay.

The extension has no build step. Overlay art is in `extension/assets/`.

## Tests

| Command | Where | What |
|---|---|---|
| `npm test` | root | 37 backend tests: economy rules, hard mode, Focus Score, check-in days, rate limits, demo profile, Meta client against a mock |
| `npm run test:live` | root | Live Meta tests (nudge, batch, vision, B2B), costs a few cents; skipped without a key |
| `npm test` | `extension/` | 56 URL matcher assertions |
| `npm test` | `android/` via `build.sh` | 40 JVM unit tests + lint |
| `node tools/e2e/web.mjs` | root | 56 customer-app checks in headless Chromium (sign-in and setup, chat, modes, voice toggle, focus, redeem, cosmetics, achievements, settings, mobile) |
| `node tools/e2e/extension.mjs` | root | 11 extension checks in headless Chromium |

Browser scripts need `npm install --no-save puppeteer-core@23` and a running backend. See
[`tools/e2e/README.md`](../tools/e2e/README.md). They add test rows; delete `backend/data/` afterwards for a clean demo.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not locate the bindings file … better-sqlite3` | Node 24. Use Node 22 and `npm rebuild better-sqlite3` |
| `EADDRINUSE :8787` | Another server is running. Stop it or set `PORT` |
| "Demo coach" banner | No Meta key on the server. Set `META_MODEL_API_KEY` in `.env` and restart |
| Chat replies are slow (>6 s) | Muse Spark is busy or the network is slow; the offline coach answers after a 45 s timeout |
| Mic button doesn't work | Voice input needs Chrome/Edge and microphone permission; voice output still works |
| 3D Tubby is a flat drawing | WebGL unavailable; the app falls back to the matching PNG frame |
| Phone can't reach the backend | Same Wi-Fi, laptop LAN IP + `:8787`, firewall, keep `http://` for local |
| "Continue with Google" missing | `GOOGLE_CLIENT_ID` isn't set, or the page's address isn't in the client's JavaScript origins |
| Google popup says "origin not allowed" | Add the exact address (scheme, host and port) to **Authorized JavaScript origins** |
