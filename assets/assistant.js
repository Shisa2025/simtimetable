import {
  DAY_MS,
  addDays,
  dateBounds,
  defaultProfile,
  durationLabel,
  formatMinute,
  formatTime,
  matchRoom,
  occurrencesForRange,
  parseIcs,
  recommendRooms,
  roomInfo,
  sanitizeProfile,
  singaporeDateKey,
  singaporeParts,
  todayModel,
  weekBounds
} from './assistant-data.js';

const PROFILE_KEY = 'sim-campus-assistant-profile-v1';
const CAMPUS_KEY = 'sim-timetable-payload';
const FEED_URL = 'https://raw.githubusercontent.com/Shisa2025/simtimetable/main/data/latest.json';

const setupDialog = document.getElementById('setupDialog');
const message = document.getElementById('assistantMessage');
const classPicker = document.getElementById('classPicker');
const importSummary = document.getElementById('importSummary');
const importActions = document.getElementById('importActions');
const roomOptions = document.getElementById('roomOptions');

let profile = loadProfile();
let campusPayload = loadCampusPayload();
let importPreview = null;
let importFileName = '';

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? sanitizeProfile(JSON.parse(raw)) : defaultProfile();
  } catch (error) {
    return defaultProfile();
  }
}

function loadCampusPayload() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAMPUS_KEY) || 'null');
    return validCampusPayload(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function validCampusPayload(value) {
  return Boolean(value && Array.isArray(value.rows) && value.rows.length && Array.isArray(value.rooms));
}

function saveProfile(next, successText) {
  const clean = sanitizeProfile(next);
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
  } catch (error) {
    setMessage('Could not save your timetable. Export or clear some browser data, then try again.', true);
    return false;
  }
  profile = clean;
  if (successText) setMessage(successText, false);
  render();
  renderManualSeries();
  syncSettings();
  return true;
}

function setMessage(text, error) {
  message.textContent = text || '';
  message.classList.toggle('is-error', Boolean(error));
}

function roomInventory() {
  return campusPayload && Array.isArray(campusPayload.rooms) ? campusPayload.rooms : [];
}

function eventPlace(event) {
  if (event.room) {
    const detail = [event.block ? `Block ${event.block}` : '', event.floor != null ? `Level ${event.floor}` : ''].filter(Boolean).join(' · ');
    return `${event.room}${detail ? ` · ${detail}` : ''}`;
  }
  return event.location || 'Location not set';
}

function formatDayHeading(dateKey) {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', weekday: 'long', day: 'numeric', month: 'long'
  }).format(new Date(`${dateKey}T12:00:00+08:00`));
}

function formatShortDay(dateKey) {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short'
  }).format(new Date(`${dateKey}T12:00:00+08:00`));
}

