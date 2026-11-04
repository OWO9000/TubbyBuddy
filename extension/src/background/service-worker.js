/* Burn background service worker (MV3, type: module).
 * All network calls go through here so site CORS can never interfere.
 * Owns the offline ledger: earn/burn always apply locally and queue for
 * retry, so the user's action is never lost. */

import '../shared/constants.js';
import '../shared/match.js';
import '../shared/nudges.js';
import '../shared/storage.js';
import '../shared/api.js';

const C = globalThis.BurnConstants;
const Match = globalThis.BurnMatch;
const Nudges = globalThis.BurnNudges;
const Store = globalThis.BurnStorage;
const Api = globalThis.BurnApi;

function displayPoints(configured, balance) {
  if (typeof balance === 'number' && Number.isFinite(balance) && balance >= 0) {
    return Math.min(configured, Math.floor(balance));
  }
  return configured;
}

/* Best-effort balance/streak refresh from GET /api/me before the overlay
 * renders. Short timeout; on any failure returns null and callers fall back
 * to the local ledger. */
async function refreshBalanceFromMe(s) {
  try {
    const res = await Api.apiMe({
      backendUrl: s.backendUrl,
      deviceId: s.deviceId,
      timeoutMs: C.ME_REFRESH_TIMEOUT_MS || 2500
    });
    if (res && res.ok && res.data && typeof res.data === 'object') {
      const d = res.data;
      const cur = (await Store.getLocal()).ledger;
      if (typeof d.balance === 'number' && Number.isFinite(d.balance)) {
        cur.balance = Math.max(0, Math.floor(d.balance));
      }
      if (typeof d.streak === 'number' && Number.isFinite(d.streak)) {
        cur.streak = Math.max(0, Math.floor(d.streak));
      }
      cur.bestStreak = Math.max(cur.bestStreak || 0, cur.streak || 0);
      // Hard mode (chosen in the web app) doubles every slip; the overlay quotes the doubled stake.
      cur.hard = d.difficulty === 'hard';
      await Store.saveLedger(cur);
      return cur;
    }
  } catch {
    /* fall back to the local ledger */
  }
  return null;
}

function pushRecent(ledger, entry) {
  const max = C.MAX_RECENT || 20;
  const prev = Array.isArray(ledger.recent) ? ledger.recent : [];
  ledger.recent = [entry, ...prev].slice(0, max);
  return ledger;
}

function applyLocalEarn(ledger) {
  const l = {
    balance: null,
    streak: 0,
    bestStreak: 0,
    recent: [],
    ...(ledger && typeof ledger === 'object' ? ledger : {})
  };
  const earn = typeof C.LOCAL_EARN_FALLBACK === 'number' ? C.LOCAL_EARN_FALLBACK : 0;
  const prevBal = typeof l.balance === 'number' && Number.isFinite(l.balance) ? l.balance : 0;
  l.balance = prevBal + earn;
  l.streak = (Number.isFinite(l.streak) ? l.streak : 0) + 1;
  l.bestStreak = Math.max(l.bestStreak || 0, l.streak);
  pushRecent(l, { delta: earn, kind: 'earn', reason: 'resisted_temptation (pending sync)', at: Date.now() });
  return l;
}

function applyLocalBurn(ledger, amount) {
  const l = {
    balance: null,
    streak: 0,
    bestStreak: 0,
    recent: [],
    ...(ledger && typeof ledger === 'object' ? ledger : {})
  };
  const amt = Math.max(1, Math.floor(Number.isFinite(amount) ? amount : 50));
  if (typeof l.balance === 'number' && Number.isFinite(l.balance)) {
    l.balance = Math.max(0, l.balance - amt);
  }
  pushRecent(l, { delta: -Math.abs(amt), kind: 'burn', reason: 'Opened a limited site (pending sync)', at: Date.now() });
  return l;
}

async function updateBadge() {
  try {
    const local = await Store.getLocal();
    const n = Array.isArray(local.queue) ? local.queue.length : 0;
    if (chrome.action && chrome.action.setBadgeText) {
      await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
      if (n > 0 && chrome.action.setBadgeBackgroundColor) {
        await chrome.action.setBadgeBackgroundColor({ color: '#ff6b1a' });
      }
    }
  } catch {
    /* never crash on badge */
  }
}

