const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const { startDesktopServer } = require("./server");

const LOG_FILE = path.join(__dirname, "desktop.log");
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
}
process.on("uncaughtException", (err) => log("UNCAUGHT", err.stack || String(err)));
process.on("unhandledRejection", (err) => log("UNHANDLED", err && err.stack ? err.stack : String(err)));
log("main boot", process.argv.join(" "));

app.setAppUserModelId("app.tubbybuddy.desktop");

const APP_NAME = "TubbyBuddy";
const ROOT = __dirname;
const WEB_DIR = fs.existsSync(path.join(ROOT, "web", "index.html"))
  ? path.join(ROOT, "web")
  : path.join(ROOT, "..", "web", "dist");
const CAT = path.join(WEB_DIR, "tubby", "tubby_worried.png");
const ICON = path.join(ROOT, "assets", "icon.png");
const ICON_ICO = path.join(ROOT, "assets", "icon.ico");
const IS_TEST = process.argv.includes("--capture");
const GUARD_TEST = process.argv.includes("--guard-test");
const SAFE_MODE = process.argv.includes("--safe-mode");
const CAPTURE_DIR = path.join(ROOT, "shots");

let mainWindow = null;
let settingsWindow = null;
let overlayWindow = null;
let tray = null;
let localServer = null;
let localPort = 0;
let quitting = false;
let overlayOpen = false;
let allowOverlayClose = false;
let currentThreat = null;
let cachedPoints = 0;
let cachedStreak = 0;
let cachedHard = false;
let focusUntil = 0;
let focusMinutes = 25;
let lastOverlayAt = 0;
let guardBusy = false;
let pausedUntil = 0;
let pendingName = "";
let pendingCount = 0;
const cooldowns = new Map();

// ---- config -------------------------------------------------------------------------------

function randomId() {
  return "desk-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// The hosted server. A local one (npm run dev) can be set under Desktop guard settings, Server.
const DEFAULT_BACKEND_URL = "https://tubbybuddy-production.up.railway.app";
const LOCAL_DEV_URLS = ["http://127.0.0.1:8787", "http://localhost:8787"];

function defaultConfig() {
  return {
    backendUrl: DEFAULT_BACKEND_URL,
    deviceId: randomId(),
    guardEnabled: true,
    alwaysGuard: false,
    startAtLogin: false,
    focusMinutes: 25,
    blockedApps: ["Discord", "Steam", "Telegram", "TikTok", "Instagram"],
    blockedSites: ["Instagram", "TikTok", "YouTube", "Reddit"],
    allowlist: [],
    unlocks: {},
    demoMode: true,
    desktopOnboarded: false,
    pausedUntil: 0,
    safetyRevision: 2,
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
    createdAt: Date.now(),
  };
}

function configPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const base = defaultConfig();
    const migrated = parsed.safetyRevision !== 2;
    return {
      ...base,
      ...parsed,
      // Earlier builds defaulted to a local server; move those to the hosted one unless the user picked it on purpose.
      backendUrl: !parsed.backendChosen && LOCAL_DEV_URLS.includes(String(parsed.backendUrl || "").replace(/\/$/, "")) ? DEFAULT_BACKEND_URL : parsed.backendUrl || base.backendUrl,
      // Configs older than safetyRevision 2 start with always-guard and start-at-login off.
      alwaysGuard: migrated ? false : !!parsed.alwaysGuard,
      startAtLogin: migrated ? false : !!parsed.startAtLogin,
      guardEnabled: parsed.guardEnabled !== false,
      safetyRevision: 2,
      blockedApps: Array.isArray(parsed.blockedApps) ? parsed.blockedApps : base.blockedApps,
      blockedSites: Array.isArray(parsed.blockedSites) ? parsed.blockedSites : base.blockedSites,
      allowlist: Array.isArray(parsed.allowlist) ? parsed.allowlist : base.allowlist,
      unlocks: parsed.unlocks && typeof parsed.unlocks === "object" ? parsed.unlocks : {},
      demoMode: parsed.demoMode !== false,
      desktopOnboarded: !!parsed.desktopOnboarded,
      schedule: { ...base.schedule, ...(parsed.schedule || {}) },
    };
  } catch {
    return null;
  }
}

function saveConfig(next) {
  config = next;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
}

