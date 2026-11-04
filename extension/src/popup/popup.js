/* Burn popup. Classic script; shared constants/storage load before it.
 * All network goes through the service worker via messages; on failure the
 * local ledger is shown and the backend reads Offline. */
(function () {
  'use strict';

  function sendMessageWithTimeout(msg, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error('timeout'));
        }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || 'failed'));
          else resolve(resp);
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

  function formatWhen(at) {
    try {
      if (typeof at !== 'number' || !isFinite(at)) return '';
      var d = new Date(at);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString();
    } catch (e) {
      return '';
    }
  }

  function render(data) {
    var ledger = (data && data.ledger) || {};
    var online = !!(data && data.online);
    var queueLen = data && Number.isFinite(data.queueLen) ? data.queueLen : 0;

    var balanceEl = document.querySelector('#balance');
    var streakEl = document.querySelector('#streak');
    var bestEl = document.querySelector('#best');
    if (balanceEl) {
      balanceEl.textContent =
        typeof ledger.balance === 'number' && isFinite(ledger.balance)
          ? String(Math.floor(ledger.balance))
          : '—';
    }
    if (streakEl) streakEl.textContent = String(ledger.streak || 0);
    if (bestEl) bestEl.textContent = String(ledger.bestStreak || 0);

    var dot = document.querySelector('#backend-dot');
    var text = document.querySelector('#backend-text');
    if (dot) dot.className = 'dot ' + (online ? 'dot-on' : 'dot-off');
    if (text) text.textContent = online ? 'Online' : 'Offline';

    var pending = document.querySelector('#pending');
    if (pending) {
      if (queueLen > 0) {
        pending.hidden = false;
        pending.textContent = 'pending sync: ' + queueLen;
      } else {
        pending.hidden = true;
        pending.textContent = '';
      }
    }

    var list = document.querySelector('#recent');
    var empty = document.querySelector('#recent-empty');
    if (list) {
      list.textContent = '';
      var recent = Array.isArray(ledger.recent) ? ledger.recent.slice(0, 5) : [];
      if (!recent.length) {
        if (empty) empty.hidden = false;
      } else {
        if (empty) empty.hidden = true;
        recent.forEach(function (r) {
          var li = document.createElement('li');
          var delta = document.createElement('span');
          var d = r && typeof r.delta === 'number' ? Math.floor(r.delta) : 0;
          delta.textContent = (d >= 0 ? '+' : '') + d;
          delta.className = d >= 0 ? 'delta-plus' : 'delta-minus';
          var reason = document.createElement('span');
          reason.className = 'reason';
          reason.textContent = r && typeof r.reason === 'string' && r.reason ? r.reason : (r && r.kind ? r.kind : '');
          var when = document.createElement('span');
          when.className = 'when';
          when.textContent = formatWhen(r && r.at);
          li.appendChild(delta);
          li.appendChild(reason);
          li.appendChild(when);
          list.appendChild(li);
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var openBtn = document.querySelector('#open-options');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        try {
          if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
          else chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
        } catch (e) {
          try {
            chrome.tabs.create({ url: 'src/options/options.html' });
          } catch (err) {
            /* ignore */
          }
        }
      });
    }

    sendMessageWithTimeout({ type: 'burn:get-popup-data' }, 12000).then(
      function (resp) {
        if (resp && resp.ok !== false && resp.ledger) {
          render(resp);
          return;
        }
        return fallbackLocal();
      },
      function () {
        return fallbackLocal();
      }
    );

    function fallbackLocal() {
      try {
        globalThis.BurnStorage.getLocal().then(
          function (local) {
            render({ ledger: local.ledger, queueLen: (local.queue || []).length, online: false });
          },
          function () {
            render({ ledger: { balance: null, streak: 0, bestStreak: 0, recent: [] }, queueLen: 0, online: false });
          }
        );
      } catch (e) {
        render({ ledger: { balance: null, streak: 0, bestStreak: 0, recent: [] }, queueLen: 0, online: false });
      }
    }
  });
})();
