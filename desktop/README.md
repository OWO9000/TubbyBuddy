# TubbyBuddy for Windows

The same screens as the web app, plus a tray app that guards the programs and sites you choose. See
[docs/06-DESKTOP-APP.md](../docs/06-DESKTOP-APP.md).

## Run and build

```powershell
# from the repo root
npm run build -w web
cd desktop
npm install
npm start          # copies the web build in, then runs the app
npm run pack       # portable app: release/TubbyBuddy-win32-x64/TubbyBuddy.exe
```

`install.ps1` copies the portable app to `%LOCALAPPDATA%\TubbyBuddy` and adds Start Menu and Desktop shortcuts.

The app uses the hosted server by default; change it under tray → Desktop guard settings → Server.

## Files

| Piece | File |
|---|---|
| Main process: tray, guard loop, sign-in, backend calls | `main.js` |
| Local server for the screens, `/api` and `/media` proxy | `server.js` |
| Bridge to the page (`window.tubbyDesktop`) | `preload.js` |
| Block screen | `overlay/block.html` |
| Guard settings | `settings/settings.html` |
| Foreground probe, installed-app scan | `scripts/foreground.ps1`, `scripts/apps.ps1` |
| Config | `%APPDATA%\tubbybuddy-desktop\desktop-config.json` |

## Test flags

```powershell
electron . --safe-mode                                   # guard off for this run
electron . --capture                                     # screenshots into desktop/shots/
$env:TUBBY_FAKE_FOREGROUND = "Discord"; electron . --guard-test   # fake a foreground app
```