let config = loadConfig() || defaultConfig();
pausedUntil = Number(config.pausedUntil) || 0;
saveConfig(config);
focusMinutes = Number(config.focusMinutes) || 25;

// ---- backend ------------------------------------------------------------------------------

function backendJson(pathname, method = "GET", body = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let base;
    try {
      base = new URL(config.backendUrl);
    } catch {
      reject(new Error("Backend URL is invalid. Open guard settings."));
      return;
    }
    const lib = base.protocol === "https:" ? https : http;
    const payload = body == null ? null : JSON.stringify(body);
    const headers = { accept: "application/json", "x-device-id": config.deviceId };
    if (config.session) headers.authorization = `Bearer ${config.session}`;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = lib.request(
      {
        hostname: base.hostname,
        port: base.port || (base.protocol === "https:" ? 443 : 80),
        path: base.pathname.replace(/\/$/, "") + pathname,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { error: text.slice(0, 200) };
          }
          if (res.statusCode >= 400) {
            const err = new Error(data.error || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            reject(err);
          } else resolve(data);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Backend timed out")));
    req.on("error", (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function refreshPoints() {
  try {
    const me = await backendJson("/api/me");
    cachedPoints = Number(me.balance || 0);
    cachedStreak = Number(me.streak || 0);
    cachedHard = me.difficulty === "hard";
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:points", { points: cachedPoints, streak: cachedStreak });
    }
    updateTray();
  } catch {
    /* app still works offline */
  }
}

/** Same rule as the server: 25% of the balance (10–150), doubled in hard mode, never more than the balance. */
function atRisk() {
  if (cachedPoints <= 0) return 0;
  const base = Math.min(150, Math.max(10, Math.round(cachedPoints * 0.25)));
  return Math.min(cachedPoints, cachedHard ? base * 2 : base);
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show();
  } catch {
    /* ignore */
  }
}

// ---- focus + schedule ---------------------------------------------------------------------

function focusRemaining() {
  return focusUntil > Date.now() ? Math.ceil((focusUntil - Date.now()) / 1000) : 0;
}

function parseMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function scheduleActive(now = new Date()) {
  if (!config.schedule?.enabled) return false;
  const day = now.getDay() === 0 ? 7 : now.getDay();
  if (!(config.schedule.days || []).includes(day)) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = parseMinutes(config.schedule.start);
  const end = parseMinutes(config.schedule.end);
  return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
}

function guardActive() {
  if (SAFE_MODE) return false;
  if (!config.guardEnabled) return false;
  if (pausedUntil > Date.now()) return false;
  return !!config.alwaysGuard || focusUntil > Date.now() || scheduleActive();
}

function pauseGuard(minutes = 10) {
  pausedUntil = Date.now() + Math.max(1, Number(minutes) || 10) * 60_000;
  config.pausedUntil = pausedUntil;
  saveConfig(config);
  closeOverlay();
  notify("Guard paused", `Tubby will stay quiet for ${minutes} minutes.`);
  updateTray();
}

function resumeGuard() {
  pausedUntil = 0;
  config.pausedUntil = 0;
  saveConfig(config);
  notify("Guard back on", "Tubby is watching the apps again.");
  updateTray();
}

function hardQuit() {
  quitting = true;
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  app.exit(0);
}

function startFocus(minutes) {
  focusMinutes = Math.max(1, Number(minutes) || 25);
  focusUntil = Date.now() + focusMinutes * 60_000;
  notify("Focus started", `${focusMinutes} minutes. Tubby is guarding your apps.`);
  updateTray();
}

function stopFocus() {
  if (focusUntil > Date.now()) notify("Focus stopped", "No session points this time.");
  focusUntil = 0;
  updateTray();
}

async function completeFocus(minutes) {
  try {
    const r = await backendJson("/api/points/earn", "POST", {
      deviceId: config.deviceId,
      event: "focus_session",
      minutes,
    });
    const earned = Number(r.earned || 0);
    notify("Session complete", earned > 0 ? `+${earned} points for ${minutes} minutes.` : r.reason || "Session logged.");
    await refreshPoints();
  } catch (e) {
    notify("Session complete", `${minutes} minutes. Points sync failed: ${e.message}`);
  }
  updateTray();
}

// ---- tray ---------------------------------------------------------------------------------

function iconImage() {
  const img = nativeImage.createFromPath(ICON);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function trayLabel() {
  if (pausedUntil > Date.now()) {
    return `${APP_NAME} · paused ${Math.ceil((pausedUntil - Date.now()) / 60000)}m`;
  }
  if (focusUntil > Date.now()) {
    const r = focusRemaining();
    const m = Math.floor(r / 60);
    const s = String(r % 60).padStart(2, "0");
    return `${APP_NAME} · focus ${m}:${s}`;
  }
  return `${APP_NAME} · ${cachedPoints} pts`;
}

function rebuildTray() {
  if (!tray) return;
  const focusActive = focusUntil > Date.now();
  const paused = pausedUntil > Date.now();
  const template = [
    { label: SAFE_MODE ? "SAFE MODE · guard disabled" : paused ? `Paused · ${Math.ceil((pausedUntil - Date.now()) / 60000)} min` : `${cachedPoints} pts · ${cachedStreak}d streak`, enabled: false },
    { type: "separator" },
    { label: "Open TubbyBuddy", click: showMain },
    focusActive
      ? { label: `Focus · ${Math.ceil(focusRemaining() / 60)} min left`, enabled: false }
      : {
          label: "Start focus",
          submenu: [15, 25, 45, 60].map((m) => ({ label: `${m} minutes`, click: () => startFocus(m) })),
        },
    focusActive ? { label: "Stop focus", click: stopFocus } : { label: "Stop focus", enabled: false },
    { type: "separator" },
    {
      label: "Guard apps",
      type: "checkbox",
      checked: !!config.guardEnabled,
      click: (item) => {
        config.guardEnabled = item.checked;
        saveConfig(config);
        updateTray();
      },
    },
    {
      label: "Always guard",
      type: "checkbox",
      checked: !!config.alwaysGuard,
      click: (item) => {
        config.alwaysGuard = item.checked;
        saveConfig(config);
        updateTray();
      },
    },
    paused
      ? { label: `Resume guard now (${Math.ceil((pausedUntil - Date.now()) / 60000)} min left)`, click: resumeGuard }
      : { label: "Pause guard for 10 minutes", click: () => pauseGuard(10) },
    ...(config.demoMode !== false
      ? [{ label: "Demo: turn guard off for 30 minutes", click: demoGuardOff }]
      : []),
    { label: scheduleActive() ? "Schedule is active now" : "Schedule…", click: openSettings },
    { type: "separator" },
    { label: "Desktop guard settings…", click: openSettings },
    { label: "Website blocking (Chrome extension)…", click: openExtension },
    { label: "Emergency: Ctrl+Alt+Shift+P pauses 10 min · Ctrl+Alt+Shift+Q quits", enabled: false },
    { type: "separator" },
    { label: "Quit TubbyBuddy", click: hardQuit },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(trayLabel());
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(trayLabel());
  rebuildTray();
}

function createTray() {
  const img = iconImage();
  if (img.isEmpty()) return;
  tray = new Tray(img);
  tray.on("click", showMain);
  tray.on("double-click", showMain);
  updateTray();
}

// ---- windows ------------------------------------------------------------------------------

function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    title: APP_NAME,
    backgroundColor: "#bfe3f7",
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : ICON,
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://127.0.0.1:${localPort}/`);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${localPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const catUrl = fs.existsSync(CAT) ? pathToFileURL(CAT).href : "";
  settingsWindow = new BrowserWindow({
    width: 780,
    height: 980,
    minWidth: 620,
    minHeight: 720,
    parent: mainWindow || undefined,
    show: false,
    title: "TubbyBuddy: Desktop guard",
    backgroundColor: "#bfe3f7",
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : ICON,
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(ROOT, "settings", "settings.html"), { query: { cat: catUrl } });
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function openExtension() {
  const candidates = [
    path.join(process.resourcesPath || "", "extension"),
    path.join(ROOT, "..", "extension"),
  ];
  const found = candidates.find((p) => p && fs.existsSync(path.join(p, "manifest.json")));
  if (!found) {
    dialog.showMessageBox({
      type: "info",
      title: "Website blocking",
      message: "Website blocking lives in the TubbyBuddy Chrome extension.",
      detail: "Load the extension/ folder in chrome://extensions (Developer mode). The desktop app currently guards native apps.",
    });
    return;
  }
  shell.openPath(found);
  dialog.showMessageBox({
    type: "info",
    title: "Website blocking",
    message: "Open chrome://extensions → Developer mode → Load unpacked.",
    detail: `Choose the folder that just opened:\n${found}`,
  });
}

// ---- guard --------------------------------------------------------------------------------

let appsCache = { at: 0, apps: [] };

function scanInstalledApps(force = false) {
  if (!force && appsCache.at && Date.now() - appsCache.at < 60_000) {
    return Promise.resolve({ apps: appsCache.apps, error: null });
  }
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(ROOT, "scripts", "apps.ps1"),
      ],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ apps: appsCache.apps, error: err ? String(err.message || err) : "No apps returned." });
          return;
        }
        try {
          const apps = JSON.parse(stdout.trim());
          if (!Array.isArray(apps)) throw new Error("Unexpected app list");
          appsCache = { at: Date.now(), apps };
          resolve({ apps, error: null });
        } catch (e) {
          resolve({ apps: appsCache.apps, error: String(e.message || e) });
        }
      },
    );
  });
}

