/* Burn content script. Classic script (no imports/exports); shared classic
 * scripts load before it via the manifest. Runs at document_start on all
 * URLs but exits cheaply on non-matching sites: one storage read, one match
 * check, and a lightweight URL watcher for SPA (History API) navigation. */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  try {
    if (window.top !== window.self) return;
  } catch (e) {
    return;
  }
  if (window.__burnGuardLoaded) return;
  window.__burnGuardLoaded = true;

  var C = globalThis.BurnConstants;
  var Match = globalThis.BurnMatch;
  var Nudges = globalThis.BurnNudges;
  var Store = globalThis.BurnStorage;
  if (!C || !Match || !Nudges || !Store) return;
  if (!globalThis.chrome || !chrome.storage || !chrome.runtime || !chrome.runtime.sendMessage) return;

  var lastUrl = location.href;
  var overlayHost = null;
  var overlayShadow = null;
  var mediaObserver = null;
  var currentMatch = null;
  var checking = false;
  var checkTimer = null;
  var savedOverflowDoc = '';
  var savedOverflowBody = '';

  var OVERLAY_CSS = [
    ':host { all: initial; }',
    '.burn-overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 24px; background: #0e0c0a; color: #fff7ed; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Verdana, sans-serif; }',
    '.burn-card { width: min(560px, 100%); max-height: 92vh; overflow: auto; background: #1a1410; border: 1px solid #3a2a1d; border-radius: 14px; padding: 32px 30px; text-align: center; box-shadow: 0 24px 80px rgba(0,0,0,.6); }',
    '.burn-ember { display: flex; justify-content: center; margin-bottom: 8px; }',
    '.burn-tubby { width: 124px; height: auto; display: block; filter: drop-shadow(0 10px 22px rgba(0,0,0,.45)); animation: burn-bob 2.4s ease-in-out infinite; transform-origin: 50% 92%; }',
    '.ember-svg { animation: burn-bob 2.4s ease-in-out infinite; transform-origin: 50% 90%; }',
    '@keyframes burn-bob { 0%,100% { transform: translateY(0) scaleY(1); } 50% { transform: translateY(-4px) scaleY(1.02); } }',
    '.burn-eyebrow { font-size: 13px; letter-spacing: .04em; color: #ffb347; margin: 0 0 6px; }',
    '.burn-title { font-size: 34px; line-height: 1.15; margin: 0 0 6px; color: #fff7ed; }',
    '.burn-sub { font-size: 18px; margin: 0 0 14px; color: #e8d9c8; }',
    '.burn-sub strong { color: #ffb347; word-break: break-all; }',
    '.burn-nudge { font-size: 19px; line-height: 1.5; background: #241a12; border: 1px solid #3a2a1d; border-radius: 10px; padding: 14px 16px; margin: 0 0 14px; min-height: 3.2em; }',
    '.burn-stats { font-size: 17px; margin: 0 0 20px; color: #ffd9a8; }',
    '.burn-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }',
    '.burn-btn { font-size: 18px; font-weight: 700; padding: 13px 22px; border-radius: 10px; border: 2px solid transparent; cursor: pointer; min-width: 170px; }',
    '.burn-btn:disabled { opacity: .6; cursor: wait; }',
    '.burn-primary { background: #ff7a1a; color: #1a0d03; border-color: #ff7a1a; }',
    '.burn-primary:hover:not(:disabled) { background: #ff8c3d; }',
    '.burn-secondary { background: transparent; color: #ffd9a8; border-color: #6b4a2c; }',
    '.burn-secondary:hover:not(:disabled) { border-color: #ff7a1a; color: #fff7ed; }',
    '.burn-btn:focus-visible { outline: 3px solid #ffd9a8; outline-offset: 2px; }',
    '.burn-status { font-size: 20px; font-weight: 800; color: #7dffa8; margin: 14px 0 0; min-height: 1.4em; }',
    '.burn-tagline { font-size: 14px; color: #a8906f; margin: 14px 0 0; }',
    '@media (prefers-reduced-motion: reduce) { .ember-svg, .burn-tubby { animation: none; } }'
  ].join('\n');

  /** The same Tubby art the phone uses (assets are declared as web_accessible_resources). */
  function tubbyImg() {
    try {
      return '<img class="burn-tubby" alt="" src="' + chrome.runtime.getURL('assets/tubby-worried.png') + '">';
    } catch (e) {
      return emberSvgWorried();
    }
  }

  function emberSvgWorried() {
    return (
      '<svg class="ember-svg" viewBox="0 0 64 76" width="76" height="90" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="burnFlameW" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff5a1f"/>' +
      '</linearGradient></defs>' +
      '<path d="M32 2 C40 14 52 22 52 42 C52 58 43 70 32 70 C21 70 12 58 12 42 C12 34 15 28 18 24 C19 30 22 32 24 32 C23 24 27 12 32 2 Z" fill="url(#burnFlameW)"/>' +
      '<ellipse cx="32" cy="52" rx="10" ry="11" fill="#ffd08a" opacity="0.9"/>' +
      '<circle cx="25" cy="44" r="4.6" fill="#ffffff"/>' +
      '<circle cx="39" cy="44" r="4.6" fill="#ffffff"/>' +
      '<circle cx="25.5" cy="45" r="2.1" fill="#1a0f0a"/>' +
      '<circle cx="38.5" cy="45" r="2.1" fill="#1a0f0a"/>' +
      '<path d="M20 35.5 L29 37.5" stroke="#5b2a12" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M44 35.5 L35 37.5" stroke="#5b2a12" stroke-width="2" stroke-linecap="round"/>' +
      '<ellipse cx="32" cy="59" rx="3" ry="4" fill="#5b1a0a"/>' +
      '</svg>'
    );
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sendMessageWithTimeout(msg, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          var e = new Error('Message timeout');
          e.name = 'TimeoutError';
          reject(e);
        }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Message failed'));
          } else {
            resolve(resp);
          }
        });
      } catch (err) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  }

  function directBlockState(url) {
    return Promise.all([Store.getSyncSettings(), Store.getLocal()]).then(function (pair) {
      var settings = pair[0];
      var local = pair[1];
      var detail = Match.findMatchDetail(url, settings.blockedSites || []);
      if (!detail) return { blocked: false };
      var expiry = local.cooldowns ? local.cooldowns[detail.entry] : null;
      if (typeof expiry === 'number' && expiry > Date.now()) {
        return { blocked: false, coolingDown: true };
      }
      var bal = local.ledger ? local.ledger.balance : null;
      var display =
        typeof bal === 'number' && isFinite(bal) && bal >= 0
          ? Math.min(settings.pointsAtRisk, Math.floor(bal))
          : settings.pointsAtRisk;
      return {
        blocked: true,
        matchedEntry: detail.entry,
        canonical: detail.canonical,
        appName: detail.canonical || detail.host,
        pointsAtRisk: settings.pointsAtRisk,
        displayAtRisk: display,
        streak: (local.ledger && local.ledger.streak) || 0,
        balance: bal
      };
    });
  }

  function getBlockState(url) {
    return sendMessageWithTimeout({ type: 'burn:get-block-state', url: url }, 5000).then(
      function (resp) {
        if (resp && (resp.blocked === true || resp.blocked === false)) return resp;
        if (resp && resp.ok === false) return directBlockState(url);
        return directBlockState(url);
      },
      function () {
        return directBlockState(url);
      }
    );
  }

  function pauseMedia() {
    try {
      var els = document.querySelectorAll('video,audio');
      for (var i = 0; i < els.length; i++) {
        try {
          if (!els[i].paused) els[i].pause();
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function startMediaObserver() {
    stopMediaObserver();
    try {
      if (typeof MutationObserver === 'undefined') return;
      mediaObserver = new MutationObserver(function () {
        pauseMedia();
      });
      mediaObserver.observe(document.documentElement || document, {
        childList: true,
        subtree: true
      });
    } catch (e) {
      mediaObserver = null;
    }
  }

  function stopMediaObserver() {
    try {
      if (mediaObserver) mediaObserver.disconnect();
    } catch (e) {
      /* ignore */
    }
    mediaObserver = null;
  }

  function blockScroll() {
    try {
      savedOverflowDoc = document.documentElement ? document.documentElement.style.overflow : '';
      savedOverflowBody = document.body ? document.body.style.overflow : '';
      if (document.documentElement) document.documentElement.style.overflow = 'hidden';
      if (document.body) document.body.style.overflow = 'hidden';
    } catch (e) {
      /* ignore */
    }
  }

  function restoreScroll() {
    try {
      if (document.documentElement) document.documentElement.style.overflow = savedOverflowDoc || '';
      if (document.body) document.body.style.overflow = savedOverflowBody || '';
    } catch (e) {
      /* ignore */
    }
  }

  function updateOverlayStats(match) {
    if (!overlayShadow) return;
    try {
      var appEl = overlayShadow.querySelector('#burn-app');
      var pointsEl = overlayShadow.querySelector('#burn-points');
      var streakEl = overlayShadow.querySelector('#burn-streak');
      if (appEl) appEl.textContent = match.appName;
      if (pointsEl) pointsEl.textContent = Nudges.overlayPointsLabel(match.displayAtRisk);
      if (streakEl) streakEl.textContent = Nudges.streakLabel(match.streak);
    } catch (e) {
      /* ignore */
    }
  }

  function loadNudge() {
    if (!overlayShadow || !currentMatch) return;
    var el = overlayShadow.querySelector('#burn-nudge');
    if (!el) return;
    el.textContent = 'Tubby is thinking…';
    var ctx = {
      appName: currentMatch.appName,
      pointsAtRisk: currentMatch.displayAtRisk,
      streak: currentMatch.streak
    };
    var timeout = C.NUDGE_CONTENT_TIMEOUT_MS || 4200;
    sendMessageWithTimeout({ type: 'burn:get-nudge', appName: currentMatch.appName }, timeout).then(
      function (resp) {
        if (!overlayShadow) return;
        var node = overlayShadow.querySelector('#burn-nudge');
        if (!node) return;
        if (resp && typeof resp.nudge === 'string' && resp.nudge.trim()) {
          node.textContent = resp.nudge.trim().slice(0, 500);
        } else {
          node.textContent = Nudges.pickFallbackNudge(ctx);
        }
      },
      function () {
        if (!overlayShadow) return;
        var node = overlayShadow.querySelector('#burn-nudge');
        if (!node) return;
        try {
          node.textContent = Nudges.pickFallbackNudge(ctx);
        } catch (e) {
          node.textContent = 'Put your distractions down. Earn real life.';
        }
      }
    );
  }

  function setButtonsDisabled(disabled) {
    if (!overlayShadow) return;
    var put = overlayShadow.querySelector('#burn-put-down');
    var cont = overlayShadow.querySelector('#burn-continue');
    if (put) put.disabled = disabled;
    if (cont) cont.disabled = disabled;
  }

  function localEarnFallback() {
    return Store.getLocal().then(function (local) {
      var ledger = local.ledger || { balance: null, streak: 0, bestStreak: 0, recent: [] };
      var earn = typeof C.LOCAL_EARN_FALLBACK === 'number' ? C.LOCAL_EARN_FALLBACK : 0;
      var prev =
        typeof ledger.balance === 'number' && isFinite(ledger.balance) ? ledger.balance : 0;
      ledger.balance = prev + earn;
      ledger.streak = (ledger.streak || 0) + 1;
      ledger.bestStreak = Math.max(ledger.bestStreak || 0, ledger.streak);
      ledger.recent = [
        { delta: earn, kind: 'earn', reason: 'resisted_temptation (pending sync)', at: Date.now() }
      ]
        .concat(ledger.recent || [])
        .slice(0, C.MAX_RECENT || 20);
      var queue = Array.isArray(local.queue) ? local.queue : [];
      queue.push({
        type: 'earn',
        payload: { event: 'resisted_temptation', appName: currentMatch.appName },
        appName: currentMatch.appName,
        attempts: 0,
        queuedAt: Date.now()
      });
      return Store.saveLocal({ ledger: ledger, queue: queue });
    });
  }

  function localBurnFallback(amount) {
    return Store.getLocal().then(function (local) {
      var ledger = local.ledger || { balance: null, streak: 0, bestStreak: 0, recent: [] };
      var amt = Math.max(1, Math.floor(amount));
      if (typeof ledger.balance === 'number' && isFinite(ledger.balance)) {
        ledger.balance = Math.max(0, ledger.balance - amt);
      }
      ledger.recent = [
        { delta: -Math.abs(amt), kind: 'burn', reason: 'Opened a limited site (pending sync)', at: Date.now() }
      ]
        .concat(ledger.recent || [])
        .slice(0, C.MAX_RECENT || 20);
      var queue = Array.isArray(local.queue) ? local.queue : [];
      queue.push({
        type: 'burn',
        payload: { reason: 'Opened a limited site', amount: amt, appName: currentMatch.appName, breaksStreak: false },
        appName: currentMatch.appName,
        amount: amt,
        attempts: 0,
        queuedAt: Date.now()
      });
      return Store.saveLocal({ ledger: ledger, queue: queue });
    });
  }

  function onPutDown() {
    if (!overlayShadow || !currentMatch) return;
    var put = overlayShadow.querySelector('#burn-put-down');
    var statusEl = overlayShadow.querySelector('#burn-status');
    setButtonsDisabled(true);
    if (put) put.textContent = 'Closing…';
    sendMessageWithTimeout({ type: 'burn:earn', appName: currentMatch.appName }, 10000).then(
      function (resp) {
        var earned =
          resp && typeof resp.earned === 'number' && isFinite(resp.earned)
            ? Math.floor(resp.earned)
            : null;
        if (earned != null && statusEl) {
          statusEl.textContent = earned > 0 ? '+' + earned : 'Points safe';
          if (put) put.textContent = 'Nice! Closing…';
          setTimeout(closeTab, 900);
        } else {
          if (put) put.textContent = 'Done! Closing…';
          setTimeout(closeTab, 400);
        }
      },
      function () {
        localEarnFallback().catch(function () {});
        if (put) put.textContent = 'Saved! Closing…';
        setTimeout(closeTab, 400);
      }
    );
  }

  function closeTab() {
    sendMessageWithTimeout({ type: 'burn:close-tab' }, 3000).then(
      function () {},
      function () {
        if (!overlayShadow) return;
        var statusEl = overlayShadow.querySelector('#burn-status');
        var put = overlayShadow.querySelector('#burn-put-down');
        if (statusEl) statusEl.textContent = 'Please close this tab yourself. Your points and streak are safe.';
        if (put) put.textContent = 'Put it down';
        setButtonsDisabled(false);
      }
    );
  }

  function onContinue() {
    if (!overlayShadow || !currentMatch) return;
    var cont = overlayShadow.querySelector('#burn-continue');
    setButtonsDisabled(true);
    if (cont) cont.textContent = 'One moment…';
    var match = currentMatch;
    sendMessageWithTimeout(
      { type: 'burn:burn', appName: match.appName, amount: match.pointsAtRisk },
      10000
    ).then(
      function () {
        setCooldownAndClose(match);
      },
      function () {
        localBurnFallback(match.pointsAtRisk).catch(function () {});
        setCooldownAndClose(match);
      }
    );
  }

  function setCooldownAndClose(match) {
    sendMessageWithTimeout({ type: 'burn:set-cooldown', entry: match.entry }, 3000).then(
      function () {
        removeOverlay();
        currentMatch = null;
      },
      function () {
        Store.setCooldown(match.entry, C.COOLDOWN_MS)
          .catch(function () {})
          .then(function () {
            removeOverlay();
            currentMatch = null;
          });
      }
    );
  }

  function injectOverlay(match) {
    if (overlayHost) {
      updateOverlayStats(match);
      return;
    }
    pauseMedia();
    blockScroll();
    startMediaObserver();
    var host = document.createElement('div');
    host.id = 'burn-focus-guard-host';
    host.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;margin:0;padding:0;');
    var shadow;
    try {
      shadow = host.attachShadow({ mode: 'open' });
    } catch (e) {
      return;
    }
    var html =
      '<div class="burn-overlay" role="dialog" aria-modal="true" aria-label="TubbyBuddy focus guard">' +
      '<div class="burn-card">' +
      '<div class="burn-ember">' +
      tubbyImg() +
      '</div>' +
      '<p class="burn-eyebrow">TubbyBuddy &bull; Focus Guard</p>' +
      '<h1 class="burn-title">Time check</h1>' +
      '<p class="burn-sub">You opened <strong id="burn-app">' +
      escapeHtml(match.appName) +
      '</strong></p>' +
      '<p class="burn-nudge" id="burn-nudge" aria-live="polite">Tubby is thinking&hellip;</p>' +
      '<p class="burn-stats"><span id="burn-points">' +
      escapeHtml(Nudges.overlayPointsLabel(match.displayAtRisk)) +
      '</span> &bull; <span id="burn-streak">' +
      escapeHtml(Nudges.streakLabel(match.streak)) +
      '</span></p>' +
      '<div class="burn-actions">' +
      '<button id="burn-put-down" type="button" class="burn-btn burn-primary">Put it down</button>' +
      '<button id="burn-continue" type="button" class="burn-btn burn-secondary">Continue anyway</button>' +
      '</div>' +
      '<p class="burn-status" id="burn-status" aria-live="polite"></p>' +
      '<p class="burn-tagline">Put your distractions down. Earn real life.</p>' +
      '</div></div>';
    try {
      shadow.innerHTML = '<style>' + OVERLAY_CSS + '</style>' + html;
    } catch (e) {
      stopMediaObserver();
      restoreScroll();
      return;
    }
    try {
      (document.body || document.documentElement).appendChild(host);
    } catch (e) {
      stopMediaObserver();
      restoreScroll();
      return;
    }
    overlayHost = host;
    overlayShadow = shadow;
    try {
      var put = shadow.querySelector('#burn-put-down');
      var cont = shadow.querySelector('#burn-continue');
      if (put) put.addEventListener('click', onPutDown);
      if (cont) cont.addEventListener('click', onContinue);
      if (put && typeof put.focus === 'function') put.focus();
    } catch (e) {
      /* ignore */
    }
    loadNudge();
  }

  function removeOverlay() {
    stopMediaObserver();
    if (overlayHost) {
      try {
        overlayHost.remove();
      } catch (e) {
        try {
          if (overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
        } catch (err) {
          /* ignore */
        }
      }
    }
    overlayHost = null;
    overlayShadow = null;
    restoreScroll();
  }

  function evaluateUrl(url) {
    if (checking) return;
    checking = true;
    getBlockState(url).then(
      function (state) {
        checking = false;
        if (!state || typeof state.blocked !== 'boolean') return;
        if (state.blocked) {
          currentMatch = {
            entry: state.matchedEntry,
            canonical: state.canonical,
            appName: state.appName || state.canonical || 'this site',
            pointsAtRisk: state.pointsAtRisk,
            displayAtRisk: state.displayAtRisk,
            streak: state.streak || 0
          };
          if (!overlayHost) injectOverlay(currentMatch);
          else updateOverlayStats(currentMatch);
        } else {
          if (overlayHost) removeOverlay();
          currentMatch = null;
        }
      },
      function () {
        checking = false;
      }
    );
  }

  function queueCheck() {
    if (checkTimer) return;
    checkTimer = setTimeout(function () {
      checkTimer = null;
      if (location.href !== lastUrl) lastUrl = location.href;
      evaluateUrl(location.href);
    }, 100);
  }

  function setupWatcher() {
    if (window.__burnWatcherSetup) return;
    window.__burnWatcherSetup = true;
    try {
      var origPush = history.pushState;
      var origReplace = history.replaceState;
      history.pushState = function () {
        var r = origPush.apply(this, arguments);
        queueCheck();
        return r;
      };
      history.replaceState = function () {
        var r = origReplace.apply(this, arguments);
        queueCheck();
        return r;
      };
      window.addEventListener('popstate', queueCheck);
      window.addEventListener('hashchange', queueCheck);
    } catch (e) {
      /* ignore */
    }
    try {
      setInterval(function () {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          evaluateUrl(location.href);
        }
      }, 1000);
    } catch (e) {
      /* ignore */
    }
    try {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'burn:url-changed') {
          lastUrl = location.href;
          evaluateUrl(location.href);
        }
      });
    } catch (e) {
      /* ignore */
    }
  }

  setupWatcher();
  evaluateUrl(location.href);
})();
