/* Burn API client. Classic script, attaches to globalThis.BurnApi.
 * Only used from the service worker so site CORS can never interfere.
 * Every request is JSON, carries x-device-id, and has an AbortController
 * timeout. All responses are parsed tolerantly: unknown or missing fields
 * yield null/empty data, never an exception. */
(function () {
  'use strict';

  var VALID_TONES = ['playful', 'tough-love', 'calm', 'hype', 'witty'];
  var FALLBACK_GOALS = ['Spend less time scrolling'];

  function normalizeBackendUrl(url, fallback) {
    var fb = typeof fallback === 'string' && fallback ? fallback : 'https://tubbybuddy-production.up.railway.app';
    if (globalThis.BurnConstants && typeof globalThis.BurnConstants.normalizeBackendUrl === 'function') {
      var s = globalThis.BurnConstants.normalizeBackendUrl(url);
      return s || fb;
    }
    if (typeof url !== 'string') return fb;
    var t = url.trim().replace(/\/+$/, '');
    return t || fb;
  }

  function fetchJsonWithTimeout(url, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var method = opts.method || 'GET';
    var headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
    var body = opts.body;
    var timeoutMs =
      typeof opts.timeoutMs === 'number' && isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000;

    var controller = new AbortController();
    var timer = setTimeout(function () {
      try {
        controller.abort();
      } catch (e) {
        /* ignore */
      }
    }, timeoutMs);

    var outHeaders = { 'Content-Type': 'application/json' };
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) outHeaders[k] = headers[k];
    }

    var payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }

    return fetch(url, {
      method: method,
      headers: outHeaders,
      body: payload,
      signal: controller.signal
    })
      .then(function (res) {
        clearTimeout(timer);
        return res
          .text()
          .then(function (text) {
            var data = null;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch (e) {
                data = { _raw: text };
              }
            }
            return { ok: res.ok, status: res.status, data: data };
          })
          .catch(function () {
            return { ok: res.ok, status: res.status, data: null };
          });
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
          var t = new Error('Request timed out');
          t.name = 'TimeoutError';
          throw t;
        }
        throw err;
      });
  }

  function normalizeGoals(goals) {
    var out = [];
    if (Array.isArray(goals)) {
      for (var i = 0; i < goals.length && out.length < 6; i++) {
        if (typeof goals[i] !== 'string') continue;
        var t = goals[i].trim();
        if (t.length >= 2 && t.length <= 200) out.push(t);
      }
    }
    if (!out.length) return FALLBACK_GOALS.slice();
    return out;
  }

  function toInt(value, fallback) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    return Math.floor(value);
  }

  function apiNudge(args) {
    args = args && typeof args === 'object' ? args : {};
    var base = normalizeBackendUrl(args.backendUrl);
    var body = {
      deviceId: String(args.deviceId || ''),
      goals: normalizeGoals(args.goals),
      appName: String(args.appName || 'this site'),
      pointsAtRisk: toInt(args.pointsAtRisk, 50),
      streak: toInt(args.streak, 0)
    };
    if (VALID_TONES.indexOf(args.tone) !== -1) body.tone = args.tone;
    return fetchJsonWithTimeout(base + '/api/nudge', {
      method: 'POST',
      headers: { 'x-device-id': String(args.deviceId || '') },
      body: body,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 4000
    });
  }

  function apiEarn(args) {
    args = args && typeof args === 'object' ? args : {};
    var base = normalizeBackendUrl(args.backendUrl);
    var body = {
      deviceId: String(args.deviceId || ''),
      event: String(args.event || 'resisted_temptation'),
      appName: String(args.appName || 'this site')
    };
    return fetchJsonWithTimeout(base + '/api/points/earn', {
      method: 'POST',
      headers: { 'x-device-id': String(args.deviceId || '') },
      body: body,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000
    });
  }

  function apiBurn(args) {
    args = args && typeof args === 'object' ? args : {};
    var base = normalizeBackendUrl(args.backendUrl);
    var body = {
      deviceId: String(args.deviceId || ''),
      reason: String(args.reason || 'Opened a limited site'),
      amount: toInt(args.amount, 50),
      appName: String(args.appName || 'this site'),
      breaksStreak: false,
      // The stake already includes any hard-mode multiplier.
      difficultyApplied: true
    };
    return fetchJsonWithTimeout(base + '/api/points/burn', {
      method: 'POST',
      headers: { 'x-device-id': String(args.deviceId || '') },
      body: body,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000
    });
  }

  function apiMe(args) {
    args = args && typeof args === 'object' ? args : {};
    var base = normalizeBackendUrl(args.backendUrl);
    var deviceId = String(args.deviceId || '');
    return fetchJsonWithTimeout(base + '/api/me?deviceId=' + encodeURIComponent(deviceId), {
      method: 'GET',
      headers: { 'x-device-id': deviceId },
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000
    });
  }

  function apiHealth(args) {
    args = args && typeof args === 'object' ? args : {};
    var base = normalizeBackendUrl(args.backendUrl);
    var headers = {};
    if (args.deviceId) headers['x-device-id'] = String(args.deviceId);
    return fetchJsonWithTimeout(base + '/api/health', {
      method: 'GET',
      headers: headers,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 5000
    });
  }

  function isRetryableStatus(status) {
    if (typeof status !== 'number') return true;
    if (status === 408 || status === 429) return true;
    return status >= 500;
  }

  function isRetryableError(err) {
    if (!err || typeof err !== 'object') return true;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
    if (err.name === 'TypeError') return true;
    return true;
  }

  globalThis.BurnApi = {
    normalizeBackendUrl: normalizeBackendUrl,
    fetchJsonWithTimeout: fetchJsonWithTimeout,
    apiNudge: apiNudge,
    apiEarn: apiEarn,
    apiBurn: apiBurn,
    apiMe: apiMe,
    apiHealth: apiHealth,
    isRetryableStatus: isRetryableStatus,
    isRetryableError: isRetryableError
  };
})();