function readForeground() {
  return new Promise((resolve) => {
    if (process.env.TUBBY_FAKE_FOREGROUND) {
      resolve({ name: process.env.TUBBY_FAKE_FOREGROUND, title: process.env.TUBBY_FAKE_FOREGROUND, pid: 0, valid: true });
      return;
    }
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(ROOT, "scripts", "foreground.ps1"),
      ],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        const line = stdout.trim().split(/\r?\n/).pop() || "";
        const [name, title, pid, valid] = line.split("|");
        if (!name) resolve(null);
        else resolve({ name: name.trim(), title: (title || "").trim(), pid: Number(pid) || 0, valid: valid !== "0" });
      },
    );
  });
}

function keyHit(text, key) {
  if (!key) return false;
  if (key.length <= 2) {
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${safe}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(key);
}

function blockedMatch(info) {
  const name = info.name.toLowerCase();
  const title = info.title.toLowerCase();
  if (!name || ["electron", "tubbybuddy", "explorer", "textinputhost", "shellexperiencehost"].includes(name)) return null;
  if ((config.allowlist || []).some((a) => String(a || "").trim().toLowerCase() === name)) return null;
  for (const [key, until] of Object.entries(config.unlocks || {})) {
    if (Number(until) > Date.now() && (name === key || keyHit(title, key))) return null;
  }
  for (const entry of config.blockedApps || []) {
    const key = String(entry || "").trim().toLowerCase();
    if (!key) continue;
    if (name === key || (key.length > 2 && (name.includes(key) || title.includes(key)))) return entry;
  }
  const browser = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"].some((b) => name.includes(b));
  if (browser) {
    for (const site of config.blockedSites || []) {
      const key = String(site || "").trim().toLowerCase();
      if (key && keyHit(title, key)) return site;
    }
  }
  return null;
}

async function guardTick() {
  if (IS_TEST || guardBusy || overlayOpen || !guardActive()) return;
  if (Date.now() - lastOverlayAt < 3000) return;
  guardBusy = true;
  try {
    const info = await readForeground();
    if (!info || info.valid === false) {
      pendingName = "";
      pendingCount = 0;
      return;
    }
    const hit = blockedMatch(info);
    if (!hit) {
      pendingName = "";
      pendingCount = 0;
      return;
    }
    const key = info.name.toLowerCase();
    if (pendingName === key) pendingCount += 1;
    else {
      pendingName = key;
      pendingCount = 1;
    }
    // Require two consecutive polls: a notification pop or a brief focus flash never triggers.
    if (pendingCount < 2) return;
    const until = cooldowns.get(key) || 0;
    if (until > Date.now()) return;
    await showBlockOverlay(info, hit);
  } finally {
    guardBusy = false;
  }
}

async function showBlockOverlay(info, hit) {
  if (overlayOpen) return;
  try {
    await refreshPoints();
  } catch {
    /* use cached */
  }
  currentThreat = {
    name: info.name,
    label: hit,
    title: info.title,
    atRisk: atRisk(),
    points: cachedPoints,
    streak: cachedStreak,
  };
  overlayOpen = true;
  lastOverlayAt = Date.now();
  allowOverlayClose = false;
  const display = screen.getPrimaryDisplay();
  const width = Math.min(1100, Math.max(760, display.bounds.width - 120));
  const height = Math.min(780, Math.max(580, display.bounds.height - 160));
  const x = display.bounds.x + Math.round((display.bounds.width - width) / 2);
  const y = display.bounds.y + Math.round((display.bounds.height - height) / 2);
  const catUrl = fs.existsSync(CAT) ? pathToFileURL(CAT).href : "";
  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: true,
    maximizable: false,
    closable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#bfe3f7",
    title: "TubbyBuddy: Hold up",
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(ROOT, "overlay", "block.html"), {
    query: {
      app: hit,
      points: String(cachedPoints),
      risk: String(currentThreat.atRisk),
      streak: String(cachedStreak),
      cat: catUrl,
    },
  });
  overlayWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      event.preventDefault();
      pauseGuard(10);
    }
  });
  overlayWindow.once("ready-to-show", () => {
    overlayWindow.show();
    overlayWindow.focus();
  });
  overlayWindow.on("closed", () => {
    const escaped = !allowOverlayClose;
    overlayWindow = null;
    overlayOpen = false;
    currentThreat = null;
    if (escaped && !quitting) {
      // Alt+F4 / window close is an escape hatch too: pause instead of immediately re-triggering.
      pausedUntil = Date.now() + 10 * 60_000;
      config.pausedUntil = pausedUntil;
      saveConfig(config);
      notify("Guard paused", "Tubby will stay quiet for 10 minutes.");
      updateTray();
    }
  });
}