async function ensureInstalledDefaults() {
  try {
    const s = await Store.getSyncSettings();
    const toSave = {};
    if (!s.backendUrl) toSave.backendUrl = C.DEFAULT_BACKEND_URL;
    let validId = false;
    try {
      validId = C.isValidDeviceId(s.deviceId);
    } catch {
      validId = false;
    }
    if (!validId) toSave.deviceId = Store.generateDeviceId();
    if (!Array.isArray(s.blockedSites)) toSave.blockedSites = [...C.DEFAULT_BLOCKED_SITES];
    if (!Number.isFinite(s.pointsAtRisk)) toSave.pointsAtRisk = C.DEFAULT_POINTS_AT_RISK;
    if (!C.TONES.includes(s.tone)) toSave.tone = C.DEFAULT_TONE;
    if (!Array.isArray(s.goals)) toSave.goals = [];
    if (Object.keys(toSave).length) await Store.saveSyncSettings(toSave);

    try {
      const raw = await chrome.storage.local.get(['ledger', 'queue', 'cooldowns']);
      const need = {};
      if (raw.ledger === undefined) need.ledger = Store.emptyLedger();
      if (raw.queue === undefined) need.queue = [];
      if (raw.cooldowns === undefined) need.cooldowns = {};
      if (Object.keys(need).length) await chrome.storage.local.set(need);
    } catch {
      /* ignore */
    }
    await updateBadge();
  } catch {
    /* ignore */
  }
}

async function flushQueue() {
  const s = await Store.getSyncSettings();
  const local = await Store.getLocal();
  let queue = Array.isArray(local.queue) ? [...local.queue] : [];
  if (!queue.length) {
    await updateBadge();
    return { flushed: 0, remaining: 0 };
  }
  let flushed = 0;
  while (queue.length > 0) {
    const ev = queue[0];
    if (!ev || typeof ev !== 'object' || (ev.type !== 'earn' && ev.type !== 'burn')) {
      queue.shift();
      await Store.saveQueue(queue);
      continue;
    }
    const appName =
      ev.appName || (ev.payload && ev.payload.appName) || 'this site';
    try {
      let res;
      if (ev.type === 'earn') {
        res = await Api.apiEarn({
          backendUrl: s.backendUrl,
          deviceId: s.deviceId,
          event: 'resisted_temptation',
          appName,
          timeoutMs: C.API_TIMEOUT_MS
        });
      } else {
        const rawAmt = Number.isFinite(ev.amount)
          ? ev.amount
          : ev.payload && Number.isFinite(ev.payload.amount)
            ? ev.payload.amount
            : s.pointsAtRisk;
        res = await Api.apiBurn({
          backendUrl: s.backendUrl,
          deviceId: s.deviceId,
          reason: 'Opened a limited site',
          amount: rawAmt,
          appName,
          breaksStreak: false,
          timeoutMs: C.API_TIMEOUT_MS
        });
      }
      if (res && res.ok && res.data && typeof res.data === 'object') {
        const d = res.data;
        const cur = (await Store.getLocal()).ledger;
        if (typeof d.balance === 'number' && Number.isFinite(d.balance)) {
          cur.balance = Math.max(0, Math.floor(d.balance));
        }
        if (typeof d.streak === 'number' && Number.isFinite(d.streak)) {
          cur.streak = Math.max(0, Math.floor(d.streak));
        }
        cur.bestStreak = Math.max(cur.bestStreak || 0, cur.streak || 0);
        await Store.saveLedger(cur);
        queue.shift();
        flushed += 1;
        await Store.saveQueue(queue);
      } else {
        const status = res ? res.status : 0;
        if (Api.isRetryableStatus(status)) {
          ev.attempts = (ev.attempts || 0) + 1;
          await Store.saveQueue(queue);
          break;
        }
        queue.shift();
        await Store.saveQueue(queue);
      }
    } catch (err) {
      if (Api.isRetryableError(err)) {
        ev.attempts = (ev.attempts || 0) + 1;
        await Store.saveQueue(queue);
        break;
      }
      await Store.saveQueue(queue);
      break;
    }
  }
  await updateBadge();
  const finalLocal = await Store.getLocal().catch(() => ({ queue }));
  return { flushed, remaining: (finalLocal.queue || []).length };
}

