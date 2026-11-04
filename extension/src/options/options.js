/* Burn options page. Classic script; shared constants/match/storage load
 * before it. Validates every field and saves settings to
 * chrome.storage.sync. Network (Test connection) goes through the service
 * worker, never fetch() here. */
(function () {
  'use strict';

  var blockedSites = [];

  function el(id) {
    return document.querySelector('#' + id);
  }

  function showError(id, message) {
    var node = el(id);
    if (!node) return;
    if (!message) {
      node.hidden = true;
      node.textContent = '';
    } else {
      node.hidden = false;
      node.textContent = message;
    }
  }

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

  function canonicalForComparison(entry) {
    try {
      var p = globalThis.BurnMatch.parseEntry(entry);
      if (!p) return null;
      var host = p.host;
      if (host.slice(0, 4) === 'www.') host = host.slice(4);
      return host + p.path;
    } catch (e) {
      return null;
    }
  }

  function renderSites() {
    var list = el('sites-list');
    if (!list) return;
    list.textContent = '';
    if (!blockedSites.length) {
      var empty = document.createElement('li');
      var code = document.createElement('code');
      code.textContent = '(nothing blocked)';
      empty.appendChild(code);
      list.appendChild(empty);
      return;
    }
    blockedSites.forEach(function (site, idx) {
      var li = document.createElement('li');
      var c = document.createElement('code');
      c.textContent = site;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-small';
      btn.textContent = 'Remove';
      btn.setAttribute('aria-label', 'Remove ' + site);
      btn.addEventListener('click', function () {
        blockedSites.splice(idx, 1);
        showError('sites-error', '');
        renderSites();
      });
      li.appendChild(c);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function updateGoalsCount() {
    var ta = el('goals');
    var count = el('goals-count');
    if (!ta || !count) return;
    var lines = ta.value
      .split('\n')
      .map(function (l) {
        return l.trim();
      })
      .filter(function (l) {
        return !!l;
      });
    count.textContent = lines.length + ' / 6';
  }

  function validateGoals() {
    var C = globalThis.BurnConstants;
    var ta = el('goals');
    var raw = ta ? ta.value : '';
    var lines = raw
      .split('\n')
      .map(function (l) {
        return l.trim();
      })
      .filter(function (l) {
        return !!l;
      });
    if (lines.length > (C.MAX_GOALS || 6)) {
      return { error: 'Keep at most ' + (C.MAX_GOALS || 6) + ' goals.', value: null };
    }
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length < 2) return { error: 'Goal ' + (i + 1) + ' is too short (min 2 chars).', value: null };
      if (lines[i].length > 200) return { error: 'Goal ' + (i + 1) + ' is too long (max 200 chars).', value: null };
    }
    return { error: '', value: lines };
  }

  function validateBackendUrl() {
    var C = globalThis.BurnConstants;
    var input = el('backend-url');
    var v = input ? input.value.trim() : '';
    if (!v) return { error: '', value: C.DEFAULT_BACKEND_URL };
    if (!C.isValidBackendUrl(v)) return { error: 'Enter a valid http(s) URL.', value: null };
    return { error: '', value: v.replace(/\/+$/, '') };
  }

  function validateDeviceId() {
    var C = globalThis.BurnConstants;
    var input = el('device-id');
    var v = input ? input.value.trim() : '';
    if (!C.isValidDeviceId(v)) {
      return { error: 'Device id must be 4–128 chars: letters, digits, . _ : -', value: null };
    }
    return { error: '', value: v };
  }

  function validatePoints() {
    var C = globalThis.BurnConstants;
    var input = el('points');
    var raw = input ? input.value : '';
    var n = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(n) || Math.floor(n) !== n) return { error: 'Enter a whole number.', value: null };
    if (n < 1 || n > (C.MAX_POINTS || 10000)) {
      return { error: 'Enter 1–' + (C.MAX_POINTS || 10000) + '.', value: null };
    }
    return { error: '', value: n };
  }

  function validateTone() {
    var C = globalThis.BurnConstants;
    var sel = el('tone');
    var v = sel ? sel.value : '';
    if (!C.isValidTone(v)) return { error: 'Pick a tone.', value: null };
    return { error: '', value: v };
  }

  function load() {
    globalThis.BurnStorage.getSyncSettings().then(function (s) {
      if (el('backend-url')) el('backend-url').value = s.backendUrl || '';
      if (el('device-id')) el('device-id').value = s.deviceId || '';
      if (el('goals')) el('goals').value = (s.goals || []).join('\n');
      if (el('points')) el('points').value = String(s.pointsAtRisk);
      if (el('tone')) el('tone').value = s.tone;
      blockedSites = Array.isArray(s.blockedSites) ? s.blockedSites.slice() : [];
      renderSites();
      updateGoalsCount();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();

    var goalsTa = el('goals');
    if (goalsTa) goalsTa.addEventListener('input', updateGoalsCount);

    var addBtn = el('site-add');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var input = el('site-input');
        var raw = input ? input.value.trim() : '';
        if (!raw) {
          showError('sites-error', 'Type a site first, e.g. example.com');
          return;
        }
        var parsed = null;
        try {
          parsed = globalThis.BurnMatch.parseEntry(raw);
        } catch (e) {
          parsed = null;
        }
        if (!parsed) {
          showError('sites-error', 'That does not look like a host. Try example.com or example.com/path');
          return;
        }
        if (parsed.host.indexOf('.') === -1 && parsed.host !== 'localhost') {
          showError('sites-error', 'Hosts usually contain a dot, e.g. example.com');
          return;
        }
        var host = parsed.host;
        if (host.slice(0, 4) === 'www.') host = host.slice(4);
        var canonical = host + parsed.path;
        for (var i = 0; i < blockedSites.length; i++) {
          if (canonicalForComparison(blockedSites[i]) === canonical) {
            showError('sites-error', 'Already in the list.');
            return;
          }
        }
        blockedSites.push(canonical);
        if (input) input.value = '';
        showError('sites-error', '');
        renderSites();
      });
    }

    var resetBtn = el('sites-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        blockedSites = globalThis.BurnConstants.DEFAULT_BLOCKED_SITES.slice();
        showError('sites-error', '');
        renderSites();
      });
    }

    var regenBtn = el('regen-device');
    if (regenBtn) {
      regenBtn.addEventListener('click', function () {
        try {
          var id = globalThis.BurnStorage.generateDeviceId();
          if (el('device-id')) el('device-id').value = id;
          showError('device-id-error', '');
        } catch (e) {
          showError('device-id-error', 'Could not generate an id.');
        }
      });
    }

    var testBtn = el('test-connection');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        var status = el('test-status');
        var check = validateBackendUrl();
        showError('backend-url-error', check.error);
        if (check.error) return;
        if (status) {
          status.textContent = 'Checking…';
          status.className = 'test-status';
        }
        testBtn.disabled = true;
        sendMessageWithTimeout({ type: 'burn:test-health', backendUrl: check.value }, 8000).then(
          function (resp) {
            testBtn.disabled = false;
            if (!status) return;
            if (resp && resp.ok) {
              status.textContent = 'Online';
              status.className = 'test-status ok';
            } else {
              var msg = resp && resp.error ? resp.error : 'Offline';
              status.textContent = 'Offline: ' + msg;
              status.className = 'test-status bad';
            }
          },
          function () {
            testBtn.disabled = false;
            if (status) {
              status.textContent = 'Offline: unreachable.';
              status.className = 'test-status bad';
            }
          }
        );
      });
    }

    var form = el('options-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var saveStatus = el('save-status');
        var backend = validateBackendUrl();
        var device = validateDeviceId();
        var goals = validateGoals();
        var points = validatePoints();
        var tone = validateTone();
        showError('backend-url-error', backend.error);
        showError('device-id-error', device.error);
        showError('goals-error', goals.error);
        showError('points-error', points.error);
        showError('tone-error', tone.error);
        if (backend.error || device.error || goals.error || points.error || tone.error) {
          if (saveStatus) {
            saveStatus.textContent = 'Fix the errors above.';
            saveStatus.className = 'save-status bad';
          }
          return;
        }
        globalThis.BurnStorage.saveSyncSettings({
          backendUrl: backend.value,
          deviceId: device.value,
          goals: goals.value,
          blockedSites: blockedSites.slice(),
          pointsAtRisk: points.value,
          tone: tone.value
        }).then(function () {
          if (saveStatus) {
            saveStatus.textContent = 'Saved.';
            saveStatus.className = 'save-status ok';
            setTimeout(function () {
              saveStatus.textContent = '';
              saveStatus.className = 'save-status';
            }, 2500);
          }
        });
      });
    }
  });
})();