function closeOverlay() {
  if (!overlayWindow) return;
  allowOverlayClose = true;
  overlayWindow.close();
}

async function putDown() {
  if (!currentThreat) return { earned: 0, reason: "No active block." };
  const threat = currentThreat;
  // Close the guard immediately. Network work happens after the desktop is usable again.
  closeOverlay();
  setTimeout(showMain, 100);
  try {
    const r = await backendJson("/api/points/earn", "POST", {
      deviceId: config.deviceId,
      event: "resisted_temptation",
      appName: threat.label,
    });
    // Put-downs are logged for badges and the Focus Score; points come from finished focus timers.
    notify("Put it down", `${threat.label} stays closed. Your points and streak are safe.`);
    await refreshPoints();
    return { earned: 0, reason: `${threat.label} stays closed. Your points and streak are safe.` };
  } catch (e) {
    notify("Saved for later", `Backend offline: ${e.message}`);
    return { earned: 0, reason: "Backend offline. Try again when it is running." };
  }
}

async function continueAnyway() {
  if (!currentThreat) return { burned: 0 };
  const threat = currentThreat;
  // The guard must disappear before any network request. This was the "stuck screen" bug.
  closeOverlay();
  cooldowns.set(threat.name.toLowerCase(), Date.now() + 10 * 60_000);
  try {
    const r = await backendJson("/api/points/burn", "POST", {
      deviceId: config.deviceId,
      reason: `Opened ${threat.label} anyway`,
      amount: threat.atRisk || 1,
      breaksStreak: true,
      // atRisk already includes the hard-mode multiplier shown on the guard.
      difficultyApplied: true,
      appName: threat.label,
    });
    const burned = Number(r.burned || 0);
    notify("Burned", burned > 0 ? `-${burned} points. ${threat.label} is open for 10 minutes.` : `${threat.label} is open for 10 minutes.`);
    await refreshPoints();
    return { burned };
  } catch (e) {
    notify("Guard offline", `Could not sync the burn: ${e.message}`);
    return { burned: 0 };
  }
}

