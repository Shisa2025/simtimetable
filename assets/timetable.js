/* SIM Timetable — dependency-free parsing and time-first room finding.
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
    if (parts.length !== 2) return { start: null, end: null, start_min: null, end_min: null };
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
      var parsed = typeof r.start_min !== 'undefined'
        ? { start: r.start, end: r.end, start_min: r.start_min, end_min: r.end_min }
        : parseTimeRange(r.time);
      var roomDescription = r.room_description || '';
      var description = r.description || '';
      return {
        start: parsed.start, end: parsed.end, start_min: parsed.start_min, end_min: parsed.end_min,
        block: typeof r.block !== 'undefined' ? r.block : parseBlock(r.building, r.room),
        floor: typeof r.floor !== 'undefined' ? r.floor : parseFloor(r.room),
        room: r.room || '', event: r.event || '', status: r.status || '',
        description: description, room_description: roomDescription,
        capacity: typeof r.capacity === 'number' ? r.capacity : (parseCapacity(roomDescription) || parseCapacity(description))
      };
    });
  }

  // ---------- time and data helpers ----------

  function singaporeClock(input) {
    var date = input instanceof Date ? input : new Date(input || Date.now());
    if (isNaN(date.getTime())) date = new Date();
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SINGAPORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    var values = {};
    parts.forEach(function (part) { if (part.type !== 'literal') values[part.type] = part.value; });
    var hour = parseInt(values.hour, 10) || 0;
    var minute = parseInt(values.minute, 10) || 0;
    return {
      date: values.year + '-' + values.month + '-' + values.day,
      minutes: hour * 60 + minute, hour: hour, minute: minute, value: date
    };
  }

  function getNow(opts) {
    var value = opts && typeof opts.now === 'function' ? opts.now() : opts && opts.now;
    return singaporeClock(value || new Date());
  }

  function esc(value) {
    return String(value === null || typeof value === 'undefined' ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uniqueSorted(values, compare) {
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      var key = String(value);
      if (!seen[key]) { seen[key] = true; out.push(value); }
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

  function formatMinute(minute) {
    if (Number(minute) === 1440) return 'Midnight';
    minute = ((Number(minute) % 1440) + 1440) % 1440;
    var hour = Math.floor(minute / 60);
    var min = minute % 60;
    var suffix = hour >= 12 ? 'PM' : 'AM';
    return (hour % 12 || 12) + ':' + String(min).padStart(2, '0') + ' ' + suffix;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

  function liveStatus(row, nowMinutes, scheduleCurrent) {
    if (!scheduleCurrent) return 'SCHEDULED';
    if (row.start_min === null || row.end_min === null) return row.status || 'SCHEDULED';
    if (row.end_min <= nowMinutes) return 'PAST';
    if (row.start_min <= nowMinutes) return 'CURRENT';
    return 'UPCOMING';
  }

  /* A gap means unallocated, never confirmed Free Access. */
  function buildTimeline(bookings) {
    bookings = bookings.slice().sort(function (a, b) { return a.start_min - b.start_min; });
    var timeline = [];
    bookings.forEach(function (booking, index) {
      timeline.push({
        type: isFreeAccess(booking) ? 'open' : 'busy', start_min: booking.start_min,
        end_min: booking.end_min, start: booking.start, end: booking.end,
        event: booking.event, open_ended: false
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
    var parts = [];
    if (location.length) parts.push('<span>' + location.join(' · ') + '</span>');
    if (info.capacity) parts.push('<span>' + esc(info.capacity) + ' seats</span>');
    return parts.join('');
  }

  // ---------- UI ----------

  var UI_HTML = [
    '<section class="finder-panel" aria-label="Room timetable">',
    '  <div class="finder-topline">',
    '    <div class="view-tabs" role="tablist" aria-label="Timetable views">',
    '      <button type="button" role="tab" data-mode="now">Free Access</button>',
    '      <button type="button" role="tab" data-mode="schedule">Full timetable</button>',
    '    </div>',
    '    <button class="text-button" data-el="resetBtn" type="button">Reset</button>',
    '  </div>',
    '  <div class="time-lens" data-filter-context="availability">',
    '    <div class="lens-heading">',
    '      <div><p class="eyebrow">Time lens</p><h2><span data-el="queryLabel">Now</span><strong data-el="queryTime">—</strong></h2></div>',
    '      <button class="now-button" data-el="nowBtn" type="button">Now</button>',
    '    </div>',
    '    <div class="lens-scroll">',
    '      <div class="lens-track">',
    '        <div class="lens-bars" data-el="lensBars" aria-hidden="true"></div>',
    '        <input class="lens-range" data-el="timeRange" type="range" step="30" aria-label="Find Free Access rooms at a time" />',
    '      </div>',
    '      <div class="lens-axis" data-el="lensAxis" aria-hidden="true"></div>',
    '    </div>',
    '    <p class="lens-hint" data-el="lensHint" aria-live="polite"></p>',
    '  </div>',
    '  <div class="filter-grid">',
    '    <label><span>Block</span><select data-f="block"><option value="">All blocks</option></select></label>',
    '    <label><span>Level</span><select data-f="floor"><option value="">All levels</option></select></label>',
    '    <label data-filter-context="availability"><span>People</span><select data-f="group"><option value="">Any group</option><option value="10">10 people</option><option value="20">20 people</option><option value="40">40 people</option><option value="60">60 people</option><option value="100">100 people</option></select></label>',
    '    <label data-filter-context="availability"><span>Stay for</span><select data-f="duration"><option value="0">Any length</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label>',
    '    <label class="filter-wide"><span>Room</span><input data-f="room" type="search" placeholder="Room name" autocomplete="off" /></label>',
    '  </div>',
    '  <details class="more-filters">',
    '    <summary>Exclude rooms</summary>',
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
    root.querySelectorAll('[data-f]').forEach(function (node) { filters[node.getAttribute('data-f')] = node; });
    var elements = {};
    root.querySelectorAll('[data-el]').forEach(function (node) { elements[node.getAttribute('data-el')] = node; });
    var modeButtons = root.querySelectorAll('[data-mode]');
    var placeSource = data.concat(inventory);
    var freeRows = data.filter(isFreeAccess);
    var freeStarts = freeRows.map(function (row) { return row.start_min; }).filter(function (value) { return value !== null; });
    var freeEnds = freeRows.map(function (row) { return row.end_min; }).filter(function (value) { return value !== null; });
    var lensStart = freeStarts.length ? Math.floor(Math.min.apply(Math, freeStarts) / 30) * 30 : 480;
    var lensEnd = freeEnds.length ? Math.ceil(Math.max.apply(Math, freeEnds) / 30) * 30 : 1320;
    if (scheduleCurrent) {
      var liveMinuteForBounds = getNow(opts).minutes;
      lensStart = Math.min(lensStart, Math.floor(liveMinuteForBounds / 30) * 30);
      lensEnd = Math.max(lensEnd, Math.ceil((liveMinuteForBounds + 30) / 30) * 30);
    }
    lensStart = clamp(lensStart, 0, 1410);
    lensEnd = clamp(Math.max(lensStart + 30, lensEnd), lensStart + 30, 1440);
    var lensMax = lensEnd - 30;

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
    var initialMinute = parseInt(initial.queryMinute, 10);
    var queryTracksNow = initial.queryTracksNow === true || isNaN(initialMinute);
    var queryMinute = queryTracksNow && scheduleCurrent
      ? getNow(opts).minutes
      : clamp(queryTracksNow ? getNow(opts).minutes : initialMinute, lensStart, lensMax);

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
      return { block: base.block, floor: base.floor, capacity: capacity, room_description: base.room_description || '' };
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

    function availableAt(minute) {
      var duration = parseInt(filters.duration.value, 10) || 0;
      var groupSize = parseInt(filters.group.value, 10) || 0;
      var matches = [];
      Object.keys(groups).forEach(function (room) {
        var bookings = groups[room];
        var info = infoFor(bookings);
        if (!matchesPlace(room, info)) return;
        var window = bookings.filter(isFreeAccess).sort(function (a, b) { return a.start_min - b.start_min; })
          .filter(function (row) {
            return row.start_min <= minute && minute < row.end_min && row.end_min - minute >= duration;
          })[0];
        if (window) matches.push({ room: room, info: info, bookings: bookings, window: window });
      });
      matches.sort(function (a, b) {
        if (groupSize) {
          var surplusA = (a.info.capacity || 9999) - groupSize;
          var surplusB = (b.info.capacity || 9999) - groupSize;
          if (surplusA !== surplusB) return surplusA - surplusB;
        }
        var remaining = (b.window.end_min - minute) - (a.window.end_min - minute);
        return remaining || roomSort(a, b);
      });
      return matches;
    }

    function timelineSegment(segment) {
      if (segment.type === 'open') {
        return '<div class="timeline-row"><span class="status-pill status-free">FREE ACCESS</span>' +
          '<span class="timeline-time">' + esc(segment.start) + '–' + esc(segment.end) + '</span>' +
          '<span class="timeline-label">Student access</span></div>';
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

    function roomDayline(bookings, minute) {
      var total = lensEnd - lensStart;
      var segments = bookings.map(function (booking) {
        var start = clamp(booking.start_min, lensStart, lensEnd);
        var end = clamp(booking.end_min, lensStart, lensEnd);
        if (end <= start) return '';
        var left = ((start - lensStart) / total) * 100;
        var width = ((end - start) / total) * 100;
        return '<i class="' + (isFreeAccess(booking) ? 'is-free' : 'is-busy') + '" style="left:' + left + '%;width:' + width + '%"></i>';
      }).join('');
      var marker = ((clamp(minute, lensStart, lensEnd) - lensStart) / total) * 100;
      return '<div class="room-dayline" aria-hidden="true">' + segments + '<b style="left:' + marker + '%"></b></div>';
    }

    function availabilityCard(item) {
      var live = scheduleCurrent && queryTracksNow;
      var value = live ? 'Until ' + esc(item.window.end) : esc(item.window.start) + '–' + esc(item.window.end);
      var detail = formatDuration(item.window.end_min - queryMinute) + (live ? ' remaining' : ' from selected time');
      return '<article class="availability-card is-free">' +
        '<div class="card-topline"><span class="status-pill status-free">Free Access</span></div>' +
        '<h3>' + esc(item.room) + '</h3>' +
        '<div class="room-meta">' + roomMeta(item.info) + '</div>' +
        '<div class="availability-window"><p class="availability-value">' + value + '</p>' +
        '<p class="availability-detail">' + detail + '</p></div>' +
        roomDayline(item.bookings, queryMinute) +
        '<details class="room-details"><summary>Day schedule</summary>' +
        '<div class="timeline-body">' + buildTimeline(item.bookings).map(timelineSegment).join('') + '</div></details>' +
        '</article>';
    }

    function lensSlots() {
      var slots = [];
      for (var minute = lensStart; minute <= lensMax; minute += 30) {
        slots.push({ minute: minute, count: availableAt(minute).length });
      }
      return slots;
    }

    function renderLens(slots, selectedCount) {
      var maxCount = Math.max.apply(Math, slots.map(function (slot) { return slot.count; }).concat([1]));
      var nearest = clamp(Math.round((queryMinute - lensStart) / 30), 0, slots.length - 1);
      elements.lensBars.style.setProperty('--slot-count', slots.length);
      elements.lensBars.innerHTML = slots.map(function (slot, index) {
        var height = slot.count ? Math.max(14, Math.round((slot.count / maxCount) * 100)) : 5;
        return '<span class="' + (index === nearest ? 'is-selected' : '') + '" style="--bar-height:' + height + '%" title="' +
          esc(formatMinute(slot.minute)) + ': ' + slot.count + ' rooms"></span>';
      }).join('');
      elements.timeRange.min = String(lensStart);
      elements.timeRange.max = String(lensMax);
      elements.timeRange.value = String(clamp(Math.round(queryMinute / 30) * 30, lensStart, lensMax));
      elements.timeRange.setAttribute('aria-valuetext', formatMinute(queryMinute) + ', ' + selectedCount + ' matching rooms');
      elements.lensAxis.innerHTML = '<span>' + esc(formatMinute(lensStart)) + '</span><span>' +
        esc(formatMinute(Math.round(((lensStart + lensEnd) / 2) / 30) * 30)) + '</span><span>' + esc(formatMinute(lensEnd)) + '</span>';
      elements.lensHint.textContent = selectedCount + (selectedCount === 1 ? ' room' : ' rooms') + ' at this time · 30-minute steps';
      elements.queryLabel.textContent = scheduleCurrent ? (queryTracksNow ? 'Now' : 'At') : 'Reference';
      elements.queryTime.textContent = formatMinute(queryMinute);
      elements.nowBtn.disabled = !scheduleCurrent;
      elements.nowBtn.title = scheduleCurrent ? 'Use current Singapore time' : 'Current-time mode needs today\'s schedule';
    }

    function renderNow() {
      if (queryTracksNow) queryMinute = scheduleCurrent ? getNow(opts).minutes : clamp(getNow(opts).minutes, lensStart, lensMax);
      var matches = availableAt(queryMinute);
      var slots = lensSlots();
      renderLens(slots, matches.length);
      var next = slots.filter(function (slot) { return slot.minute > queryMinute && slot.count > 0; })[0];
      var eyebrow = (scheduleCurrent ? 'At ' : 'Reference · ') + formatMinute(queryMinute);
      var html = '<section class="result-section" aria-labelledby="freeAccessHeading">' +
        '<div class="section-heading"><div><p class="eyebrow">' + esc(eyebrow) + '</p>' +
        '<h2 id="freeAccessHeading">Free Access <span>' + matches.length + '</span></h2></div></div>';
      if (matches.length) {
        html += '<div class="availability-grid">' + matches.map(availabilityCard).join('') + '</div>';
      } else {
        html += '<div class="empty-state"><span class="empty-route" aria-hidden="true"></span>' +
          '<h2>No match at ' + esc(formatMinute(queryMinute)) + '</h2><p>Change a filter or move along the time lens.</p><div class="empty-actions">' +
          (next ? '<button class="btn primary" type="button" data-action="next" data-minute="' + next.minute + '">Next · ' + esc(formatMinute(next.minute)) + '</button>' : '') +
          '<button class="btn" type="button" data-action="reset">Clear filters</button></div></div>';
      }
      html += '</section>';
      elements.meta.textContent = matches.length + (matches.length === 1 ? ' room' : ' rooms') +
        (filters.group.value ? ' · closest capacity fit first' : ' · longest availability first');
      elements.results.innerHTML = html;
      var liveCount = scheduleCurrent ? availableAt(getNow(opts).minutes).length : null;
      return {
        mode: 'now', openNow: liveCount, laterToday: next ? next.count : 0,
        visibleCount: matches.length, matchingRooms: matches.length, queryMinute: queryMinute
      };
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
        '<div class="section-heading"><div><p class="eyebrow">Published schedule</p>' +
        '<h2 id="scheduleHeading">Full timetable <span>' + rows.length + '</span></h2></div></div>' +
        (rows.length ? '<div class="schedule-table-wrap"><table class="schedule-table"><caption class="sr-only">All published SIM campus schedule events matching the selected filters</caption><thead><tr>' +
          '<th>Start</th><th>End</th><th>Block</th><th>Level</th><th>Room</th><th>Event</th><th>Status</th>' +
          '</tr></thead><tbody>' + tableRows + '</tbody></table></div><div class="schedule-cards">' + mobileRows + '</div>' :
          '<div class="inline-empty"><strong>No matching events found.</strong><span>Reset the filters to see the full timetable.</span></div>') +
        '</section>';
      return { mode: 'schedule', openNow: null, laterToday: null, visibleCount: rows.length };
    }

    var requestedMode = opts.mode;
    if (requestedMode === 'available' || requestedMode === 'today' || requestedMode === 'finder') requestedMode = 'now';
    if (requestedMode === 'table') requestedMode = 'schedule';
    var mode = /^(now|schedule)$/.test(requestedMode) ? requestedMode : 'now';

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
      var summary = mode === 'now' ? renderNow() : renderSchedule();
      if (typeof opts.onSummary === 'function') opts.onSummary(summary);
      return summary;
    }

    function setMode(nextMode) {
      if (nextMode === 'available' || nextMode === 'today' || nextMode === 'finder') nextMode = 'now';
      if (nextMode === 'table') nextMode = 'schedule';
      if (!/^(now|schedule)$/.test(nextMode)) return;
      mode = nextMode;
      render();
      if (typeof opts.onModeChange === 'function') opts.onModeChange(mode);
    }

    modeButtons.forEach(function (button) {
      button.addEventListener('click', function () { setMode(button.getAttribute('data-mode')); });
      button.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        var buttons = Array.prototype.slice.call(modeButtons);
        var offset = event.key === 'ArrowRight' ? 1 : -1;
        var next = buttons[(buttons.indexOf(button) + offset + buttons.length) % buttons.length];
        next.focus();
        setMode(next.getAttribute('data-mode'));
      });
    });
    elements.resetBtn.addEventListener('click', function () {
      Object.keys(filters).forEach(function (key) { filters[key].value = key === 'duration' ? '0' : ''; });
      queryTracksNow = scheduleCurrent;
      queryMinute = scheduleCurrent ? getNow(opts).minutes : clamp(getNow(opts).minutes, lensStart, lensMax);
      render();
    });
    root.querySelectorAll('input[data-f], select[data-f]').forEach(function (input) {
      input.addEventListener('input', render);
      input.addEventListener('change', render);
    });
    elements.timeRange.addEventListener('input', function () {
      queryTracksNow = false;
      queryMinute = clamp(parseInt(elements.timeRange.value, 10) || lensStart, lensStart, lensMax);
      render();
    });
    elements.nowBtn.addEventListener('click', function () {
      if (!scheduleCurrent) return;
      queryTracksNow = true;
      queryMinute = clamp(getNow(opts).minutes, lensStart, lensMax);
      render();
    });
    elements.results.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (!button) return;
      if (button.getAttribute('data-action') === 'next') {
        queryTracksNow = false;
        queryMinute = clamp(parseInt(button.getAttribute('data-minute'), 10), lensStart, lensMax);
        render();
        root.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (button.getAttribute('data-action') === 'reset') {
        Object.keys(filters).forEach(function (key) { filters[key].value = key === 'duration' ? '0' : ''; });
        render();
      }
    });

    render();

    return {
      render: render,
      setMode: setMode,
      setQueryMinute: function (minute) {
        queryTracksNow = minute === null || minute === 'now';
        queryMinute = queryTracksNow && scheduleCurrent
          ? getNow(opts).minutes
          : clamp(queryTracksNow ? getNow(opts).minutes : Number(minute), lensStart, lensMax);
        return render();
      },
      getData: function () { return data; },
      getState: function () {
        var state = {};
        Object.keys(filters).forEach(function (key) { state[key] = filters[key].value; });
        state.queryMinute = queryMinute;
        state.queryTracksNow = queryTracksNow;
        return state;
      },
      getMode: function () { return mode; }
    };
  }

  global.SIMTimetable = {
    toMinutes: toMinutes, parseTimeRange: parseTimeRange, parseBlock: parseBlock,
    parseFloor: parseFloor, parseCapacity: parseCapacity, normalize: normalize,
    buildTimeline: buildTimeline, singaporeClock: singaporeClock,
    formatMinute: formatMinute, escapeHtml: esc, mount: mount
  };
})(typeof window !== 'undefined' ? window : this);
