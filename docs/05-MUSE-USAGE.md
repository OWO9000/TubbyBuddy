# How Meta's models are used

Every AI feature runs on Meta's models through the Meta Model API (`https://api.meta.ai/v1`). Only the backend holds
the key. The web app, the Windows and Android apps and the Chrome extension talk to the backend, never to the model API.
All calls go through one small client (`backend/src/meta.ts`) with a timeout, retries and a server-wide daily call budget.

## Muse Spark (`muse-spark-1.3`)

| Use | Endpoint | How |
|---|---|---|
| Tubby's chat | `POST /api/assistant/chat` | Plain text, `reasoning_effort: "minimal"`. The system prompt carries live context: points, streak, goals, guarded apps, closest reward, achievements, recent activity, tone and length. |
| Home-screen line | `POST /api/assistant/hello` | One short line, cached for 45 minutes to 2 hours depending on the nudge setting. |
| Block-screen nudge | `POST /api/nudge` | Strict JSON schema (`nudge`, `tone`), low reasoning effort. Includes the app, points at risk, streak, goals and the next reward. |
| Cached nudges | `POST /api/nudges/batch` | Templates with `{points}`, `{streak}` and `{app}` placeholders, stored on the server and the phone and filled in when shown, so the block screen works offline. |
| Goal splitting | `POST /api/assistant/goals` | Strict JSON schema. Free text such as "read more and get outside more" becomes separate goals, each tagged with themes that rank the rewards. |
| Weekly note | `GET /api/report/weekly` | One sentence about the week's Focus Score, cached until the score changes. |
| Visit-photo check | `POST /api/redemptions/:id/verify-proof` | Vision with a JSON schema (`isRealVisit`, `confidence`, `reason`). Lenient, and never comments on who is in the photo. |

Typical latency: chat about 2–3 s, a nudge 2.5–6 s, a batch of four about 4 s, a photo check 1.5–3 s.

## Muse Image (`muse-image-1.0`)

`backend/scripts/generate-art.ts` generated the reward artwork (`web/public/art/offers/`) and the badge artwork
(`web/public/art/badges/`). Muse Image works with Muse Spark to plan each composition.

## Tubby's prompt rules

Enforced in `backend/src/routes/assistant.ts`:

- One or two sentences (at most 30 words; 55 with "Balanced" length). No lists, headings or markdown.
- Never invent points, streaks, rewards or dates, and use at most one exact number.
- Never say "0 points" or "0-day streak"; frame a clean start instead. A final check catches slips.
- Tempted by a guarded app: name the cost and suggest one 60-second alternative.
- A win: name it and stop. A slip: no shame, one concrete restart.
- No medical, therapy or health advice and no guilt-tripping.

Tone (warm, direct, playful, calm), length and how often Tubby speaks up are set in Settings.

## Without a key

If `META_MODEL_API_KEY` isn't set, or Muse can't be reached, the same endpoints answer from fixed offline lines
(`backend/src/demo.ts`) with `mode: "demo"`, and the app shows **demo coach**. Settings → About says which mode is live.