async function unlockApp(appName) {
  const app = String(appName || "").trim().slice(0, 60);
  if (!app) throw new Error("Which app?");
  try {
    const r = await backendJson("/api/guard/unlock", "POST", {
      deviceId: config.deviceId,
      appName: app,
    });
    const until = Number(r.unlockedUntil || Date.now() + 10 * 60_000);
    config.unlocks = { ...(config.unlocks || {}), [app.toLowerCase()]: until };
    saveConfig(config);
    if (currentThreat && String(currentThreat.label).toLowerCase() === app.toLowerCase()) closeOverlay();
    await refreshPoints();
    return {
      allowed: true,
      burned: Number(r.burned || 0),
      penaltyUntil: Number(r.penaltyUntil || 0),
      penaltyMinutes: Number(r.penaltyMinutes || 0),
      unlockedUntil: until,
      reason: r.reason || `${app} unlocked for 10 minutes.`,
    };
  } catch (e) {
    // Daily cap reached: deny cleanly; the guard stays up, no offline fallback.
    if (e && e.status === 429) {
      return {
        allowed: false, burned: 0, penaltyUntil: 0, penaltyMinutes: 0, unlockedUntil: 0,
        reason: e.message || "No unlocks left today.",
      };
    }
    // Demo resilience: if the backend is offline, still leave the app usable and say so.
    const until = Date.now() + 10 * 60_000;
    config.unlocks = { ...(config.unlocks || {}), [app.toLowerCase()]: until };
    saveConfig(config);
    closeOverlay();
    return { allowed: true, burned: 0, penaltyUntil: 0, penaltyMinutes: 0, unlockedUntil: until, offline: true, reason: `Offline: ${app} open for 10 minutes.` };
  }
}

