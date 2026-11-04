# Features and screens

Numbers come from `backend/src/config.ts`, `android/.../domain/Ledger.kt` (`PointsRules`) and
`extension/src/shared/constants.js`.

## Points, streak and burn rules

### Backend (the authority for synced points)
| Event | Points | Notes |
|---|---|---|
| `resisted_temptation` ("put it down") | **0** | Logged for badges and the Focus Score, not paid: being tempted earns nothing. Logged once per app per 10 min, 60 s apart, 8 apps and 10 logs a day |
| `focus_session` | **+20** (30 in hard mode) | Requires `minutes` 5–180; at most **8 sessions per day**; the web timer sends the real length |
| `streak_day` (daily check-in) | **10 + 5 per streak day**, extra capped at **50** (max 60) | Once per calendar day; 409 on a second check-in |
| `proof_verified` (visit photo accepted) | **+25** | First time per redemption only |
| `demo_grant` | up to 5,000 (default 500) | Demo only; off when `ALLOW_DEMO_GRANTS=false` |
| Burn | the slip cost (25% of the balance, 10–150; doubled in hard mode), never below 0 | `breaksStreak: true` resets the streak to 0 |
| Slow-earn penalty | earnings halved for 30 min (60 in hard mode) | After a chat unlock with fewer than 10 points |
| Store purchase / redemption | the item's price | 402 if the balance is too low |

### Android phone app
- **Put it down**: no points. The app goes home, points and streak stay safe, and the put-down is logged for badges
  (once per app per **10 minutes**, a **60-second gap** between logs, at most **8 different apps** a day). Each logged
  put-down counts **8 saved minutes**.
- **Continue anyway**: burns **25% of the balance, min 10, max 150** (doubled in hard mode), resets the streak, then a
  **10-minute cooldown** (the same on Windows and in the extension).
- **Daily check-in**: keeps the streak and pays the bonus unless you burned today.
- The streak shown lapses to 0 if yesterday had no win.

**App categories**: the picker filters installed apps into Social, Video & streaming, Games, Music & audio, News & reading,
Shopping, Messaging, Productivity, Photos, Travel & maps, and Other. Each category has a **Block the whole category** control
that selects every installed app in it at once. Categories come from `ApplicationInfo.category` plus package/label
heuristics; the category is stored on each guarded app so the choice survives a restart.

### Web app
- **Focus session**: 15/25/45 minutes. Finishing banks **+20** (30 in hard mode). Ending early pays nothing; in hard mode it
  needs the weekly emergency pass or burns a doubled slip and the streak. The timer survives closing the dialog and a page
  reload (stored `endsAt`).
- **Check in**: pays the daily streak bonus once, on your local calendar day.
- **Block-screen preview** (Settings): the real slip cost, "Put it down" logs a put-down, "Continue anyway" burns.
- **Difficulty** (Settings): Normal or Hard (see the backend table).
- **Account** (Settings): sign in or out, replay the setup, or load a demo profile with two weeks of history.

### Chrome extension
- Points at risk per slip: **50 by default** (configurable 1–10,000; the backend caps at the balance). The extension's burn
  does not reset the streak (`breaksStreak: false`); hard mode doubles the stake. "Put it down" closes the tab and logs a
  put-down (no points), with the same limits as the phone.
  10-minute per-site cooldown after "Continue anyway".

## Cosmetics (fur + one accessory)

The companion is **Tubby**, a 3D cat with 2D pre-rendered frames for environments without WebGL. Cosmetics has two
slots: a fur color and one accessory.

### Fur colors
| Color | Price |
|---|---|
| Classic Pink | free (owned from the start) |
| Mint | 80 pts |
| Ocean | 80 pts |
| Grape | 120 pts |
| Sunset | 150 pts |
| Midnight | 250 pts |
| Gold | 400 pts |

### Accessories
| Prop | Price | Placement |
|---|---|---|
| Velvet Bow | 150 pts | right ear |
| Star Shades | 180 pts | eyes |
| Cozy Scarf | 220 pts | neck |
| Daisy Crown | 240 pts | top of head |
| Beat Headphones | 260 pts | ears + band |
| Sunbeam Crown | 320 pts | top of head |