async function handleGetBlockState(url) {
  const s = await Store.getSyncSettings();
  const local = await Store.getLocal();
  const detail = Match.findMatchDetail(url, s.blockedSites || []);
  if (!detail) return { blocked: false };
  const expiry = local.cooldowns ? local.cooldowns[detail.entry] : null;
  if (typeof expiry === 'number' && expiry > Date.now()) {
    return { blocked: false, coolingDown: true, expiry };
  }
  const refreshed = await refreshBalanceFromMe(s);
  const ledger = refreshed || (local.ledger ? local.ledger : null);
  const balance = ledger ? ledger.balance : null;
  const stake = ledger && ledger.hard ? s.pointsAtRisk * 2 : s.pointsAtRisk;
  return {
    blocked: true,
    matchedEntry: detail.entry,
    canonical: detail.canonical,
    appName: detail.canonical || detail.host,
    pointsAtRisk: stake,
    displayAtRisk: displayPoints(stake, balance),
    streak: (ledger && ledger.streak) || 0,
    balance
  };
}

async function handleGetNudge(payload) {
  const s = await Store.getSyncSettings();
  const local = await Store.getLocal();
  const streak = (local.ledger && local.ledger.streak) || 0;
  const balance = local.ledger ? local.ledger.balance : null;
  const app =
    payload && typeof payload.appName === 'string' && payload.appName
      ? payload.appName
      : 'this site';
  const atRisk = displayPoints(s.pointsAtRisk, balance);
  const ctx = { appName: app, pointsAtRisk: atRisk, streak };
  try {
    const res = await Api.apiNudge({
      backendUrl: s.backendUrl,
      deviceId: s.deviceId,
      goals: s.goals,
      appName: app,
      pointsAtRisk: atRisk,
      streak,
      tone: s.tone,
      timeoutMs: C.NUDGE_TIMEOUT_MS
    });
    if (res && res.ok && res.data && typeof res.data.nudge === 'string' && res.data.nudge.trim()) {
      return {
        nudge: res.data.nudge.trim().slice(0, 500),
        offline: false,
        tone: typeof res.data.tone === 'string' ? res.data.tone : undefined,
        model: typeof res.data.model === 'string' ? res.data.model : undefined
      };
    }
  } catch {
    /* fall through to offline nudge */
  }
  return { nudge: Nudges.pickFallbackNudge(ctx), offline: true };
}

async function handleEarn(payload) {
  const s = await Store.getSyncSettings();
  const local = await Store.getLocal();
  const app =
    payload && typeof payload.appName === 'string' && payload.appName
      ? payload.appName
      : 'this site';
  const wirePayload = { deviceId: s.deviceId, event: 'resisted_temptation', appName: app };
  try {
    const res = await Api.apiEarn({
      backendUrl: s.backendUrl,
      deviceId: s.deviceId,
      event: 'resisted_temptation',
      appName: app,
      timeoutMs: C.API_TIMEOUT_MS
    });
    if (res && res.ok && res.data && typeof res.data === 'object') {
      const d = res.data;
      const ledger = local.ledger;
      if (typeof d.balance === 'number' && Number.isFinite(d.balance)) {
        ledger.balance = Math.max(0, Math.floor(d.balance));
      }
      if (typeof d.streak === 'number' && Number.isFinite(d.streak)) {
        ledger.streak = Math.max(0, Math.floor(d.streak));
      }
      ledger.bestStreak = Math.max(ledger.bestStreak || 0, ledger.streak || 0);
      const earned =
        typeof d.earned === 'number' && Number.isFinite(d.earned) ? Math.floor(d.earned) : null;
      const reason =
        typeof d.reason === 'string' && d.reason ? d.reason : 'resisted_temptation';
      pushRecent(ledger, { delta: earned != null ? earned : 0, kind: 'earn', reason, at: Date.now() });
      await Store.saveLedger(ledger);
      await updateBadge();
      return { earned, balance: ledger.balance, streak: ledger.streak, offline: false };
    }
    const status = res ? res.status : 0;
    const errText =
      res && res.data && typeof res.data.error === 'string' ? res.data.error : 'Request failed';
    if (Api.isRetryableStatus(status)) {
      await Store.enqueueEvent({ type: 'earn', payload: wirePayload, appName: app, attempts: 0, queuedAt: Date.now() });
      const ledger = applyLocalEarn(local.ledger);
      await Store.saveLedger(ledger);
      await updateBadge();
      return { offline: true, queued: true, balance: ledger.balance, streak: ledger.streak };
    }
    const ledger = applyLocalEarn(local.ledger);
    await Store.saveLedger(ledger);
    await updateBadge();
    return { offline: true, queued: false, error: errText, balance: ledger.balance, streak: ledger.streak };
  } catch {
    try {
      await Store.enqueueEvent({ type: 'earn', payload: wirePayload, appName: app, attempts: 0, queuedAt: Date.now() });
    } catch {
      /* ignore */
    }
    const fresh = await Store.getLocal().catch(() => local);
    const ledger = applyLocalEarn(fresh.ledger || local.ledger);
    try {
      await Store.saveLedger(ledger);
    } catch {
      /* ignore */
    }
    await updateBadge();
    return { offline: true, queued: true, balance: ledger.balance, streak: ledger.streak };
  }
}