function demoGuardOff() {
  pauseGuard(30);
  notify("Demo guard off", "Guard is off for 30 minutes. Judges can breathe.");
  updateTray();
}

function guardConfigForChat() {
  return {
    blockedApps: config.blockedApps || [],
    blockedSites: config.blockedSites || [],
    allowlist: config.allowlist || [],
    demoMode: config.demoMode !== false,
    paused: pausedUntil > Date.now(),
  };
}

// ---- account: Google sign-in happens in the system browser; the app polls for its session ----------

let signInRun = null;
let signInCancelled = false;

function publicAccount() {
  return config.session && config.account ? { ...config.account, profileId: config.deviceId } : null;
}

function reloadDashboard() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
}

// Windows won't let a background app steal focus with focus() alone; pin it on top for a moment instead.
function bringToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  try { app.focus({ steal: true }); } catch { /* not supported on every platform */ }
  setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); }, 600);
}

async function signInWithBrowser() {
  if (signInRun) return signInRun;
  signInCancelled = false;
  signInRun = (async () => {
    try {
      const link = await backendJson("/api/auth/link", "POST", { label: "the Windows app" });
      if (!link || !link.code || !link.url) return { ok: false, error: "This server doesn't have Google sign-in set up." };
      await shell.openExternal(link.url);
      const until = Date.now() + 10 * 60_000;
      while (Date.now() < until) {
        await delay(1000);
        if (signInCancelled) return { ok: false, cancelled: true };
        let r;
        try {
          r = await backendJson(`/api/auth/link/${link.code}`, "GET", null, 4000);
        } catch {
          continue;
        }
        if (r.status === "approved" && r.token && r.account) {
          saveConfig({
            ...config,
            session: r.token,
            deviceId: r.account.profileId,
            account: { name: r.account.name, email: r.account.email, picture: r.account.picture, onboarded: !!r.account.onboarded },
          });
          refreshPoints();
          updateTray();
          notify("Signed in", `TubbyBuddy is using ${r.account.email || "your Google account"}.`);
          bringToFront();
          reloadDashboard();
          return { ok: true };
        }
        if (r.status === "expired") return { ok: false, error: "The sign-in link expired. Try again." };
      }
      return { ok: false, error: "Sign-in timed out. Try again." };
    } catch (e) {
      return { ok: false, error: e.message || "Couldn't reach the server." };
    } finally {
      signInRun = null;
    }
  })();
  return signInRun;
}

async function signOutDesktop() {
  try {
    if (config.session) await backendJson("/api/auth/logout", "POST", {}, 5000);
  } catch {
    /* the local sign-out still happens */
  }
  const next = { ...config, deviceId: randomId() };
  delete next.session;
  delete next.account;
  saveConfig(next);
  cachedPoints = 0;
  cachedStreak = 0;
  refreshPoints();
  updateTray();
  reloadDashboard();
  return true;
}

async function useDemoProfile() {
  const r = await backendJson("/api/demo/profile", "POST", {});
  if (!r || !r.deviceId) throw new Error("Couldn't open the demo account.");
  const next = { ...config, deviceId: r.deviceId };
  delete next.session;
  delete next.account;
  saveConfig(next);
  refreshPoints();
  updateTray();
  reloadDashboard();
  return true;
}

