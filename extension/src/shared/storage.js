/* Burn storage helpers. Classic script, attaches to globalThis.BurnStorage.
 * Settings live in chrome.storage.sync (small); ledger, queue and cooldowns
 * live in chrome.storage.local. Every getter is tolerant: corrupt or missing
 * values fall back to defaults and never throw. */
(function () {
  'use strict';

  function getConstants() {
    if (globalThis.BurnConstants) return globalThis.BurnConstants;
    return {
      DEFAULT_BACKEND_URL: 'https://tubbybuddy-production.up.railway.app',
      DEFAULT_BLOCKED_SITES: ['tiktok.com', 'instagram.com', 'x.com', 'youtube.com/shorts', 'reddit.com'],
      DEFAULT_POINTS_AT_RISK: 50,
      DEFAULT_TONE: 'playful',
      TONES: ['playful', 'tough-love', 'calm', 'hype', 'witty'],
      MAX_RECENT: 20,
      MAX_POINTS: 10000,
      MAX_GOALS: 6,
      COOLDOWN_MS: 300000,
      LOCAL_EARN_FALLBACK: 10,
      SYNC_ALARM_NAME: 'burn-sync',
      SYNC_ALARM_MINUTES: 5,
      normalizeBackendUrl: function (u) {
        return typeof u === 'string' ? u.trim().replace(/\/+$/, '') : '';
      }
    };
  }

  function hasChromeStorage(area) {
    try {
      return !!(
        globalThis.chrome &&
        chrome.storage &&
        chrome.storage[area] &&
        typeof chrome.storage[area].get === 'function'
      );
    } catch (e) {
      return false;
    }
  }

  function normalizeGoals(raw, maxGoals) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < maxGoals; i++) {
      if (typeof raw[i] !== 'string') continue;
      var t = raw[i].trim();
      if (!t) continue;
      out.push(t.slice(0, 200));
    }
    return out;
  }

  function normalizeBlockedSites(raw, defaults) {
    if (!Array.isArray(raw)) return defaults.slice();
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (typeof raw[i] !== 'string') continue;
      var t = raw[i].trim();
      if (!t) continue;
      if (out.indexOf(t) === -1) out.push(t);
      if (out.length >= 200) break;
    }
    return out;
  }

  function normalizePoints(raw, fallback, maxPoints) {
    var n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof n !== 'number' || !isFinite(n)) return fallback;
    n = Math.floor(n);
    if (n < 1) return fallback;
    if (n > maxPoints) return maxPoints;
    return n;
  }

  function getSyncSettings() {
    var C = getConstants();
    var defaults = {
      backendUrl: C.DEFAULT_BACKEND_URL,
      deviceId: '',
      goals: [],
      blockedSites: C.DEFAULT_BLOCKED_SITES.slice(),
      pointsAtRisk: C.DEFAULT_POINTS_AT_RISK,
      tone: C.DEFAULT_TONE
    };
    if (!hasChromeStorage('sync')) {
      return Promise.resolve({
        backendUrl: defaults.backendUrl,
        deviceId: '',
        goals: [],
        blockedSites: defaults.blockedSites.slice(),
        pointsAtRisk: defaults.pointsAtRisk,
        tone: defaults.tone
      });
    }
    return chrome.storage.sync
      .get(['backendUrl', 'deviceId', 'goals', 'blockedSites', 'pointsAtRisk', 'tone'])
      .then(function (s) {
        s = s && typeof s === 'object' ? s : {};
        var backendUrl =
          typeof s.backendUrl === 'string' && s.backendUrl.trim()
            ? s.backendUrl.trim().replace(/\/+$/, '')
            : C.DEFAULT_BACKEND_URL;
        var deviceId = typeof s.deviceId === 'string' ? s.deviceId.trim() : '';
        var tone =
          C.TONES && C.TONES.indexOf(s.tone) !== -1 ? s.tone : C.DEFAULT_TONE;
        return {
          backendUrl: backendUrl,
          deviceId: deviceId,
          goals: normalizeGoals(s.goals, C.MAX_GOALS || 6),
          blockedSites: normalizeBlockedSites(s.blockedSites, C.DEFAULT_BLOCKED_SITES),
          pointsAtRisk: normalizePoints(s.pointsAtRisk, C.DEFAULT_POINTS_AT_RISK, C.MAX_POINTS || 10000),
          tone: tone
        };
      })
      .catch(function () {
        return {
          backendUrl: defaults.backendUrl,
          deviceId: '',
          goals: [],
          blockedSites: defaults.blockedSites.slice(),
          pointsAtRisk: defaults.pointsAtRisk,
          tone: defaults.tone
        };
      });
  }

  function saveSyncSettings(partial) {
    if (!hasChromeStorage('sync')) return Promise.resolve();
    var allowed = {};
    if (!partial || typeof partial !== 'object') return Promise.resolve();
    if (partial.backendUrl !== undefined) allowed.backendUrl = partial.backendUrl;
    if (partial.deviceId !== undefined) allowed.deviceId = partial.deviceId;
    if (partial.goals !== undefined) allowed.goals = partial.goals;
    if (partial.blockedSites !== undefined) allowed.blockedSites = partial.blockedSites;
    if (partial.pointsAtRisk !== undefined) allowed.pointsAtRisk = partial.pointsAtRisk;
    if (partial.tone !== undefined) allowed.tone = partial.tone;
    try {
      return chrome.storage.sync.set(allowed).catch(function () {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  function emptyLedger() {
    return { balance: null, streak: 0, bestStreak: 0, recent: [] };
  }

  function normalizeLedger(raw) {
    var C = getConstants();
    var maxRecent = C.MAX_RECENT || 20;
    var l = raw && typeof raw === 'object' ? raw : {};
    var balance =
      typeof l.balance === 'number' && isFinite(l.balance) && l.balance >= 0
        ? Math.floor(l.balance)
        : null;
    var streak =
      typeof l.streak === 'number' && isFinite(l.streak) && l.streak >= 0
        ? Math.floor(l.streak)
        : 0;
    var bestStreak =
      typeof l.bestStreak === 'number' && isFinite(l.bestStreak) && l.bestStreak >= 0
        ? Math.floor(l.bestStreak)
        : 0;
    bestStreak = Math.max(bestStreak, streak);
    var recent = Array.isArray(l.recent) ? l.recent.slice(0, maxRecent) : [];
    return { balance: balance, streak: streak, bestStreak: bestStreak, recent: recent, hard: l.hard === true };
  }

  function normalizeQueue(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (e) {
      return e && typeof e === 'object';
    });
  }

  function normalizeCooldowns(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    var out = {};
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (typeof raw[k] === 'number' && isFinite(raw[k])) out[k] = raw[k];
    }
    return out;
  }

  function getLocal() {
    var fallback = { ledger: emptyLedger(), queue: [], cooldowns: {} };
    if (!hasChromeStorage('local')) return Promise.resolve(fallback);
    return chrome.storage.local
      .get(['ledger', 'queue', 'cooldowns'])
      .then(function (s) {
        s = s && typeof s === 'object' ? s : {};
        return {
          ledger: normalizeLedger(s.ledger),
          queue: normalizeQueue(s.queue),
          cooldowns: normalizeCooldowns(s.cooldowns)
        };
      })
      .catch(function () {
        return { ledger: emptyLedger(), queue: [], cooldowns: {} };
      });
  }

  function saveLocal(partial) {
    if (!hasChromeStorage('local')) return Promise.resolve();
    if (!partial || typeof partial !== 'object') return Promise.resolve();
    var allowed = {};
    if (partial.ledger !== undefined) allowed.ledger = partial.ledger;
    if (partial.queue !== undefined) allowed.queue = partial.queue;
    if (partial.cooldowns !== undefined) allowed.cooldowns = partial.cooldowns;
    try {
      return chrome.storage.local.set(allowed).catch(function () {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  function saveLedger(ledger) {
    return saveLocal({ ledger: normalizeLedger(ledger) });
  }

  function saveQueue(queue) {
    return saveLocal({ queue: normalizeQueue(queue) });
  }

  function enqueueEvent(event) {
    return getLocal().then(function (local) {
      var q = local.queue || [];
      q.push(event);
      return saveQueue(q).then(function () {
        return q.length;
      });
    });
  }

  function isCoolingDown(entry, cooldowns, nowMs) {
    if (typeof entry !== 'string' || !entry) return false;
    if (!cooldowns || typeof cooldowns !== 'object') return false;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var expiry = cooldowns[entry];
    return typeof expiry === 'number' && expiry > now;
  }

  function setCooldown(entry, cooldownMs) {
    var C = getConstants();
    var ms = typeof cooldownMs === 'number' && isFinite(cooldownMs) ? cooldownMs : C.COOLDOWN_MS;
    return getLocal().then(function (local) {
      var cooldowns = local.cooldowns || {};
      var expiry = Date.now() + ms;
      cooldowns[entry] = expiry;
      return saveLocal({ cooldowns: cooldowns }).then(function () {
        return expiry;
      });
    });
  }

  function generateDeviceId() {
    var id = '';
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        id = 'ext-' + globalThis.crypto.randomUUID();
      } else if (globalThis.crypto && globalThis.crypto.getRandomValues) {
        var bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
          hex += ('0' + bytes[i].toString(16)).slice(-2);
        }
        id =
          'ext-' +
          hex.slice(0, 8) +
          '-' +
          hex.slice(8, 12) +
          '-' +
          hex.slice(12, 16) +
          '-' +
          hex.slice(16, 20) +
          '-' +
          hex.slice(20);
      } else {
        id = 'ext-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      }
    } catch (e) {
      id = 'ext-' + Date.now().toString(36) + '-fallback';
    }
    id = String(id).replace(/[^A-Za-z0-9._:-]/g, '-');
    if (id.length < 4) id = 'ext-' + Date.now().toString(36);
    if (id.length > 128) id = id.slice(0, 128);
    return id;
  }

  function ensureDeviceId() {
    return getSyncSettings().then(function (s) {
      var C = getConstants();
      var valid = false;
      try {
        valid =
          typeof s.deviceId === 'string' &&
          new RegExp(C.DEVICE_ID_RE_SRC || '^[A-Za-z0-9._:-]{4,128}$').test(s.deviceId);
      } catch (e) {
        valid = false;
      }
      if (valid) return s.deviceId;
      var id = generateDeviceId();
      return saveSyncSettings({ deviceId: id }).then(function () {
        return id;
      });
    });
  }

  globalThis.BurnStorage = {
    getSyncSettings: getSyncSettings,
    saveSyncSettings: saveSyncSettings,
    getLocal: getLocal,
    saveLocal: saveLocal,
    saveLedger: saveLedger,
    saveQueue: saveQueue,
    enqueueEvent: enqueueEvent,
    isCoolingDown: isCoolingDown,
    setCooldown: setCooldown,
    generateDeviceId: generateDeviceId,
    ensureDeviceId: ensureDeviceId,
    emptyLedger: emptyLedger,
    normalizeLedger: normalizeLedger
  };
})();