async function handleBurn(payload) {
  const s = await Store.getSyncSettings();
  const local = await Store.getLocal();
  const app =
    payload && typeof payload.appName === 'string' && payload.appName
      ? payload.appName
      : 'this site';
  const rawAmt = payload && Number.isFinite(payload.amount) ? payload.amount : s.pointsAtRisk;
  const amt = Math.max(1, Math.floor(rawAmt));
  const wirePayload = {
    deviceId: s.deviceId,
    reason: 'Opened a limited site',
    amount: amt,
    appName: app,
    breaksStreak: false
  };
  try {
    const res = await Api.apiBurn({
      backendUrl: s.backendUrl,
      deviceId: s.deviceId,
      reason: 'Opened a limited site',
      amount: amt,
      appName: app,
      breaksStreak: false,
      timeoutMs: C.API_TIMEOUT_MS
    });
    if (res && res.ok && res.data && typeof res.data === 'object') {
      const d = res.data;
      const ledger = local.ledger;
      if (typeof d.balance === 'number' && Number.isFinite(d.balance)) {
        ledger.balance = Math.max(0, Math.floor(d.balance));
      }
      if (typeof d.streak === 'number' && Number.isFinite(d.streak)) {
        ledger.streak = Math.max(0, Math.floor(d.streak));
      }
      const burned =
        typeof d.burned === 'number' && Number.isFinite(d.burned) ? Math.floor(d.burned) : amt;
      if (burned !== 0) {
        pushRecent(ledger, { delta: -Math.abs(burned), kind: 'burn', reason: 'Opened a limited site', at: Date.now() });
      }
      await Store.saveLedger(ledger);
      await updateBadge();
      return { burned, balance: ledger.balance, streak: ledger.streak, offline: false };
    }
    const status = res ? res.status : 0;
    const errText =
      res && res.data && typeof res.data.error === 'string' ? res.data.error : 'Request failed';
    if (Api.isRetryableStatus(status)) {
      await Store.enqueueEvent({ type: 'burn', payload: wirePayload, appName: app, amount: amt, attempts: 0, queuedAt: Date.now() });
      const ledger = applyLocalBurn(local.ledger, amt);
      await Store.saveLedger(ledger);
      await updateBadge();
      return { offline: true, queued: true, balance: ledger.balance, streak: ledger.streak };
    }
    const ledger = applyLocalBurn(local.ledger, amt);
    await Store.saveLedger(ledger);
    await updateBadge();
    return { offline: true, queued: false, error: errText, balance: ledger.balance, streak: ledger.streak };
  } catch {
    try {
      await Store.enqueueEvent({ type: 'burn', payload: wirePayload, appName: app, amount: amt, attempts: 0, queuedAt: Date.now() });
    } catch {
      /* ignore */
    }
    const fresh = await Store.getLocal().catch(() => local);
    const ledger = applyLocalBurn(fresh.ledger || local.ledger, amt);
    try {
      await Store.saveLedger(ledger);
    } catch {
      /* ignore */
    }
    await updateBadge();
    return { offline: true, queued: true, balance: ledger.balance, streak: ledger.streak };
  }
}