ipcMain.handle("desktop:account", () => publicAccount());
ipcMain.handle("desktop:sign-in", () => signInWithBrowser());
ipcMain.handle("desktop:cancel-sign-in", () => {
  signInCancelled = true;
  return true;
});
ipcMain.handle("desktop:sign-out", () => signOutDesktop());
ipcMain.handle("desktop:use-demo", () => useDemoProfile());
// The setup chat's picks: programs by name, sites by browser tab title.
ipcMain.handle("desktop:apply-setup", (event, setup) => {
  const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x || "").trim().slice(0, 60)).filter(Boolean).slice(0, 40);
  const apps = clean(setup && setup.apps);
  const sites = clean(setup && setup.sites);
  // Same rule as the phone: once you pick apps, the guard watches them all day, not only during focus sessions.
  saveConfig({ ...config, blockedApps: apps, blockedSites: sites, guardEnabled: true, alwaysGuard: true, desktopOnboarded: true });
  updateTray();
  return true;
});

ipcMain.on("desktop:device-id", (event) => {
  event.returnValue = config.deviceId;
});

ipcMain.handle("desktop:state", async () => ({
  deviceId: config.deviceId,
  points: cachedPoints,
  streak: cachedStreak,
  guardActive: guardActive(),
  pausedUntil,
  focusUntil,
  focusMinutes,
  backendUrl: config.backendUrl,
}));

ipcMain.handle("desktop:open-settings", () => {
  openSettings();
  return true;
});

ipcMain.handle("desktop:guard-config", () => guardConfigForChat());
ipcMain.handle("desktop:unlock-app", (event, appName) => unlockApp(appName));
ipcMain.handle("desktop:demo-off", () => {
  demoGuardOff();
  return true;
});

// A Muse Spark line for the open guard. The overlay already shows a local line; this only swaps the text if it arrives.
ipcMain.handle("overlay:nudge", async () => {
  const threat = currentThreat;
  if (!threat) return null;
  try {
    const r = await backendJson("/api/nudge", "POST", {
      deviceId: config.deviceId,
      appName: threat.label,
      pointsAtRisk: threat.atRisk,
      streak: threat.streak,
    }, 6000);
    return r && r.mode === "live" && typeof r.nudge === "string" ? r.nudge : null;
  } catch {
    return null;
  }
});
ipcMain.handle("overlay:put-down", () => putDown());
ipcMain.handle("overlay:continue", () => continueAnyway());
ipcMain.handle("overlay:close", () => {
  closeOverlay();
  return true;
});
ipcMain.handle("overlay:pause", () => {
  pauseGuard(10);
  return true;
});
ipcMain.handle("overlay:demo-off", () => {
  demoGuardOff();
  return true;
});
ipcMain.handle("overlay:quit", () => {
  hardQuit();
  return true;
});

ipcMain.handle("settings:load", () => {
  const { session, ...rest } = config;
  return { ...rest, signedIn: !!session, knownApps: [] };
});
ipcMain.handle("settings:apps", (event, force) => scanInstalledApps(!!force));
ipcMain.handle("settings:save", (event, next) => {
  if (!next || typeof next !== "object") throw new Error("Invalid settings");
  const merged = {
    ...config,
    backendUrl: String(next.backendUrl || config.backendUrl).trim(),
    backendChosen: config.backendChosen || String(next.backendUrl || config.backendUrl).trim() !== config.backendUrl,
    guardEnabled: !!next.guardEnabled,
    alwaysGuard: !!next.alwaysGuard,
    startAtLogin: !!next.startAtLogin,
    focusMinutes: Math.min(180, Math.max(5, Number(next.focusMinutes) || 25)),
    blockedApps: Array.isArray(next.blockedApps) ? next.blockedApps.slice(0, 40) : config.blockedApps,
    blockedSites: Array.isArray(next.blockedSites) ? next.blockedSites.slice(0, 40) : config.blockedSites,
    allowlist: Array.isArray(next.allowlist) ? next.allowlist.slice(0, 40) : config.allowlist,
    schedule: {
      enabled: !!next.schedule?.enabled,
      days: Array.isArray(next.schedule?.days) ? next.schedule.days : config.schedule.days,
      start: String(next.schedule?.start || config.schedule.start),
      end: String(next.schedule?.end || config.schedule.end),
    },
    deviceId: config.deviceId,
    session: config.session,
    account: config.account,
  };
  saveConfig(merged);
  try {
    app.setLoginItemSettings({ openAtLogin: merged.startAtLogin });
  } catch {
    /* ignore */
  }
  updateTray();
  refreshPoints();
  return merged;
});
ipcMain.handle("settings:close", () => {
  if (settingsWindow) settingsWindow.close();
  return true;
});

