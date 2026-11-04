# Desktop app (Windows)

The Windows app shows the same screens as the web and phone, and adds what only a desktop process can do: watch the
foreground window and step in when a guarded app or site comes up.

## What it does

| Part | How it works |
|---|---|
| Screens | The web app, served from a local server inside the app, with the page names in the top menu and the icons at the bottom. |
| Tray | Open the app, start a focus session, pause or resume the guard, open guard settings, quit. Closing the window keeps the tray running. |
| Sign-in | "Sign in with Google" opens the browser on a one-time link. Once you confirm there, the app comes back to the front signed in. The session token stays in the app's config and is added by its local proxy, never handed to the page. |
| First run | The same setup conversation as everywhere. Its apps step offers programs and sites; accepting the plan starts guarding them all day. |
| App guard | Watches the foreground process. A guarded program in front shows the block screen. |
| Site guard | Matches browser tab titles for common sites. The Chrome extension handles exact URLs. |
| Focus sessions and schedules | 15–60-minute sessions from the tray (finished sessions pay +20, 30 in hard mode), and optional weekday guard hours. |
| Chat unlock | Saying "open Telegram" makes Tubby ask first. With points it burns 25% (at least 10); with fewer than 10 it allows it with a 30-minute half-earn penalty. At most 6 unlocks a day (3 in hard mode). |

## The guard

1. Every 1.8 s it reads the foreground process, window title and window type. Notifications and tool windows are ignored,
   as are the app itself, Explorer and anything in **Never block**.
2. A guarded program or site title has to stay in front for two checks in a row (about 3.6 s) before the block screen
   shows, so a notification flash can't trigger it.
3. **Put it down** closes the block screen at once; points and streak stay safe and the put-down is logged (no points).
4. **Continue anyway** burns 25% of the balance (10–150, doubled in hard mode), resets the streak and unlocks that app
   for 10 minutes.
5. The block screen shows a Muse Spark line when the server answers in time; it never waits for it.

## Always escapable

The block screen is a soft guard: it never closes the program behind it, and there's always a way out.

| Control | Where |
|---|---|
| ×, Escape, "Pause guard for 10 minutes" | Block screen |
| "Quit app" | Block screen, tray |
| `Ctrl+Alt+Shift+P` / `Ctrl+Alt+Shift+Q` | Pause for 10 minutes / quit, from anywhere |
| "Demo: turn guard off for 30 minutes" | Block screen, tray, guard settings, Settings page. No points, no penalty. |
| `--safe-mode` | Launch with the guard switched off |

## Build

```powershell
npm run build -w web
cd desktop
npm install
npm start          # copies the web build in, then runs the app
npm run pack       # portable app in desktop/release/TubbyBuddy-win32-x64/
```

The app uses the hosted server by default. To use a local one, set **Server** in Desktop guard settings to
`http://127.0.0.1:8787`.

## Limits

- Windows only; the foreground probe uses `user32.dll` through PowerShell.
- Browser matching uses tab titles; the Chrome extension is the precise site blocker.
- The build is a portable folder, not a signed installer.