On the web, fur colors are applied live to the 3D model with an HSV hue shift (`web/src/components/furColors.ts`), and the
2D fallback swaps to the matching PNG frame from `web/public/tubby/`. Accessories are 3D props on the model and SVG
overlays on the 2D frames.

## Achievements (11)

Put It Down (1 resist), Iron Thumb (10), Unshakeable (50), Deep Work (1 focus session), Focus Regular (10), On a Roll
(3-day streak), Week Warrior (7-day), Point Hoarder (1,000 points earned), Real Life Unlocked (1 redemption), Been There
(1 verified visit), Fresh Fur (first fur color). The API returns `progress` (0–1) and `detail` (`3 / 10`), so every badge
has a real bar.

---

## Web app screens

Five tabs. The cat is the first one.

### First run: welcome and setup (full screen, game-style)
The same on web, Windows and Android. The valley fills the screen, the 3D Tubby waves hello in the middle, and a
dialogue box runs along the bottom with a "Tubby" name plate. Lines type out; tap (or Space/Enter) to finish a line or
move to the next; answers appear in the box once Tubby has finished talking.
1. **Welcome** (no account yet): tagline as the title, Tubby introduces itself and asks you to sign in with Google so
   points follow you between phone and PC, or to look around with the demo account. On a server without Google sign-in
   the first button is "Start without an account". The web adds a line that blocking happens in the Windows and Android apps.
2. **Hello**: "Let's set me up" / "What do you do?" ("What do you do?" disappears once answered).
3. **Goals**: idea chips or typed text (max 6). Typed text goes to Muse, which splits it into separate goals and
   says what each is about; rewards are matched to them.
4. **Guarded apps**: chips or typed (max 12). Windows offers apps and sites; Android maps names to installed apps.
5. **Plan**: "Here's the plan… Deal?" saves goals and apps. Windows starts watching those apps and sites right away;
   Android offers to set up the phone guard (permissions); the web explains where blocking happens.
"Skip" and "Try a demo profile" stay in the top corner. Tone lives in Settings, not here.

### Tubby (home)
- Large Tubby (3D when WebGL is available, otherwise the matching PNG frame) with a speech bubble above it.
- Name + mood line ("happy to see you", "a little worried", "keeping an eye on you").
- Four stats: points, streak, best, badges.
- Primary action: **Start a focus session** (or **Resume focus · Nm**). Secondary: **Check in today**.
- **Cosmetics** opens the cosmetics tab (and the same tab is in the dock).
- **Chat panel** beside the cat on desktop, below it on mobile:
  - Header: Tubby avatar, mood subtitle, voice-reply toggle, clear chat.
  - Transcript with assistant/user bubbles, typing indicator, starter prompt chips.
  - Composer with mic (Web Speech API), text field, send. Enter sends; voice sends on final transcript.
  - Empty state explains what the cat is for.
- The bubble and transcript stay in sync: the latest reply is always what the cat says.
- **Desktop action:** saying “open Telegram” (or another guarded app/site) makes Tubby ask for confirmation before
  touching the guard. If you have points, confirming burns 25% (min 10) and unlocks it for 10 minutes. At 0–9 points it
  still unlocks, but applies a 30-minute slow-earn penalty (50% points) and judges you a little. At most **6 unlocks per
  day**, the confirmation shows how many are left, and past the cap Tubby says no (the guard stays up).
- **Chat-driven modes:** asking for a mode ("can we do night mode?") makes Tubby name the apps it would guard and ask
  to confirm; confirming applies the preset (deterministic, never left to the model). A non-answer just moves on.
- **Proactive night mode:** at late hours (21:00–05:00) Tubby offers Night mode after the greeting, naming the apps and
  quoting your first goal back to you.
