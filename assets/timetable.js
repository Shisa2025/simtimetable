/* SIM Campus Timetable — dependency-free parsing and student-first rendering.
 *
 * Used by the live site and inlined into standalone exports. Keep this file
 * browser-native so an exported timetable works without a network connection.
 */
(function (global) {
  'use strict';

  var SINGAPORE_TZ = 'Asia/Singapore';

  // ---------- parsing ----------

  function toMinutes(t) {
    if (!t) return null;
    var m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function parseTimeRange(timeStr) {
    var clean = (timeStr || '').replace(/\u00a0/g, ' ').trim();
    var parts = clean.split(/\s*-\s*/);
    if (parts.length !== 2) {
      return { start: null, end: null, start_min: null, end_min: null };
    }
    var start = parts[0].trim();
    var end = parts[1].trim();
    return { start: start, end: end, start_min: toMinutes(start), end_min: toMinutes(end) };
  }

  function parseBlock(building, room) {
    var m = (building || '').match(/Block\s+([A-Za-z])/i);
    if (m) return m[1].toUpperCase();
    m = (room || '').match(/\.([A-Za-z])\./);
    return m ? m[1].toUpperCase() : null;
  }

  function parseFloor(room) {
    var m = (room || '').match(/\.(\d+)\./);
    if (m) return parseInt(m[1], 10);
    m = (room || '').match(/\.(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseCapacity(value) {
    var m = String(value || '').match(/(\d+)\s*pax/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function normalize(rows) {
    return (rows || []).map(function (row) {
      var r = row || {};
      var parsed = (typeof r.start_min !== 'undefined')
        ? { start: r.start, end: r.end, start_min: r.start_min, end_min: r.end_min }
        : parseTimeRange(r.time);
      var roomDescription = r.room_description || '';
      var description = r.description || '';
      return {
        start: parsed.start,
        end: parsed.end,
        start_min: parsed.start_min,
        end_min: parsed.end_min,
        block: typeof r.block !== 'undefined' ? r.block : parseBlock(r.building, r.room),
        floor: typeof r.floor !== 'undefined' ? r.floor : parseFloor(r.room),
        room: r.room || '',
        event: r.event || '',
        status: r.status || '',
        description: description,
        room_description: roomDescription,
        capacity: typeof r.capacity === 'number'
          ? r.capacity
          : (parseCapacity(roomDescription) || parseCapacity(description))
      };
    });
  }

  // ---------- time and data helpers ----------

  function singaporeClock(input) {
    var date = input instanceof Date ? input : new Date(input || Date.now());
    if (isNaN(date.getTime())) date = new Date();
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SINGAPORE_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    var values = {};
    parts.forEach(function (part) {
      if (part.type !== 'literal') values[part.type] = part.value;
    });
    var hour = parseInt(values.hour, 10) || 0;
    var minute = parseInt(values.minute, 10) || 0;
    return {
      date: values.year + '-' + values.month + '-' + values.day,
      minutes: hour * 60 + minute,
      hour: hour,
      minute: minute,
      value: date
    };
  }

  function getNow(opts) {
    var value = opts && typeof opts.now === 'function' ? opts.now() : opts && opts.now;
    return singaporeClock(value || new Date());
  }

  function esc(value) {
    return String(value === null || typeof value === 'undefined' ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uniqueSorted(values, compare) {
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      var key = String(value);
      if (!seen[key]) {
        seen[key] = true;
        out.push(value);
      }
    });
    return compare ? out.sort(compare) : out.sort();
  }

  function isFreeAccess(row) {
    return /free access/i.test((row.event || '').trim());
  }

  function formatDuration(minutes) {
    minutes = Math.max(0, Math.round(minutes));
    if (minutes < 60) return minutes + ' min';
    var hours = Math.floor(minutes / 60);
    var remainder = minutes % 60;
    return hours + ' hr' + (hours === 1 ? '' : 's') + (remainder ? ' ' + remainder + ' min' : '');
  }

  function liveStatus(row, nowMinutes, scheduleCurrent) {
    if (!scheduleCurrent) return 'SCHEDULED';
    if (row.start_min === null || row.end_min === null) return row.status || 'SCHEDULED';
    if (row.end_min <= nowMinutes) return 'PAST';
    if (row.start_min <= nowMinutes) return 'CURRENT';
    return 'UPCOMING';
  }

  /* A gap means unallocated, never confirmed open. */
  function buildTimeline(bookings) {
    bookings = bookings.slice().sort(function (a, b) { return a.start_min - b.start_min; });
    var timeline = [];
    bookings.forEach(function (booking, index) {
      timeline.push({
        type: isFreeAccess(booking) ? 'open' : 'busy',
        start_min: booking.start_min,
        end_min: booking.end_min,
        start: booking.start,
        end: booking.end,
        event: booking.event,
        open_ended: false
      });
      var next = bookings[index + 1];
      if (next && next.start_min > booking.end_min) {
        timeline.push({
          type: 'gap', start_min: booking.end_min, end_min: next.start_min,
          start: booking.end, end: next.start, event: '', open_ended: false
        });
      } else if (!next) {
        timeline.push({
          type: 'gap', start_min: booking.end_min, end_min: null,
          start: booking.end, end: null, event: '', open_ended: true
        });
      }
    });
    return timeline;
  }

  function roomSort(a, b) {
    var block = String(a.info.block || '').localeCompare(String(b.info.block || ''));
    if (block) return block;
    var floorA = a.info.floor === null || typeof a.info.floor === 'undefined' ? 999 : Number(a.info.floor);
    var floorB = b.info.floor === null || typeof b.info.floor === 'undefined' ? 999 : Number(b.info.floor);
    return floorA - floorB || String(a.room).localeCompare(String(b.room));
  }

  function roomMeta(info) {
    var location = [];
    if (info.block) location.push('Block ' + esc(info.block));
    if (info.floor !== null && typeof info.floor !== 'undefined') location.push('Level ' + esc(info.floor));
    var capacity = info.capacity ? esc(info.capacity) + ' seats' : 'Capacity unavailable';
    return '<span>' + (location.join(' · ') || 'Location unavailable') + '</span>' +
      '<span>' + capacity + '</span>';
  }

  // ---------- UI ----------

  var UI_HTML = [
    '<section class="finder-panel" aria-labelledby="finderHeading">',
    '  <div class="view-tabs" role="tablist" aria-label="Timetable views">',
    '    <button type="button" role="tab" data-mode="now">Open now</button>',
    '    <button type="button" role="tab" data-mode="today">Today\'s availability</button>',
    '    <button type="button" role="tab" data-mode="schedule">Full schedule</button>',
    '  </div>',
    '  <div class="filter-heading">',
    '    <div><p class="eyebrow">Narrow your search</p><h2 id="finderHeading">Find the right room</h2></div>',
    '    <button class="text-button" data-el="resetBtn" type="button">Reset filters</button>',
    '  </div>',
    '  <div class="filter-grid">',
    '    <label><span>Block</span><select data-f="block"><option value="">All blocks</option></select></label>',
    '    <label><span>Floor</span><select data-f="floor"><option value="">All floors</option></select></label>',
    '    <label class="filter-wide"><span>Room</span><input data-f="room" type="search" placeholder="e.g. LT.B.5" autocomplete="off" /></label>',
    '    <label data-filter-context="availability"><span>Group size</span><select data-f="group"><option value="">Any size</option><option value="10">10+ seats</option><option value="20">20+ seats</option><option value="40">40+ seats</option><option value="60">60+ seats</option><option value="100">100+ seats</option></select></label>',
    '    <label data-filter-context="availability"><span>Need room for</span><select data-f="duration"><option value="0">Any duration</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label>',
    '  </div>',
    '  <details class="more-filters">',
    '    <summary>More filters</summary>',
    '    <label><span>Exclude room names</span><input data-f="exclude" type="text" placeholder="e.g. LAB, MPSH" /></label>',
    '  </details>',
    '</section>',
    '<p class="result-meta" data-el="meta" role="status" aria-live="polite"></p>',
    '<div data-el="results" aria-live="polite"></div>'
  ].join('\n');

  function mount(root, rows, opts) {
    opts = opts || {};
    var data = normalize(rows);
    var inventory = opts.rooms || [];
    var scheduleCurrent = opts.scheduleCurrent !== false;
    root.innerHTML = UI_HTML;

    var filters = {};
    root.querySelectorAll('[data-f]').forEach(function (node) {
      filters[node.getAttribute('data-f')] = node;
    });
    var elements = {};
    root.querySelectorAll('[data-el]').forEach(function (node) {
      elements[node.getAttribute('data-el')] = node;
    });
    var modeButtons = root.querySelectorAll('[data-mode]');
    var placeSource = data.concat(inventory);

    uniqueSorted(placeSource.map(function (item) { return item.block; }).filter(Boolean))
      .forEach(function (block) { filters.block.add(new Option('Block ' + block, block)); });
    uniqueSorted(
      placeSource.map(function (item) { return item.floor; })
        .filter(function (floor) { return floor !== null && typeof floor !== 'undefined'; }),
      function (a, b) { return Number(a) - Number(b); }
    ).forEach(function (floor) { filters.floor.add(new Option('Level ' + floor, String(floor))); });

    var initial = opts.initial || {};
    Object.keys(filters).forEach(function (key) {
      if (initial[key] !== null && typeof initial[key] !== 'undefined') filters[key].value = String(initial[key]);
    });

    var groups = {};
    data.forEach(function (row) {
      if (!row.room || row.start_min === null || row.end_min === null) return;
      (groups[row.room] = groups[row.room] || []).push(row);
    });

    function infoFor(bookings) {
      var base = bookings[0] || {};
      var capacity = null;
      bookings.some(function (booking) {
        if (booking.capacity) { capacity = booking.capacity; return true; }
        return false;
      });
      return {
        block: base.block,
        floor: base.floor,
        capacity: capacity,
        room_description: base.room_description || ''
      };
    }

    function matchesPlace(room, info, ignoreGroupSize) {
      var wantedRoom = filters.room.value.trim().toUpperCase();
      var groupSize = parseInt(filters.group.value, 10) || 0;
      var excluded = filters.exclude.value.trim().toUpperCase()
        .split(',').map(function (value) { return value.trim(); }).filter(Boolean);
      if (filters.block.value && String(info.block) !== filters.block.value) return false;
      if (filters.floor.value && String(info.floor) !== filters.floor.value) return false;
      if (wantedRoom && room.toUpperCase().indexOf(wantedRoom) === -1) return false;
      if (excluded.some(function (value) { return room.toUpperCase().indexOf(value) !== -1; })) return false;
      if (!ignoreGroupSize && groupSize && (!info.capacity || info.capacity < groupSize)) return false;
      return true;
    }

    function availabilityCard(item, state) {
      var current = state === 'open';
      var title = current ? 'Open now' : 'Opens at ' + esc(item.window.start);
      var value = current ? 'Until ' + esc(item.window.end) : esc(item.window.start) + '–' + esc(item.window.end);
      var detail = current
        ? formatDuration(item.window.end_min - item.nowMinutes) + ' remaining'
        : 'Available for ' + formatDuration(item.window.end_min - item.window.start_min);
      return '<article class="availability-card ' + (current ? 'is-open' : 'is-later') + '">' +
        '<div class="card-topline"><span class="status-pill ' + (current ? 'status-open' : 'status-later') + '">' +
        '<span aria-hidden="true">' + (current ? '●' : '◷') + '</span> ' + title + '</span></div>' +
        '<h3>' + esc(item.room) + '</h3>' +
        '<div class="room-meta">' + roomMeta(item.info) + '</div>' +
        '<p class="availability-value">' + value + '</p>' +
        '<p class="availability-detail">' + detail + '</p>' +
        '</article>';
    }

    function renderNow() {
      var now = getNow(opts);
      var duration = parseInt(filters.duration.value, 10) || 0;
      var open = [];
      var later = [];

      if (scheduleCurrent) {
        Object.keys(groups).forEach(function (room) {
          var bookings = groups[room];
          var info = infoFor(bookings);
          if (!matchesPlace(room, info)) return;
          var windows = bookings.filter(isFreeAccess).sort(function (a, b) { return a.start_min - b.start_min; });
          var current = windows.filter(function (window) {
            return window.start_min <= now.minutes && now.minutes < window.end_min &&
              window.end_min - now.minutes >= duration;
          })[0];
          if (current) {
            open.push({ room: room, info: info, window: current, nowMinutes: now.minutes });
            return;
          }
          var next = windows.filter(function (window) {
            return window.start_min > now.minutes && window.end_min - window.start_min >= duration;
          })[0];
          if (next) later.push({ room: room, info: info, window: next, nowMinutes: now.minutes });
        });
      }

      open.sort(function (a, b) { return b.window.end_min - a.window.end_min || roomSort(a, b); });
      later.sort(function (a, b) { return a.window.start_min - b.window.start_min || roomSort(a, b); });

      var html = '';
      if (!scheduleCurrent) {
        html += '<section class="empty-state"><span class="empty-icon" aria-hidden="true">!</span>' +
          '<h2>Live availability is paused</h2><p>This schedule is not for today in Singapore. ' +
          'Use Today\'s availability as a reference, or refresh the data.</p></section>';
      } else {
        html += '<section class="result-section" aria-labelledby="openNowHeading">' +
          '<div class="section-heading"><div><p class="eyebrow">Confirmed Free Access</p>' +
          '<h2 id="openNowHeading">Open now <span>' + open.length + '</span></h2></div></div>';
        if (open.length) {
          html += '<div class="availability-grid">' + open.map(function (item) { return availabilityCard(item, 'open'); }).join('') + '</div>';
        } else {
          html += '<div class="inline-empty"><strong>No matching rooms are open right now.</strong>' +
            '<span>Try another block, a smaller group size, or check what opens later.</span></div>';
        }
        html += '</section>';

        html += '<section class="result-section result-section-later" aria-labelledby="laterHeading">' +
          '<div class="section-heading"><div><p class="eyebrow">Plan ahead</p>' +
          '<h2 id="laterHeading">Opening later today <span>' + later.length + '</span></h2></div></div>';
        if (later.length) {
          html += '<div class="availability-grid">' + later.map(function (item) { return availabilityCard(item, 'later'); }).join('') + '</div>';
        } else {
          html += '<div class="inline-empty"><strong>No more matching Free Access windows today.</strong>' +
            '<span>The next daily schedule is normally published shortly after midnight.</span></div>';
        }
        html += '</section>';
      }

      elements.meta.textContent = open.length + ' open now · ' + later.length + ' opening later';
      elements.results.innerHTML = html;
      return { mode: 'now', openNow: open.length, laterToday: later.length, visibleCount: open.length + later.length };
    }

    function timelineSegment(segment) {
      if (segment.type === 'open') {
        return '<div class="timeline-row"><span class="status-pill status-open">OPEN</span>' +
          '<span class="timeline-time">' + esc(segment.start) + '–' + esc(segment.end) + '</span>' +
          '<span class="timeline-label">Free Access</span></div>';
      }
      if (segment.type === 'busy') {
        return '<div class="timeline-row"><span class="status-pill status-busy">BUSY</span>' +
          '<span class="timeline-time">' + esc(segment.start) + '–' + esc(segment.end) + '</span>' +
          '<span class="timeline-label">' + esc(segment.event) + '</span></div>';
      }
      return '<div class="timeline-row"><span class="status-pill status-unknown">UNKNOWN</span>' +
        '<span class="timeline-time">' + esc(segment.start) + '–' + (segment.open_ended ? 'end of day' : esc(segment.end)) + '</span>' +
        '<span class="timeline-label muted">Unallocated · may still be locked</span></div>';
    }

    function renderToday() {
      var duration = parseInt(filters.duration.value, 10) || 0;
      var rooms = [];
      Object.keys(groups).forEach(function (room) {
        var bookings = groups[room];
        var info = infoFor(bookings);
        if (!matchesPlace(room, info)) return;
        var windows = bookings.filter(function (row) {
          return isFreeAccess(row) && row.end_min - row.start_min >= duration;
        });
        if (!windows.length) return;
        rooms.push({ room: room, info: info, bookings: bookings, windows: windows });
      });
      rooms.sort(roomSort);

      var unbooked = inventory.filter(function (room) {
        if (room.activities !== 0) return false;
        return matchesPlace(room.room || '', {
          block: room.block, floor: room.floor, capacity: parseCapacity(room.description)
        });
      }).length;

      var html = '<section class="result-section" aria-labelledby="todayHeading">' +
        '<div class="section-heading"><div><p class="eyebrow">Confirmed windows only</p>' +
        '<h2 id="todayHeading">Today\'s Free Access rooms <span>' + rooms.length + '</span></h2></div></div>';
      if (rooms.length) {
        html += '<div class="timeline-list">' + rooms.map(function (item) {
          var windows = item.windows.map(function (window) { return esc(window.start) + '–' + esc(window.end); }).join(', ');
          return '<details class="timeline-card"><summary><span><strong>' + esc(item.room) + '</strong>' +
            '<small>' + windows + '</small></span><span class="summary-meta">' + roomMeta(item.info) + '</span></summary>' +
            '<div class="timeline-body">' + buildTimeline(item.bookings).map(timelineSegment).join('') + '</div></details>';
        }).join('') + '</div>';
      } else {
        html += '<div class="inline-empty"><strong>No matching Free Access rooms found.</strong>' +
          '<span>Reset the filters or choose another location.</span></div>';
      }
      if (unbooked) {
        html += '<aside class="information-note"><strong>' + unbooked + ' additional rooms have no bookings.</strong> ' +
          'They are not listed as available because unallocated rooms may be locked.</aside>';
      }
      html += '</section>';
      elements.meta.textContent = rooms.length + ' rooms with confirmed Free Access today';
      elements.results.innerHTML = html;
      return { mode: 'today', openNow: null, laterToday: null, visibleCount: rooms.length };
    }

    function renderSchedule() {
      var now = getNow(opts);
      var rows = data.filter(function (row) {
        return matchesPlace(row.room || '', { block: row.block, floor: row.floor, capacity: row.capacity }, true);
      }).sort(function (a, b) {
        return (a.start_min || 0) - (b.start_min || 0) || String(a.room).localeCompare(String(b.room));
      });

      function statusLabel(row) {
        var status = liveStatus(row, now.minutes, scheduleCurrent);
        if (status === 'CURRENT') return 'In progress';
        if (status === 'UPCOMING') return 'Upcoming';
        if (status === 'PAST') return 'Ended';
        return 'Scheduled';
      }

      var tableRows = rows.map(function (row) {
        var status = liveStatus(row, now.minutes, scheduleCurrent);
        return '<tr><td>' + esc(row.start || '?') + '</td><td>' + esc(row.end || '?') + '</td>' +
          '<td>' + esc(row.block || '?') + '</td><td>' + esc(row.floor === null ? '?' : row.floor) + '</td>' +
          '<td><strong>' + esc(row.room || '?') + '</strong></td><td>' + esc(row.event) + '</td>' +
          '<td><span class="schedule-status status-' + status.toLowerCase() + '">' + statusLabel(row) + '</span></td></tr>';
      }).join('');
      var mobileRows = rows.map(function (row) {
        var status = liveStatus(row, now.minutes, scheduleCurrent);
        return '<article class="schedule-card"><div class="schedule-card-head"><strong>' + esc(row.room || '?') +
          '</strong><span class="schedule-status status-' + status.toLowerCase() + '">' + statusLabel(row) + '</span></div>' +
          '<p>' + esc(row.event) + '</p><div><span>' + esc(row.start || '?') + '–' + esc(row.end || '?') + '</span>' +
          '<span>Block ' + esc(row.block || '?') + ' · Level ' + esc(row.floor === null ? '?' : row.floor) + '</span></div></article>';
      }).join('');

      elements.meta.textContent = rows.length + ' scheduled events';
      elements.results.innerHTML = '<section class="result-section" aria-labelledby="scheduleHeading">' +
        '<div class="section-heading"><div><p class="eyebrow">All published bookings</p>' +
        '<h2 id="scheduleHeading">Full schedule <span>' + rows.length + '</span></h2></div></div>' +
        (rows.length ? '<div class="schedule-table-wrap"><table class="schedule-table"><caption class="sr-only">All published SIM campus schedule events matching the selected filters</caption><thead><tr>' +
          '<th>Start</th><th>End</th><th>Block</th><th>Floor</th><th>Room</th><th>Event</th><th>Status</th>' +
          '</tr></thead><tbody>' + tableRows + '</tbody></table></div><div class="schedule-cards">' + mobileRows + '</div>' :
          '<div class="inline-empty"><strong>No matching events found.</strong><span>Reset the filters to see the full schedule.</span></div>') +
        '</section>';
      return { mode: 'schedule', openNow: null, laterToday: null, visibleCount: rows.length };
    }

    var requestedMode = opts.mode;
    if (requestedMode === 'available') requestedMode = 'today';
    if (requestedMode === 'table') requestedMode = 'schedule';
    var mode = /^(now|today|schedule)$/.test(requestedMode) ? requestedMode : 'now';

    function updateModeControls() {
      modeButtons.forEach(function (button) {
        var active = button.getAttribute('data-mode') === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.setAttribute('tabindex', active ? '0' : '-1');
      });
      root.setAttribute('data-current-mode', mode);
    }

    function render() {
      updateModeControls();
      var summary = mode === 'now' ? renderNow() : (mode === 'today' ? renderToday() : renderSchedule());
      if (typeof opts.onSummary === 'function') opts.onSummary(summary);
      return summary;
    }

    function setMode(nextMode) {
      if (nextMode === 'available') nextMode = 'today';
      if (nextMode === 'table') nextMode = 'schedule';
      if (!/^(now|today|schedule)$/.test(nextMode)) return;
      mode = nextMode;
      render();
      if (typeof opts.onModeChange === 'function') opts.onModeChange(mode);
    }

    modeButtons.forEach(function (button) {
      button.addEventListener('click', function () { setMode(button.getAttribute('data-mode')); });
    });
    elements.resetBtn.addEventListener('click', function () {
      Object.keys(filters).forEach(function (key) { filters[key].value = key === 'duration' ? '0' : ''; });
      render();
    });
    root.querySelectorAll('input, select').forEach(function (input) {
      input.addEventListener('input', render);
      input.addEventListener('change', render);
    });

    render();

    return {
      render: render,
      setMode: setMode,
      getData: function () { return data; },
      getState: function () {
        var state = {};
        Object.keys(filters).forEach(function (key) { state[key] = filters[key].value; });
        return state;
      },
      getMode: function () { return mode; }
    };
  }

  global.SIMTimetable = {
    toMinutes: toMinutes,
    parseTimeRange: parseTimeRange,
    parseBlock: parseBlock,
    parseFloor: parseFloor,
    parseCapacity: parseCapacity,
    normalize: normalize,
    buildTimeline: buildTimeline,
    singaporeClock: singaporeClock,
    escapeHtml: esc,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : this);