// ---- test captures ------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveShot(win, name) {
  if (!win) return;
  const img = await win.capturePage();
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CAPTURE_DIR, name), img.toPNG());
}

async function captureAll() {
  log("capture start");
  await delay(2500);  try {
    await mainWindow.webContents.executeJavaScript(
      "localStorage.setItem('tubbybuddy.onboarded.v1','1'); location.reload();",
    );
  } catch (e) {
    log("capture skip onboarding failed", String(e.message || e));
  }
  await delay(3500);
  log("capture main");
  await saveShot(mainWindow, "main.png");
  openSettings();
  await delay(2200);
  log("capture settings");
  await saveShot(settingsWindow, "settings.png");
  if (settingsWindow) settingsWindow.close();
  await delay(400);
  log("capture overlay");
  const fake = { name: "Discord", title: "Discord", pid: 0 };
  await showBlockOverlay(fake, "Discord");
  await delay(1800);
  await saveShot(overlayWindow, "overlay.png");
  closeOverlay();
  await delay(500);
  log("capture done");
  quitting = true;
  app.exit(0);
}

async function guardTest() {
  await delay(6000);
  log("guard test", { overlayOpen, threat: currentThreat });
  if (overlayOpen) await saveShot(overlayWindow, "guard-overlay.png");
  closeOverlay();
  await delay(400);
  quitting = true;
  app.exit(overlayOpen ? 0 : 2);
}

// ---- app lifecycle ------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());

  app.whenReady().then(async () => {
    log("app ready", { IS_TEST, WEB_DIR, localPort });
    try {
      // Honor the persisted setting, including turning off any old auto-start entry.
      app.setLoginItemSettings({ openAtLogin: !!config.startAtLogin });
    } catch {
      /* ignore */
    }
    if (IS_TEST) app.commandLine.appendSwitch("disable-gpu");
    startDesktopServer({
      webDir: WEB_DIR,
      getBackendUrl: () => config.backendUrl,
      getSessionToken: () => config.session || null,
    }).then(({ server, port }) => {
      log("local server", { port, webDir: WEB_DIR, exists: fs.existsSync(path.join(WEB_DIR, "index.html")) });
      localServer = server;
      localPort = port;
      createMainWindow();
      log("main window created");
      createTray();
      log("tray created");
      refreshPoints();
      // Emergency controls stay available even while the always-on-top overlay is focused.
      const pauseKeys = ["Control+Alt+Shift+P", "CommandOrControl+Alt+Shift+P"];
      const quitKeys = ["Control+Alt+Shift+Q", "CommandOrControl+Alt+Shift+Q"];
      pauseKeys.forEach((key) => {
        try { globalShortcut.register(key, () => pauseGuard(10)); } catch { /* ignore */ }
      });
      quitKeys.forEach((key) => {
        try { globalShortcut.register(key, hardQuit); } catch { /* ignore */ }
      });
      setInterval(guardTick, 1800);
      setInterval(() => {
        if (focusUntil && Date.now() >= focusUntil) {
          const m = focusMinutes;
          focusUntil = 0;
          completeFocus(m);
        }
        if (tray) tray.setToolTip(trayLabel());
      }, 1000);
      setInterval(() => updateTray(), 15_000);
      setInterval(() => {
        if (!focusUntil) refreshPoints();
      }, 30_000);
      if (IS_TEST) captureAll();
      if (GUARD_TEST) guardTest();
      log("started", { safeMode: SAFE_MODE, guard: guardActive() });
    }).catch((err) => {
      dialog.showErrorBox("TubbyBuddy could not start", String(err.message || err));
      app.quit();
    });
  });

  app.on("before-quit", () => {
    quitting = true;
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
    if (localServer) localServer.close();
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray. Quit is explicit in the tray menu.
  });

  app.on("activate", () => showMain());
}
