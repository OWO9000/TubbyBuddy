/* Burn shared constants. Classic script (no imports/exports) so it can load
 * in MV3 content scripts, popup/options pages, and as a side-effect module
 * import in the service worker. Attaches to globalThis.BurnConstants. */
(function () {
  'use strict';

  var BurnConstants = {
    APP_NAME: 'TubbyBuddy',
    TAGLINE: 'Put your distractions down. Earn real life.',
    COMPANION: 'Tubby',

    DEFAULT_BACKEND_URL: 'https://tubbybuddy-production.up.railway.app',
    DEFAULT_BLOCKED_SITES: [
      'tiktok.com',
      'instagram.com',
      'x.com',
      'youtube.com/shorts',
      'reddit.com'
    ],
    DEFAULT_POINTS_AT_RISK: 50,
    DEFAULT_TONE: 'playful',
    TONES: ['playful', 'tough-love', 'calm', 'hype', 'witty'],
    DEFAULT_GOALS: [],
    FALLBACK_GOALS: ['Spend less time scrolling'],

    COOLDOWN_MS: 10 * 60 * 1000,
    NUDGE_TIMEOUT_MS: 4000,
    NUDGE_CONTENT_TIMEOUT_MS: 4200,
    API_TIMEOUT_MS: 8000,
    HEALTH_TIMEOUT_MS: 5000,
    ME_REFRESH_TIMEOUT_MS: 2500,

    /** Put-downs pay no points (they are logged for badges); points come from finished focus timers. */
    LOCAL_EARN_FALLBACK: 0,

    SYNC_ALARM_NAME: 'burn-sync',
    SYNC_ALARM_MINUTES: 5,

    DEVICE_ID_RE_SRC: '^[A-Za-z0-9._:-]{4,128}$',
    MAX_GOALS: 6,
    MAX_RECENT: 20,
    MAX_POINTS: 10000
  };

  BurnConstants.deviceIdRegex = function () {
    return new RegExp(BurnConstants.DEVICE_ID_RE_SRC);
  };

  BurnConstants.isValidDeviceId = function (id) {
    return typeof id === 'string' && BurnConstants.deviceIdRegex().test(id);
  };

  BurnConstants.normalizeBackendUrl = function (url) {
    if (typeof url !== 'string') return '';
    var s = url.trim().replace(/\/+$/, '');
    return s;
  };

  BurnConstants.isValidBackendUrl = function (url) {
    if (typeof url !== 'string') return false;
    var s = url.trim();
    if (!s) return false;
    try {
      var u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  };

  BurnConstants.isValidTone = function (tone) {
    return BurnConstants.TONES.indexOf(tone) !== -1;
  };

  BurnConstants.normalizePoints = function (value, fallback) {
    var n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !isFinite(n)) return fallback;
    n = Math.floor(n);
    if (n < 1) return fallback;
    if (n > BurnConstants.MAX_POINTS) return BurnConstants.MAX_POINTS;
    return n;
  };

  globalThis.BurnConstants = BurnConstants;
})();
