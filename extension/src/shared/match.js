/* Burn site matching. Classic UMD-style script: no imports/exports, attaches
 * to globalThis.BurnMatch. Works when loaded via a <script> tag, a manifest
 * content_scripts js array, or a side-effect ESM import in Node/the worker:
 *   import '../src/shared/match.js';
 *   const { isBlocked } = globalThis.BurnMatch;
 */
(function () {
  'use strict';

  function parseEntry(entry) {
    if (typeof entry !== 'string') return null;
    var s = entry.trim();
    if (!s) return null;

    var schemeIdx = s.indexOf('://');
    if (schemeIdx !== -1) {
      s = s.slice(schemeIdx + 3);
    } else if (s.slice(0, 2) === '//') {
      s = s.slice(2);
    }

    var cut = s.search(/[?#]/);
    if (cut !== -1) s = s.slice(0, cut);
    s = s.trim();
    if (!s) return null;

    var slash = s.indexOf('/');
    var hostPart;
    var pathPart;
    if (slash === -1) {
      hostPart = s;
      pathPart = '';
    } else {
      hostPart = s.slice(0, slash);
      pathPart = s.slice(slash);
    }

    hostPart = hostPart.trim().toLowerCase();
    if (hostPart.slice(-1) === '.') hostPart = hostPart.slice(0, -1);

    if (hostPart.charAt(0) === '[') {
      var close = hostPart.indexOf(']');
      if (close === -1) return null;
      var after = hostPart.slice(close + 1);
      if (after) {
        if (after.charAt(0) !== ':') return null;
        var portV6 = after.slice(1);
        if (!/^\d+$/.test(portV6)) return null;
        hostPart = hostPart.slice(0, close + 1);
      }
    } else {
      var colon = hostPart.lastIndexOf(':');
      if (colon !== -1) {
        var port = hostPart.slice(colon + 1);
        if (/^\d+$/.test(port)) {
          hostPart = hostPart.slice(0, colon);
        } else {
          return null;
        }
      }
    }

    if (!hostPart) return null;
    if (/\s/.test(hostPart)) return null;
    if (!/^[a-z0-9.\-_\[\]]+$/.test(hostPart)) return null;

    var path = '';
    if (pathPart) {
      path = pathPart.trim().replace(/\/+$/, '');
      if (path && path.charAt(0) !== '/') path = '/' + path;
      path = path.toLowerCase();
      if (path === '/') path = '';
    }

    return { host: hostPart, path: path, raw: entry.trim() };
  }

  function canonicalEntry(entry) {
    var p = parseEntry(entry);
    if (!p) return null;
    return p.host + p.path;
  }

  function normalizeUrlPath(pathname) {
    var p = String(pathname || '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p.toLowerCase();
  }

  function matchesEntry(urlStr, entry) {
    var url;
    try {
      url = typeof urlStr === 'string' ? new URL(urlStr) : urlStr;
      if (!url || !url.hostname) return false;
    } catch (e) {
      return false;
    }
    var parsed = parseEntry(entry);
    if (!parsed) return false;
    var urlHost = String(url.hostname).toLowerCase();
    if (urlHost.slice(-1) === '.') urlHost = urlHost.slice(0, -1);
    if (!(urlHost === parsed.host || urlHost.slice(-parsed.host.length - 1) === '.' + parsed.host)) {
      return false;
    }
    if (!parsed.path) return true;
    var urlPath = normalizeUrlPath(url.pathname);
    if (urlPath === parsed.path) return true;
    return urlPath.slice(0, parsed.path.length + 1) === parsed.path + '/';
  }

  function findMatchingEntry(urlStr, entries) {
    if (!Array.isArray(entries)) return null;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (typeof e !== 'string') continue;
      if (!e.trim()) continue;
      try {
        if (matchesEntry(urlStr, e)) return e;
      } catch (err) {
        continue;
      }
    }
    return null;
  }

  function findMatchDetail(urlStr, entries) {
    var matched = findMatchingEntry(urlStr, entries);
    if (!matched) return null;
    var p = parseEntry(matched);
    if (!p) return { entry: matched, canonical: String(matched).trim(), host: '', path: '' };
    return { entry: matched, canonical: p.host + p.path, host: p.host, path: p.path };
  }

  function isBlocked(urlStr, entries) {
    return findMatchingEntry(urlStr, entries) !== null;
  }

  function siteLabelForUrl(urlStr, entries) {
    try {
      var d = findMatchDetail(urlStr, entries || []);
      if (d && d.canonical) return d.canonical;
    } catch (e) {
      /* fall through */
    }
    try {
      var u = new URL(urlStr);
      return u.hostname || 'this site';
    } catch (e) {
      return 'this site';
    }
  }

  globalThis.BurnMatch = {
    parseEntry: parseEntry,
    canonicalEntry: canonicalEntry,
    matchesEntry: matchesEntry,
    findMatchingEntry: findMatchingEntry,
    findMatchDetail: findMatchDetail,
    isBlocked: isBlocked,
    siteLabelForUrl: siteLabelForUrl
  };
})();