function ageLabel(iso) {
  const age = Date.now() - Date.parse(iso || '');
  if (!Number.isFinite(age)) return 'Update time unavailable';
  const minutes = Math.max(0, Math.floor(age / 60000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

function renderDataStatus() {
  const target = document.getElementById('campusDataStatus');
  if (!target) return;
  if (!campusPayload) {
    target.textContent = 'Today’s campus snapshot is unavailable. Personal classes still work on this device.';
    return;
  }
  const current = Array.isArray(campusPayload.schedule_dates) && campusPayload.schedule_dates.includes(singaporeDateKey());
  const count = campusPayload.rows.filter((row) => /\bFree Access\b/i.test(String(row.event || ''))).length;
  target.textContent = current
    ? `${count} published Free Access windows · ${ageLabel(campusPayload.scraped_at)}`
    : `Previous snapshot · ${ageLabel(campusPayload.scraped_at)}`;
}

function focusMarkup(model, now) {
  if (!model.events.length) {
    return `
      <div class="focus-status"><span class="live-dot" aria-hidden="true"></span><span>No classes scheduled today</span></div>
      <p class="eyebrow">Your day</p>
      <h2>You’re clear for today.</h2>
      <p class="focus-copy">Use the room finder when you need a confirmed place to study on campus.</p>
      <div class="focus-actions"><a class="btn primary" href="/rooms#free-access">Find a room</a><button class="btn" type="button" data-open-setup>Manage timetable</button></div>`;
  }
  if (model.current) {
    const current = model.current;
    const nextLine = model.next
      ? `Next: ${esc(model.next.title)} at ${esc(formatTime(model.next.startIso))}`
      : 'No more classes after this one.';
    return `
      <div class="focus-status"><span class="live-dot" aria-hidden="true"></span><span>In class now</span></div>
      <p class="eyebrow">Until ${esc(formatTime(current.endIso))}</p>
      <h2>${esc(current.title)}</h2>
      <p class="focus-location">${esc(eventPlace(current))}</p>
      <p class="focus-copy">${nextLine}</p>
      <div class="focus-actions"><button class="btn" type="button" data-open-setup>Manage timetable</button></div>`;
  }
  if (model.next) {
    const wait = durationLabel(Date.parse(model.next.startIso) - now.getTime());
    return `
      <div class="focus-status"><span class="live-dot is-later" aria-hidden="true"></span><span>Next class in ${esc(wait)}</span></div>
      <p class="eyebrow">Starts ${esc(formatTime(model.next.startIso))}</p>
      <h2>${esc(model.next.title)}</h2>
      <p class="focus-location">${esc(eventPlace(model.next))}</p>
      <p class="focus-copy">${model.conflicts ? `${model.conflicts} timetable conflict${model.conflicts === 1 ? '' : 's'} need attention.` : 'Your travel buffer is included in room suggestions.'}</p>
      <div class="focus-actions"><button class="btn" type="button" data-open-setup>Manage timetable</button></div>`;
  }
  return `
    <div class="focus-status"><span class="live-dot is-done" aria-hidden="true"></span><span>Classes finished</span></div>
    <p class="eyebrow">Your day</p>
    <h2>You’re done for today.</h2>
    <p class="focus-copy">If you are staying on campus, look for a confirmed Free Access room below.</p>
    <div class="focus-actions"><a class="btn primary" href="/rooms#free-access">Find a room</a><button class="btn" type="button" data-open-setup>Manage timetable</button></div>`;
}

function roomSuggestionMarkup(model, now) {
  const result = recommendRooms(campusPayload, model, profile.preferences, now);
  if (result.state !== 'ready') {
    return `
      <p class="eyebrow">Study space</p>
      <h2>${result.state === 'leave' ? 'Time to head to class' : 'No confirmed suggestion'}</h2>
      <p class="note">${esc(result.message)}</p>
      <a class="text-link assistant-side-link" href="/rooms#free-access">Open the full room finder</a>`;
  }
  const timing = model.current ? `After class · until ${formatMinute(result.requiredEnd)}` : `Now · until ${formatMinute(result.requiredEnd)}`;
  return `
    <p class="eyebrow">Study space</p>
    <h2>${esc(timing)}</h2>
    <p class="note">Confirmed Free Access${result.targetBlock ? ` · Block ${esc(result.targetBlock)} first` : ''}</p>
    <div class="suggestion-list">
      ${result.rooms.map((room) => `
        <a href="/rooms#free-access" class="suggestion-room">
          <strong>${esc(room.room)}</strong>
          <span>${room.block ? `Block ${esc(room.block)}` : 'Block unknown'}${room.floor != null ? ` · Level ${esc(room.floor)}` : ''}${room.capacity ? ` · ${esc(room.capacity)} seats` : ''}</span>
        </a>`).join('')}
    </div>
    <a class="text-link assistant-side-link" href="/rooms#free-access">See all matching rooms</a>`;
}

function agendaMarkup(model, now) {
  if (!model.events.length) {
    return `<div class="agenda-empty card"><span class="agenda-time">—</span><div><strong>No classes today</strong><p>Your imported timetable has no class sessions on ${esc(formatDayHeading(model.date))}.</p></div></div>`;
  }
  return `<div class="agenda-list">${model.events.map((event) => {
    const active = Date.parse(event.startIso) <= now.getTime() && now.getTime() < Date.parse(event.endIso);
    const past = Date.parse(event.endIso) <= now.getTime();
    return `<article class="agenda-item card${active ? ' is-current' : ''}${past ? ' is-past' : ''}">
      <time>${esc(formatTime(event.startIso))}<span>${esc(formatTime(event.endIso))}</span></time>
      <div><strong>${esc(event.title)}</strong><p>${esc(eventPlace(event))}</p></div>
      <span class="agenda-source">${event.source === 'manual' ? 'Manual' : 'ICS'}</span>
    </article>`;
  }).join('')}</div>`;
}

function renderToday(now) {
  const model = todayModel(profile, now);
  const hasProfile = profile.importedClasses.length || profile.manualClasses.length;
  const focus = document.querySelector('.assistant-focus');
  const side = document.querySelector('.assistant-side');
  const agendaSection = document.querySelector('#todayView .assistant-section');
  if (!hasProfile) {
    focus.innerHTML = `
      <div class="focus-status"><span class="live-dot" aria-hidden="true"></span><span>Ready when your timetable is</span></div>
      <p class="eyebrow">Next class</p><h2>Add your class timetable</h2>
      <p class="focus-copy">Import an ICS calendar or add classes manually. Your selections stay in this browser.</p>
      <div class="focus-actions"><button class="btn primary" type="button" data-open-setup>Set up timetable</button><a class="text-link" href="/rooms#free-access">Continue without a timetable</a></div>`;
    side.innerHTML = `<p class="eyebrow">Campus rooms</p><h2>Find a confirmed study space</h2><p class="note">Room suggestions only use access windows explicitly published by SIM.</p><div class="assistant-data-status" id="campusDataStatus" role="status"></div>`;
    document.querySelector('#todayView .assistant-section').innerHTML = `<div class="section-heading"><div><p class="eyebrow">Your day</p><h2 id="todayAgendaHeading">Today’s agenda</h2></div></div><div class="agenda-empty card"><span class="agenda-time">—</span><div><strong>No personal classes saved yet</strong><p>Once added, classes and study-room suggestions will appear here.</p></div></div>`;
  } else {
    focus.innerHTML = focusMarkup(model, now);
    side.innerHTML = roomSuggestionMarkup(model, now);
    agendaSection.innerHTML = `<div class="section-heading"><div><p class="eyebrow">${esc(formatDayHeading(model.date))}</p><h2 id="todayAgendaHeading">Today’s agenda${model.conflicts ? ` <span>${model.conflicts} conflict${model.conflicts === 1 ? '' : 's'}</span>` : ''}</h2></div></div>${agendaMarkup(model, now)}`;
  }
}

function renderWeek(now) {
  const bounds = weekBounds(now);
  const events = occurrencesForRange(profile, bounds.start, bounds.end);
  const monday = singaporeDateKey(bounds.start);
  const today = singaporeDateKey(now);
  const hasProfile = profile.importedClasses.length || profile.manualClasses.length;
  if (!hasProfile) {
    document.getElementById('weekView').innerHTML = `<div class="week-empty card"><p class="eyebrow">This week</p><h2>Your seven-day timetable will live here.</h2><p>Add an ICS file or create a repeating class to see Monday through Sunday.</p><button class="btn primary" type="button" data-open-setup>Set up timetable</button></div>`;
    return;
  }
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  document.getElementById('weekView').innerHTML = `
    <div class="week-toolbar"><div><p class="eyebrow">This week</p><h2>${esc(formatShortDay(days[0]))} – ${esc(formatShortDay(days[6]))}</h2></div><button class="btn" type="button" data-open-setup>Manage timetable</button></div>
    <div class="week-grid">${days.map((day) => {
      const dayEvents = events.filter((event) => singaporeDateKey(new Date(event.startIso)) === day);
      return `<section class="week-day${day === today ? ' is-today' : ''}" aria-label="${esc(formatDayHeading(day))}">
        <header><span>${esc(new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', weekday: 'short' }).format(new Date(`${day}T12:00:00+08:00`)))}</span><strong>${esc(day.slice(-2))}</strong></header>
        <div>${dayEvents.length ? dayEvents.map((event) => `<article class="week-event"><time>${esc(formatTime(event.startIso))}</time><strong>${esc(event.title)}</strong><span>${esc(event.room || event.location || 'Location not set')}</span></article>`).join('') : '<p class="week-none">No class</p>'}</div>
      </section>`;
    }).join('')}</div>`;
}

function render(now = new Date()) {
  const parts = singaporeParts(now);
  document.getElementById('assistantDate').textContent = `${formatDayHeading(parts.date)} · Singapore`;
  renderToday(now);
  renderWeek(now);
  renderDataStatus();
}

function showView() {
  const mode = location.hash === '#week' ? 'week' : 'today';
  document.querySelectorAll('[data-assistant-view]').forEach((view) => { view.hidden = view.getAttribute('data-assistant-view') !== mode; });
  document.querySelectorAll('[data-assistant-link]').forEach((link) => {
    if (link.getAttribute('data-assistant-link') === mode) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function openSetup(tab = 'import') {
  setSetupTab(tab);
  setMessage('', false);
  renderManualSeries();
  syncSettings();
  if (typeof setupDialog.showModal === 'function') setupDialog.showModal();
  else setupDialog.setAttribute('open', '');
}

function closeSetup() {
  if (typeof setupDialog.close === 'function') setupDialog.close();
  else setupDialog.removeAttribute('open');
}

function setSetupTab(tab) {
  document.querySelectorAll('[data-setup-tab]').forEach((button) => {
    const active = button.getAttribute('data-setup-tab') === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-setup-panel]').forEach((panel) => { panel.hidden = panel.getAttribute('data-setup-panel') !== tab; });
}

function populateRoomOptions() {
  roomOptions.innerHTML = roomInventory()
    .slice().sort((a, b) => String(a.room).localeCompare(String(b.room)))
    .map((room) => `<option value="${esc(room.room)}">${esc([room.block ? `Block ${room.block}` : '', room.floor != null ? `Level ${room.floor}` : ''].filter(Boolean).join(' · '))}</option>`)
    .join('');
}

function renderImportPreview() {
  if (!importPreview) return;
  const suggested = importPreview.series.filter((series) => series.room || series.occurrenceCount > 1).length;
  importSummary.hidden = false;
  importSummary.innerHTML = `<strong>${importPreview.series.length} event series found</strong><span>${suggested} likely class series selected · ${importPreview.series.reduce((sum, item) => sum + item.occurrenceCount, 0)} sessions in range</span>${importPreview.warnings.length ? `<details><summary>${importPreview.warnings.length} import note${importPreview.warnings.length === 1 ? '' : 's'}</summary><ul>${importPreview.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></details>` : ''}`;
  classPicker.innerHTML = importPreview.series.map((series) => {
    const checked = series.room || series.occurrenceCount > 1;
    const first = series.occurrences[0];
    return `<article class="class-choice">
      <label class="class-choice-main"><input type="checkbox" data-import-series="${esc(series.id)}" ${checked ? 'checked' : ''} /><span><strong>${esc(series.title)}</strong><small>${esc(formatTime(first.startIso))} · ${esc(series.occurrenceCount)} session${series.occurrenceCount === 1 ? '' : 's'}${series.location ? ` · ${esc(series.location)}` : ''}</small></span></label>
      <label class="class-room"><span>SIM room</span><input data-import-room="${esc(series.id)}" list="roomOptions" value="${esc(series.room)}" placeholder="Optional room code" /></label>
    </article>`;
  }).join('');
  importActions.hidden = false;
}

function saveImportedClasses() {
  if (!importPreview) return;
  const selected = importPreview.series.filter((series) => {
    const checkbox = classPicker.querySelector(`[data-import-series="${CSS.escape(series.id)}"]`);
    return checkbox && checkbox.checked;
  });
  if (!selected.length) {
    setMessage('Select at least one class series to save.', true);
    return;
  }
  const rooms = roomInventory();
  const imported = selected.flatMap((series) => {
    const input = classPicker.querySelector(`[data-import-room="${CSS.escape(series.id)}"]`);
    const entered = input ? input.value.trim() : '';
    const exact = rooms.find((room) => String(room.room).toUpperCase() === entered.toUpperCase());
    const detected = exact ? exact.room : matchRoom(entered, rooms).room;
    const info = roomInfo(detected, rooms);
    return series.occurrences.map((occurrence) => ({
      ...occurrence,
      location: entered && !detected ? entered : occurrence.location,
      room: info.room,
      block: info.block,
      floor: info.floor
    }));
  });
  const next = { ...profile, importedAt: new Date().toISOString(), icsName: importFileName, importedClasses: imported };
  if (saveProfile(next, `${selected.length} class series saved on this device.`)) {
    closeSetup();
    importPreview = null;
    importFileName = '';
    document.getElementById('icsFile').value = '';
    classPicker.innerHTML = '';
    importActions.hidden = true;
    importSummary.hidden = true;
  }
}

function renderManualSeries() {
  const target = document.getElementById('manualSeriesList');
  if (!profile.manualClasses.length) {
    target.innerHTML = '<p class="note">No manually added classes.</p>';
    return;
  }
  target.innerHTML = `<h3>Manually added</h3>${profile.manualClasses.map((item) => `<article><div><strong>${esc(item.title)}</strong><span>${esc(item.startTime)}–${esc(item.endTime)} · ${esc(item.room || item.location || 'No location')}</span></div><button type="button" data-remove-manual="${esc(item.id)}" aria-label="Remove ${esc(item.title)}">Remove</button></article>`).join('')}`;
}

function syncSettings() {
  document.getElementById('travelBuffer').value = String(profile.preferences.travelBufferMinutes);
  document.getElementById('groupSize').value = profile.preferences.groupSize ? String(profile.preferences.groupSize) : '';
}

function exportProfile() {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `sim-campus-assistant-${singaporeDateKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  setMessage('Assistant data exported.', false);
}

async function fetchCampusData() {
  renderDataStatus();
  try {
    const response = await fetch(FEED_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (!validCampusPayload(remote)) throw new Error('Invalid campus payload');
    if (!campusPayload || Date.parse(remote.scraped_at || '') > Date.parse(campusPayload.scraped_at || '')) {
      campusPayload = remote;
      try { localStorage.setItem(CAMPUS_KEY, JSON.stringify(remote)); } catch (error) { /* non-fatal cache failure */ }
    }
  } catch (error) {
    /* Personal timetable still works with the saved or unavailable campus snapshot. */
  }
  populateRoomOptions();
  render();
}

function setManualDefaults() {
  const form = document.getElementById('manualClassForm');
  const today = singaporeDateKey();
  form.elements.validFrom.value = today;
  form.elements.validUntil.value = addDays(today, 112);
  form.elements.startTime.value = '09:00';
  form.elements.endTime.value = '10:00';
  const day = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  form.querySelectorAll('input[name="days"]').forEach((checkbox) => { checkbox.checked = Number(checkbox.value) === day; });
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const setup = event.target.closest('[data-open-setup]');
    if (setup) openSetup();
  });
  document.getElementById('closeSetup').addEventListener('click', closeSetup);
  setupDialog.addEventListener('click', (event) => {
    if (event.target === setupDialog) closeSetup();
  });
  document.querySelectorAll('[data-setup-tab]').forEach((button) => {
    button.addEventListener('click', () => setSetupTab(button.getAttribute('data-setup-tab')));
  });
  window.addEventListener('hashchange', showView);

  document.getElementById('icsFile').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage('That ICS file is larger than 5 MB. Export a smaller calendar range and try again.', true);
      return;
    }
    setMessage('Reading calendar…', false);
    try {
      const now = new Date();
      importPreview = parseIcs(await file.text(), {
        rooms: roomInventory(),
        rangeStart: new Date(now.getTime() - 30 * DAY_MS),
        rangeEnd: new Date(now.getTime() + 366 * DAY_MS)
      });
      importFileName = file.name;
      renderImportPreview();
      setMessage('Choose the event series that are classes, then save.', false);
    } catch (error) {
      importPreview = null;
      classPicker.innerHTML = '';
      importSummary.hidden = true;
      importActions.hidden = true;
      setMessage(error.message || 'Could not read that calendar.', true);
    }
  });
  document.getElementById('saveImportedClasses').addEventListener('click', saveImportedClasses);
  document.getElementById('selectAllClasses').addEventListener('click', () => {
    const boxes = Array.from(classPicker.querySelectorAll('[data-import-series]'));
    const allSelected = boxes.length && boxes.every((box) => box.checked);
    boxes.forEach((box) => { box.checked = !allSelected; });
    document.getElementById('selectAllClasses').textContent = allSelected ? 'Select all' : 'Clear selection';
  });

  document.getElementById('manualClassForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const days = data.getAll('days').map(Number);
    if (!days.length) {
      setMessage('Choose at least one weekday.', true);
      return;
    }
    if (String(data.get('endTime')) <= String(data.get('startTime'))) {
      setMessage('The class end time must be later than its start time.', true);
      return;
    }
    if (String(data.get('validUntil')) < String(data.get('validFrom'))) {
      setMessage('The repeat-until date must be on or after the start date.', true);
      return;
    }
    const entered = String(data.get('room') || '').trim();
    const rooms = roomInventory();
    const exact = rooms.find((room) => String(room.room).toUpperCase() === entered.toUpperCase());
    const detected = exact ? exact.room : matchRoom(entered, rooms).room;
    const info = roomInfo(detected, rooms);
    const item = {
      id: `manual-${Date.now().toString(36)}`,
      title: String(data.get('title') || '').trim(),
      validFrom: String(data.get('validFrom')),
      validUntil: String(data.get('validUntil')),
      startTime: String(data.get('startTime')),
      endTime: String(data.get('endTime')),
      days,
      location: detected ? '' : entered,
      room: info.room,
      block: info.block,
      floor: info.floor
    };
    if (saveProfile({ ...profile, manualClasses: profile.manualClasses.concat(item) }, `${item.title || 'Class'} added.`)) {
      form.reset();
      setManualDefaults();
    }
  });

  document.getElementById('manualSeriesList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-manual]');
    if (!button) return;
    const id = button.getAttribute('data-remove-manual');
    const item = profile.manualClasses.find((entry) => entry.id === id);
    if (!item || !window.confirm(`Remove ${item.title} from your local timetable?`)) return;
    saveProfile({ ...profile, manualClasses: profile.manualClasses.filter((entry) => entry.id !== id) }, `${item.title} removed.`);
  });

  document.getElementById('travelBuffer').addEventListener('change', (event) => {
    saveProfile({ ...profile, preferences: { ...profile.preferences, travelBufferMinutes: Number(event.target.value) } }, 'Travel buffer updated.');
  });
  document.getElementById('groupSize').addEventListener('change', (event) => {
    saveProfile({ ...profile, preferences: { ...profile.preferences, groupSize: Number(event.target.value) || null } }, 'Group size updated.');
  });
  document.getElementById('exportProfile').addEventListener('click', exportProfile);
  document.getElementById('backupFile').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || Number(raw.version) !== 1 || !Array.isArray(raw.importedClasses) || !Array.isArray(raw.manualClasses)) throw new Error('Not a SIM Campus Assistant v1 backup.');
      if (!window.confirm('Replace the personal timetable saved in this browser?')) return;
      saveProfile(raw, 'Assistant data restored.');
    } catch (error) {
      setMessage(error.message || 'Could not read that backup.', true);
    } finally {
      event.target.value = '';
    }
  });
  document.getElementById('clearProfile').addEventListener('click', () => {
    if (!window.confirm('Clear all imported and manually added classes from this browser?')) return;
    if (saveProfile(defaultProfile(), 'Personal timetable cleared.')) closeSetup();
  });
}

function init() {
  populateRoomOptions();
  setManualDefaults();
  bindEvents();
  showView();
  render();
  fetchCampusData();
  setInterval(() => render(), 30000);
}

const legacyHash = location.hash === '#free-access' || location.hash === '#schedule';
const awaiting = new URLSearchParams(location.search).get('awaiting') === '1';
if (legacyHash || awaiting) {
  location.replace(`/rooms${location.search}${legacyHash ? location.hash : ''}`);
} else {
  init();
}
