# Scripted browser checks

Two Puppeteer scripts used to verify the product beyond `tsc` and unit tests. They drive the real UI in headless
Chromium (Edge), so they catch layout, dialog, fetch and console regressions.

## Run

```bash
# from the repo root
npm install --no-save puppeteer-core@23   # not added to package.json on purpose

# 1) customer app: run the backend first (npm start), then:
node tools/e2e/web.mjs

# 2) extension: close other Edge windows, then:
node tools/e2e/extension.mjs
```

Environment overrides:

| Variable | Default | Meaning |
|---|---|---|
| `BASE` | `http://127.0.0.1:8787` | Backend/web origin under test |
| `EDGE` | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` | Chromium binary |
| `SHOTS` | `shots` (web) / `tools/e2e/shots` (extension) | Screenshot output directory |

`web.mjs` is the customer-app suite (**56 checks**): first-run sign-in and setup, cat stage, greeting, chat reply + bubble sync,
chat persistence, voice toggle/storage, focus setup/running/early end, a real redemption (code + QR), My codes, cosmetics
(6 accessories + 7 furs, purchase, live preview), 11 achievements, tone persistence, block-screen preview, mobile
overflow/dock clearance and console/page errors. It grants itself 500 demo points through the API, so it needs
`ALLOW_DEMO_GRANTS` enabled (the default).

`extension.mjs` loads the unpacked `extension/`, sets the backend URL, adds `127.0.0.1` to the blocked list, opens the
local app to trigger the Tubby overlay, checks the nudge, clicks Continue anyway and opens the popup. It uses an isolated
browser profile, so it does not touch your real extension settings.

Both scripts leave test rows in the database/media folder. Delete `backend/data/` and `backend/media/uploads/` to get back
to the seeded demo state.
