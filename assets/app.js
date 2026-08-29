(function () {
  'use strict';

  var STORAGE_KEY = 'sim-timetable-payload';
  var FEED_URL = 'https://raw.githubusercontent.com/Shisa2025/simtimetable/main/data/latest.json';
  var HASHES = { now: 'open-now', today: 'today', schedule: 'schedule' };
  var MODES = { 'open-now': 'now', today: 'today', schedule: 'schedule' };

  var app = document.getElementById('app');
  var loadingPanel = document.getElementById('loadingPanel');
  var waitingPanel = document.getElementById('waitingPanel');
  var importPanel = document.getElementById('importPanel');
  var staleBanner = document.getElementById('staleBanner');
  var staleText = document.getElementById('staleText');
  var fileInput = document.getElementById('file');
  var pasteArea = document.getElementById('pasteArea');
  var importError = document.getElementById('importError');
  var exportStatus = document.getElementById('exportStatus');
  var updatedValue = document.getElementById('updatedValue');
  var updatedDetail = document.getElementById('updatedDetail');
  var openValue = document.getElementById('openValue');
  var laterValue = document.getElementById('laterValue');
  var dateValue = document.getElementById('dateValue');
  var dateDetail = document.getElementById('dateDetail');
  var clockTime = document.getElementById('sgTime');
  var clockDate = document.getElementById('sgDate');

  var controller = null;
  var payload = null;
  var awaiting = false;

  function coerce(raw) {
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) parsed = { rows: parsed };
    if (!parsed || !Array.isArray(parsed.rows)) {
      throw new Error('Expected an object with a "rows" array, or an array of rows.');
    }
    if (!parsed.rows.length) throw new Error('That schedule contains no bookings.');
    return parsed;
  }

  function ageOf(iso) {
    var timestamp = Date.parse(iso);
    if (isNaN(timestamp)) return 'Update time unavailable';
    var minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Updated just now';
    if (minutes < 60) return 'Updated ' + minutes + ' min ago';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return 'Updated ' + hours + ' hr' + (hours === 1 ? '' : 's') + ' ago';
    var days = Math.round(hours / 24);
    return 'Updated ' + days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function scrapedTime(value) {
    var timestamp = Date.parse(value && value.scraped_at);
    return isNaN(timestamp) ? 0 : timestamp;
  }

  function modeFromLocation() {
    return MODES[location.hash.replace(/^#/, '')] || 'now';
  }

  function scheduleIsCurrent(value) {
    var today = SIMTimetable.singaporeClock(new Date()).date;
    return !!(value.schedule_dates && value.schedule_dates.indexOf(today) !== -1);
  }

  function formatScrapedAt(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return 'Time unavailable';
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date) + ' SGT';
  }

  function formatScheduleDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || 'Unknown date';
    var parts = value.split('-');
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'
    }).format(date);
  }

  function updateClock() {
    var now = new Date();
    clockTime.textContent = new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit'
    }).format(now);
    clockDate.textContent = new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore', weekday: 'long', day: 'numeric', month: 'long'
    }).format(now);
  }

  function setActiveNavigation(mode) {
    document.querySelectorAll('[data-view-link]').forEach(function (link) {
      var active = link.getAttribute('data-view-link') === mode;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function onSummary(summary) {
    if (summary.mode === 'now') {
      openValue.textContent = String(summary.openNow);
      laterValue.textContent = String(summary.laterToday);
    } else if (payload) {
      var now = SIMTimetable.singaporeClock(new Date()).minutes;
      var current = payload.rows.filter(function (row) {
        return /free access/i.test(row.event || '') && row.start_min <= now && now < row.end_min;
      }).length;
      var later = payload.rows.filter(function (row) {
        return /free access/i.test(row.event || '') && row.start_min > now;
      }).length;
      openValue.textContent = scheduleIsCurrent(payload) ? String(current) : '—';
      laterValue.textContent = scheduleIsCurrent(payload) ? String(later) : '—';
    }
  }

  function show(value, persist) {
    var currentState = controller ? controller.getState() : {};
    var requestedMode = controller ? controller.getMode() : modeFromLocation();
    payload = value;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (error) { /* quota/private mode */ }
    }

    var current = scheduleIsCurrent(value);
    staleBanner.hidden = current;
    if (!current) {
      staleText.textContent = value.schedule_dates && value.schedule_dates.length
        ? 'This snapshot is for ' + value.schedule_dates.join(', ') + ', not today in Singapore.'
        : 'This snapshot does not identify today’s Singapore schedule.';
    }

    dateValue.textContent = value.schedule_dates && value.schedule_dates.length
      ? value.schedule_dates.map(formatScheduleDate).join(', ')
      : 'Unknown date';
    dateDetail.textContent = current ? 'Singapore schedule' : 'Previous snapshot';
    updatedValue.textContent = value.scraped_at ? ageOf(value.scraped_at).replace(/^Updated /, '') : 'Unknown';
    updatedDetail.textContent = value.scraped_at ? formatScrapedAt(value.scraped_at) : 'No timestamp';

    controller = SIMTimetable.mount(document.getElementById('timetable'), value.rows, {
      mode: requestedMode,
      initial: currentState,
      rooms: value.rooms || [],
      scheduleCurrent: current,
      onSummary: onSummary,
      onModeChange: function (mode) {
        setActiveNavigation(mode);
        history.replaceState(null, '', '/#' + HASHES[mode]);
      }
    });
    setActiveNavigation(requestedMode);

    awaiting = false;
    loadingPanel.hidden = true;
    waitingPanel.hidden = true;
    importPanel.hidden = true;
    app.hidden = false;
    importError.textContent = '';
  }

  function load(raw) {
    try {
      show(coerce(raw), true);
      history.replaceState(null, '', '/#' + HASHES[controller.getMode()]);
    } catch (error) {
      importError.textContent = 'Could not read that schedule: ' + error.message;
    }
  }

  document.querySelectorAll('[data-view-link]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      if (!controller) return;
      event.preventDefault();
      controller.setMode(link.getAttribute('data-view-link'));
      document.getElementById('timetable').scrollIntoView({ block: 'start' });
    });
  });

  window.addEventListener('hashchange', function () {
    if (controller) controller.setMode(modeFromLocation());
  });

  document.getElementById('pickBtn').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (file) file.text().then(load);
  });
  document.getElementById('loadPasteBtn').addEventListener('click', function () {
    var text = pasteArea.value.trim();
    if (!text) { importError.textContent = 'Paste schedule JSON first.'; return; }
    load(text);
  });
  document.getElementById('showImportBtn').addEventListener('click', function () {
    app.hidden = true;
    importPanel.hidden = false;
    importPanel.scrollIntoView({ block: 'start' });
  });
  document.getElementById('cancelImportBtn').addEventListener('click', function () {
    importPanel.hidden = true;
    app.hidden = !payload;
  });

  var drop = document.getElementById('drop');
  ['dragenter', 'dragover'].forEach(function (eventName) {
    drop.addEventListener(eventName, function (event) {
      event.preventDefault();
      drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (eventName) {
    drop.addEventListener(eventName, function (event) {
      event.preventDefault();
      drop.classList.remove('over');
    });
  });
  drop.addEventListener('drop', function (event) {
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) file.text().then(load);
    else if (event.dataTransfer) load(event.dataTransfer.getData('text'));
  });

  document.getElementById('exportBtn').addEventListener('click', function () {
    if (!payload || !controller) return;
    exportStatus.textContent = 'Building offline copy…';
    Promise.all([
      fetch('/assets/styles.css').then(function (response) { return response.text(); }),
      fetch('/assets/timetable.js').then(function (response) { return response.text(); })
    ]).then(function (parts) {
      var rows = JSON.stringify(payload.rows).replace(/</g, '\\u003c');
      var exportOptions = JSON.stringify({
        mode: controller.getMode(),
        initial: controller.getState(),
        rooms: payload.rooms || [],
        scheduleDates: payload.schedule_dates || []
      }).replace(/</g, '\\u003c');
      var html = '<!DOCTYPE html>\n<html lang="en-SG">\n<head>\n' +
        '<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
        '<title>SIM Campus Timetable — Offline copy</title>\n<style>\n' + parts[0] + '\n</style>\n</head>\n<body>\n' +
        '<main class="page-shell"><section class="content-hero"><p class="eyebrow">Offline copy</p>' +
        '<h1>SIM Campus Timetable</h1><p>Saved from the student room finder. Times use Singapore time.</p></section>' +
        '<div id="timetable"></div></main>\n<script>\n' + parts[1] + '\n<\/script>\n<script>\n' +
        'var rows=' + rows + ';var options=' + exportOptions + ';' +
        'options.scheduleCurrent=options.scheduleDates.indexOf(SIMTimetable.singaporeClock(new Date()).date)!==-1;' +
        'SIMTimetable.mount(document.getElementById("timetable"),rows,options);\n<\/script>\n</body>\n</html>\n';
      var blob = new Blob([html], { type: 'text/html' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'sim-campus-timetable.html';
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 5000);
      exportStatus.textContent = 'Offline copy downloaded.';
    }).catch(function (error) {
      exportStatus.textContent = 'Export failed: ' + error.message;
    });
  });

  function startAwaiting() {
    awaiting = true;
    loadingPanel.hidden = true;
    waitingPanel.hidden = false;
    importPanel.hidden = true;
    app.hidden = true;
  }

  document.getElementById('waitingCancel').addEventListener('click', function () {
    awaiting = false;
    waitingPanel.hidden = true;
    importPanel.hidden = false;
  });

  window.addEventListener('message', function (event) {
    if (!awaiting || !window.opener || event.source !== window.opener || !event.data) return;
    if (event.data.type === 'sim-timetable:progress') {
      document.getElementById('waitStep').textContent = String(event.data.step || 'Reading the schedule').slice(0, 120);
      document.getElementById('waitDetail').textContent = String(event.data.detail || 'Keep this tab open.').slice(0, 240);
      return;
    }
    if (event.data.type !== 'sim-timetable:payload') return;
    try {
      var received = coerce(event.data.payload);
      show(received, true);
      Toast.show({
        id: 'scrape', title: 'Fresh schedule received',
        detail: received.rows.length + ' bookings across ' + (received.rooms ? received.rooms.length : '?') + ' rooms',
        tone: 'success', ttl: 5000
      });
      try { event.source.postMessage({ type: 'sim-timetable:received' }, event.origin); } catch (error) { /* best effort */ }
      history.replaceState(null, '', '/#open-now');
    } catch (error) {
      awaiting = false;
      waitingPanel.hidden = true;
      importPanel.hidden = false;
      importError.textContent = 'The scraper sent an unreadable schedule: ' + error.message;
    }
  });

  function fetchLatest() {
    Toast.show({ id: 'feed', title: 'Checking today’s schedule', detail: 'Looking for the latest SIM snapshot' });
    return fetch(FEED_URL, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (text) {
        var remote = coerce(JSON.parse(text));
        var fresher = !payload || scrapedTime(remote) > scrapedTime(payload);
        if (fresher) show(remote, true);
        Toast.show({
          id: 'feed',
          title: fresher ? 'Schedule ready' : 'Schedule is up to date',
          detail: remote.rows.length + ' bookings loaded', tone: 'success', ttl: 4200
        });
      })
      .catch(function (error) {
        loadingPanel.hidden = true;
        if (!payload) importPanel.hidden = false;
        Toast.show({
          id: 'feed',
          title: payload ? 'Could not check for a newer schedule' : 'Today’s schedule is unavailable',
          detail: payload ? 'Showing the last saved snapshot.' : String(error.message || error),
          tone: 'error', ttl: 7000
        });
      });
  }

  updateClock();
  setInterval(updateClock, 30000);

  var params = new URLSearchParams(location.search);
  if (params.get('awaiting') === '1' && window.opener) {
    startAwaiting();
  } else if (params.get('import') === '1') {
    loadingPanel.hidden = true;
    importPanel.hidden = false;
  } else {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) show(coerce(saved), false);
    } catch (error) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (storageError) { /* ignore */ }
    }
    fetchLatest();
  }
})();