async function handlePopupData() {
  try {
    await flushQueue();
  } catch {
    /* offline is fine */
  }
  const s = await Store.getSyncSettings();
  const local = await Store.getLocal();
  try {
    const res = await Api.apiMe({
      backendUrl: s.backendUrl,
      deviceId: s.deviceId,
      timeoutMs: C.API_TIMEOUT_MS
    });
    if (res && res.ok && res.data && typeof res.data === 'object') {
      const d = res.data;
      const ledger = local.ledger;
      if (typeof d.balance === 'number' && Number.isFinite(d.balance)) {
        ledger.balance = Math.max(0, Math.floor(d.balance));
      }
      if (typeof d.streak === 'number' && Number.isFinite(d.streak)) {
        ledger.streak = Math.max(0, Math.floor(d.streak));
      }
      if (typeof d.bestStreak === 'number' && Number.isFinite(d.bestStreak)) {
        ledger.bestStreak = Math.max(0, Math.floor(d.bestStreak));
      } else {
        ledger.bestStreak = Math.max(ledger.bestStreak || 0, ledger.streak || 0);
      }
      if (Array.isArray(d.recent)) {
        const norm = [];
        for (const r of d.recent.slice(0, C.MAX_RECENT || 20)) {
          if (!r || typeof r !== 'object') continue;
          norm.push({
            delta: typeof r.delta === 'number' ? r.delta : 0,
            kind: typeof r.kind === 'string' ? r.kind : 'unknown',
            reason: typeof r.reason === 'string' ? r.reason : '',
            at: typeof r.at === 'number' ? r.at : Date.now()
          });
        }
        if (norm.length) ledger.recent = norm;
      }
      await Store.saveLedger(ledger);
      const fresh = await Store.getLocal();
      await updateBadge();
      return { ledger, queueLen: (fresh.queue || []).length, online: true, backendUrl: s.backendUrl };
    }
    const fresh = await Store.getLocal();
    return {
      ledger: local.ledger,
      queueLen: (fresh.queue || []).length,
      online: true,
      backendUrl: s.backendUrl
    };
  } catch {
    const fresh = await Store.getLocal().catch(() => local);
    return {
      ledger: fresh.ledger || local.ledger,
      queueLen: (fresh.queue || []).length,
      online: false,
      backendUrl: s.backendUrl
    };
  }
}

async function handleTestHealth(backendUrl) {
  const raw = typeof backendUrl === 'string' ? backendUrl : '';
  if (!C.isValidBackendUrl(raw)) return { ok: false, error: 'Enter a valid http(s) URL.' };
  const base = Api.normalizeBackendUrl(raw, C.DEFAULT_BACKEND_URL);
  try {
    const res = await Api.apiHealth({ backendUrl: base, timeoutMs: C.HEALTH_TIMEOUT_MS });
    if (res && res.ok) return { ok: true, status: res.status };
    const errText =
      res && res.data && typeof res.data.error === 'string' ? res.data.error : 'Health check failed';
    return { ok: false, status: res ? res.status : 0, error: errText };
  } catch (err) {
    if (err && err.name === 'TimeoutError') return { ok: false, error: 'Timed out.' };
    return { ok: false, error: 'Unreachable.' };
  }
}

async function routeMessage(msg, sender) {
  if (!msg || typeof msg.type !== 'string') throw new Error('Unknown message');
  switch (msg.type) {
    case 'burn:get-block-state':
      return handleGetBlockState(typeof msg.url === 'string' ? msg.url : '');
    case 'burn:get-nudge':
      return handleGetNudge(msg);
    case 'burn:earn':
      return handleEarn(msg);
    case 'burn:burn':
      return handleBurn(msg);
    case 'burn:set-cooldown': {
      if (typeof msg.entry !== 'string' || !msg.entry.trim()) throw new Error('Missing entry');
      const expiry = await Store.setCooldown(msg.entry, C.COOLDOWN_MS);
      return { expiry };
    }
    case 'burn:close-tab': {
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') throw new Error('No sender tab');
      await chrome.tabs.remove(tabId);
      return { closed: true };
    }
    case 'burn:get-popup-data':
      return handlePopupData();
    case 'burn:flush-queue':
      return flushQueue();
    case 'burn:test-health':
      return handleTestHealth(msg.backendUrl);
    case 'burn:get-settings': {
      const s = await Store.getSyncSettings();
      return { settings: s };
    }
    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    await ensureInstalledDefaults();
    try {
      await chrome.alarms.create(C.SYNC_ALARM_NAME, { periodInMinutes: C.SYNC_ALARM_MINUTES });
    } catch {
      /* ignore */
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    await ensureInstalledDefaults();
    try {
      const existing = await chrome.alarms.get(C.SYNC_ALARM_NAME);
      if (!existing) {
        await chrome.alarms.create(C.SYNC_ALARM_NAME, { periodInMinutes: C.SYNC_ALARM_MINUTES });
      }
    } catch {
      /* ignore */
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === C.SYNC_ALARM_NAME) {
    flushQueue().catch(() => {});
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  try {
    if (details && details.frameId === 0 && typeof details.tabId === 'number' && details.tabId >= 0) {
      chrome.tabs.sendMessage(details.tabId, { type: 'burn:url-changed', url: details.url || '' }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const result = await routeMessage(msg, sender);
      sendResponse({ ok: true, ...(result && typeof result === 'object' ? result : {}) });
    } catch (err) {
      try {
        sendResponse({ ok: false, error: String((err && err.message) || err || 'Failed') });
      } catch {
        /* ignore */
      }
    }
  })();
  return true;
});