- **Demo control:** the desktop guard has a “Demo: turn guard off for 30 minutes” button (overlay, tray, desktop settings,
  and the dashboard's Desktop guard card). It never burns points or applies a penalty.

### Focus session dialog
- 15/25/45-minute cards, guarded-app chips, "Start N minutes".
- Running: progress ring, `mm:ss`, small cat, "I'm tempted" (asks the coach for one line) and "End session".
- Done: "Session banked. +20 points."; early end: "Stopped early", no penalty, try again.
- Closing the dialog keeps the timer running; reopening resumes or completes it.

### Rewards
- Hero with points, "how it works" steps and progress to the next reward.
- Tabs: **Offers** and **My codes**.
- Offer cards with business, title, description, discount/category/remaining-this-month chips, points price, and an
  affordability filter.
- Redeem: confirm → one-time code + QR → optional visit photo (+25) → proof result with reason and confidence.
- My codes: past codes with status chips, one-time-use note.
- `/?offer=<id>` still highlights an offer (used by poster QRs).

### Achievements
- Hero: unlocked/total, progress bar, streak/best/points.
- "Closest badge" card with the next best progress.
- Filter: All / Unlocked / Locked.
- 11 cards: badge art, name, description, progress bar, detail and percent. Locked cards are muted.
- **Patterns** ("Tubby's journal"): 14-day earned/burned bar strip, totals (earned, burned, put-downs, focus minutes),
  best day, and a "you slip most around …" peak hour from `GET /api/journal`. Hidden until there's any activity.
- Recent wins ledger.

### Cosmetics
- Stage with a live cat preview and the current fur/accessory.
- Tabs: **Fur** (7 colors) and **Accessories** (6 props, marked "coming soon").
- Fur cards with a live swatch, price, unlock/wear. Buying auto-equips.
- "Take it off" removes the accessory. Props render as 3D primitives on the VRM and as SVG overlays on the PNG fallback.

### Settings
- **Desktop guard** (Windows) or **Phone guard** (Android): guard status and a link to its settings.
- **Difficulty**: Normal or Hard.
- **Focus modes** (phone UI): six one-tap presets (Deep Focus, Study, Morning, Night, Gym, Sunday Reset) that swap the
  guarded-apps list for a moment of the day; goals stay untouched. Presets live in `web/src/lib/modes.ts`.
- **How Tubby talks**: tone (Warm, Direct, Playful, Calm), answer length (Short, Balanced), home nudges (Off, Sometimes,
  Often), voice replies (on/off, voice picker, speed, preview).
- **What Tubby knows**: goals (one per line, max 6), guarded apps (presets + custom), Save focus settings.
- **Tubby's look**: opens the cosmetics tab (the dock item is always visible too).
- **Phone nudge cache** (`<details>`): pre-generate 4 lines for up to 4 apps, inspect them, test the cache. Uses Muse Spark
  when configured, local lines otherwise.
- **Preview the block screen**: opens the real intercept dialog with the configured apps.
- **Account**: sign in or out, replay the setup, load a demo profile.
- **About**: device id + copy, coach mode/model, block-screen AI mode, voice input support, clear chat, reset voice.

---

## Android app screens

The phone shows the **same screens as the web app** (welcome, setup, Tubby and chat, Rewards, Achievements, Cosmetics,
Settings), loaded from the server, with the dock along the bottom. Native screens cover only what a web page can't do:

- **Phone guard** (Settings, Phone guard, or the last step of setup): one window with the guard switch, the four
  Android permissions (usage access and display over other apps are required; notifications and unrestricted battery are
  recommended), the installed-app picker (search, category chips, neutral letter tiles), a block-screen preview and the
  server address. Apps picked here go back to the shared guarded-apps list.
- **Block screen**: the valley and a window, Tubby worried, "Hold up.", the Muse line, then points, at risk and
  streak. **Put it down** goes home with points and streak safe; **Continue anyway (burn N)** burns, resets the streak
  and opens the app for 10 minutes. The same screen the Windows app shows.
- **Can't reach TubbyBuddy**: if the server doesn't answer, a window with the server address and Try again. The guard
  keeps working offline and syncs later.

## Chrome extension screens

- **Overlay** on a blocked site: dark full-screen card, Tubby art, eyebrow "TubbyBuddy • Focus Guard", coach nudge, points at
  risk and streak. **Put it down** closes the tab (no points, as everywhere). **Continue anyway** burns and allows 10 minutes.
- **Popup**: balance, streak, best, backend status, pending sync, recent activity, options.
- **Options**: backend URL + test, device id, goals, blocked sites, points at risk, nudge tone.
