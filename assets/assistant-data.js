import ICAL from './vendor/ical.min.js';

const SINGAPORE_TZ = 'Asia/Singapore';
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OCCURRENCES = 20000;

function registerSingaporeTimezone() {
  if (ICAL.TimezoneService.has(SINGAPORE_TZ)) return;
  const source = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:' + SINGAPORE_TZ,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:SGT',
    'END:STANDARD',
    'END:VTIMEZONE',
    'END:VCALENDAR'
  ].join('\r\n');
  const calendar = new ICAL.Component(ICAL.parse(source));
  const component = calendar.getFirstSubcomponent('vtimezone');
  ICAL.TimezoneService.register(SINGAPORE_TZ, new ICAL.Timezone({ component, tzid: SINGAPORE_TZ }));
}

registerSingaporeTimezone();

function clean(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function isoDate(value) {
  const text = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function validIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function singaporeParts(input = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    weekday: 'short'
  }).formatToParts(input);
  const values = {};
  parts.forEach((part) => { if (part.type !== 'literal') values[part.type] = part.value; });
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
    weekday: values.weekday
  };
}

export function singaporeDateKey(input = new Date()) {
  return singaporeParts(input).date;
}

export function singaporeMinute(input = new Date()) {
  const parts = singaporeParts(input);
  return parts.hour * 60 + parts.minute;
}

export function singaporeDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function dateBounds(dateKey) {
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function weekBounds(input = new Date()) {
  const today = singaporeDateKey(input);
  const start = new Date(`${today}T00:00:00+08:00`);
  const day = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

export function addDays(dateKey, count) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + count);
  return singaporeDateKey(date);
}

function hash(value) {
  let result = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    result ^= text.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function roomCapacity(value) {
  const match = String(value || '').match(/\((\d+)\s*pax\)/i);
  return match ? Number(match[1]) : null;
}

export function roomInfo(roomCode, rooms = []) {
  const code = clean(roomCode, 100);
  const match = rooms.find((room) => clean(room.room, 100).toUpperCase() === code.toUpperCase());
  if (!match) return { room: code, block: null, floor: null, capacity: null };
  return {
    room: clean(match.room, 100),
    block: clean(match.block, 4) || null,
    floor: match.floor !== null && match.floor !== '' && Number.isFinite(Number(match.floor)) ? Number(match.floor) : null,
    capacity: roomCapacity(match.description)
  };
}

export function matchRoom(value, rooms = []) {
  const haystack = clean(value, 500).toUpperCase();
  if (!haystack) return { room: '', ambiguous: false };
  const matches = rooms
    .map((room) => clean(room.room, 100))
    .filter(Boolean)
    .filter((room) => haystack.includes(room.toUpperCase()))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (!matches.length) return { room: '', ambiguous: false };
  const longest = matches[0].length;
  const top = matches.filter((room) => room.length === longest);
  return { room: top[0], ambiguous: top.length > 1, candidates: top };
}

function propertyTzid(component, name) {
  const property = component.getFirstProperty(name);
  return property ? clean(property.getParameter('tzid'), 100) : '';
}

function timeToDate(time, tzidHint) {
  if (!time) return null;
  const tzid = clean((time.zone && time.zone.tzid) || tzidHint, 100);
  if (!tzid || tzid === 'floating' || tzid === SINGAPORE_TZ) {
    const utc = Date.UTC(time.year, time.month - 1, time.day, time.hour || 0, time.minute || 0, time.second || 0) - SGT_OFFSET_MS;
    return new Date(utc);
  }
  const unix = time.toUnixTime();
  return Number.isFinite(unix) ? new Date(unix * 1000) : null;
}

function registerEmbeddedTimezones(calendar, warnings) {
  calendar.getAllSubcomponents('vtimezone').forEach((component) => {
    const tzid = clean(component.getFirstPropertyValue('tzid'), 100);
    if (!tzid) return;
    try {
      ICAL.TimezoneService.register(tzid, new ICAL.Timezone({ component, tzid }));
    } catch (error) {
      warnings.push(`Could not read embedded timezone ${tzid}.`);
    }
  });
}

function supportedTimezone(tzid) {
  return !tzid || tzid === 'UTC' || tzid === 'Etc/UTC' || tzid === 'GMT' || tzid === SINGAPORE_TZ || ICAL.TimezoneService.has(tzid);
}

function occurrenceFromDetails(details, master, seriesId, rooms) {
  const item = details.item || master;
  const component = item.component;
  if (clean(component.getFirstPropertyValue('status'), 30).toUpperCase() === 'CANCELLED') return null;
  const startTz = propertyTzid(component, 'dtstart') || propertyTzid(master.component, 'dtstart');
  const endTz = propertyTzid(component, 'dtend') || propertyTzid(master.component, 'dtend') || startTz;
  const start = timeToDate(details.startDate, startTz);
  const end = timeToDate(details.endDate, endTz);
  if (!start || !end || end <= start) return null;
  const title = clean(item.summary || master.summary || 'Class', 160);
  const location = clean(item.location || master.location, 200);
  const detected = matchRoom(`${location} ${title}`, rooms);
  const info = roomInfo(detected.room, rooms);
  const startIso = start.toISOString();
  return {
    id: `${seriesId}:${hash(startIso)}`,
    seriesId,
    title,
    startIso,
    endIso: end.toISOString(),
    location,
    room: info.room,
    block: info.block,
    floor: info.floor,
    source: 'ics'
  };
}

export function parseIcs(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Choose a non-empty ICS calendar file.');
  const rooms = Array.isArray(options.rooms) ? options.rooms : [];
  const rangeStart = options.rangeStart instanceof Date ? options.rangeStart : new Date(Date.now() - 30 * DAY_MS);
  const rangeEnd = options.rangeEnd instanceof Date ? options.rangeEnd : new Date(Date.now() + 366 * DAY_MS);
  const warnings = [];
  let calendar;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch (error) {
    throw new Error('That file is not a readable ICS calendar.');
  }
  registerEmbeddedTimezones(calendar, warnings);
  const components = calendar.getAllSubcomponents('vevent');
  if (!components.length) throw new Error('That calendar has no events.');
  const masterByUid = new Map();
  components.filter((component) => !component.hasProperty('recurrence-id')).forEach((component, index) => {
    const uid = clean(component.getFirstPropertyValue('uid'), 180) || `event-${index + 1}`;
    const sequence = Number(component.getFirstPropertyValue('sequence')) || 0;
    const previous = masterByUid.get(uid);
    if (!previous || sequence >= previous.sequence) masterByUid.set(uid, { component, sequence });
  });
  const masters = Array.from(masterByUid.values()).map((item) => item.component);
  const series = [];
  let produced = 0;

  masters.forEach((component, index) => {
    if (clean(component.getFirstPropertyValue('status'), 30).toUpperCase() === 'CANCELLED') return;
    const event = new ICAL.Event(component);
    if (!event.startDate || event.startDate.isDate) return;
    const tzids = [propertyTzid(component, 'dtstart'), propertyTzid(component, 'dtend')].filter(Boolean);
    const unsupported = tzids.find((tzid) => !supportedTimezone(tzid));
    if (unsupported) {
      warnings.push(`${clean(event.summary || 'Event', 80)} uses unsupported timezone ${unsupported} and was skipped.`);
      return;
    }
    const uid = clean(event.uid, 180) || `event-${index + 1}`;
    const seriesId = `ics-${hash(uid)}`;
    const occurrences = [];
    const addOccurrence = (details) => {
      const value = occurrenceFromDetails(details, event, seriesId, rooms);
      if (!value) return;
      const start = Date.parse(value.startIso);
      const end = Date.parse(value.endIso);
      if (end > rangeStart.getTime() && start < rangeEnd.getTime()) occurrences.push(value);
    };

    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next;
      let guard = 0;
      while ((next = iterator.next()) && guard < MAX_OCCURRENCES) {
        guard += 1;
        const start = timeToDate(next, propertyTzid(component, 'dtstart'));
        if (start && start >= rangeEnd) break;
        addOccurrence(event.getOccurrenceDetails(next));
      }
      produced += guard;
      if (guard >= MAX_OCCURRENCES) warnings.push(`${clean(event.summary || 'Event', 80)} has too many recurrences and was truncated.`);
    } else {
      addOccurrence({ item: event, startDate: event.startDate, endDate: event.endDate });
      produced += 1;
    }

    if (!occurrences.length) return;
    const first = occurrences[0];
    series.push({
      id: seriesId,
      uid,
      title: clean(event.summary || first.title || 'Class', 160),
      location: clean(event.location || first.location, 200),
      room: first.room,
      block: first.block,
      floor: first.floor,
      ambiguousRoom: matchRoom(`${event.location || ''} ${event.summary || ''}`, rooms).ambiguous,
      occurrenceCount: occurrences.length,
      occurrences
    });
  });

  if (!series.length) throw new Error('No timed events in the supported date range were found.');
  return { series, warnings, eventCount: components.length, occurrenceCount: produced };
}

export function defaultProfile() {
  return {
    version: 1,
    importedAt: null,
    icsName: '',
    importedClasses: [],
    manualClasses: [],
    preferences: { travelBufferMinutes: 15, groupSize: null }
  };
}

function sanitizeOccurrence(value) {
  if (!value || typeof value !== 'object') return null;
  const startIso = validIso(value.startIso);
  const endIso = validIso(value.endIso);
  if (!startIso || !endIso || endIso <= startIso) return null;
  return {
    id: clean(value.id, 220) || `class-${hash(startIso + clean(value.title))}`,
    seriesId: clean(value.seriesId, 220) || 'single',
    title: clean(value.title, 160) || 'Class',
    startIso,
    endIso,
    location: clean(value.location, 200),
    room: clean(value.room, 100),
    block: clean(value.block, 4) || null,
    floor: value.floor !== null && value.floor !== '' && Number.isFinite(Number(value.floor)) ? Number(value.floor) : null,
    source: value.source === 'manual' ? 'manual' : 'ics'
  };
}

function sanitizeManual(value) {
  if (!value || typeof value !== 'object') return null;
  const validFrom = isoDate(value.validFrom);
  const validUntil = isoDate(value.validUntil || value.validFrom);
  const startTime = /^\d{2}:\d{2}$/.test(value.startTime || '') ? value.startTime : '';
  const endTime = /^\d{2}:\d{2}$/.test(value.endTime || '') ? value.endTime : '';
  if (!validFrom || !validUntil || validUntil < validFrom || !startTime || !endTime || endTime <= startTime) return null;
  const days = Array.isArray(value.days)
    ? Array.from(new Set(value.days.map(Number).filter((day) => day >= 0 && day <= 6)))
    : [];
  if (!days.length) return null;
  return {
    id: clean(value.id, 120) || `manual-${hash(Date.now() + clean(value.title))}`,
    title: clean(value.title, 160) || 'Class',
    validFrom,
    validUntil,
    startTime,
    endTime,
    days,
    location: clean(value.location, 200),
    room: clean(value.room, 100),
    block: clean(value.block, 4) || null,
    floor: value.floor !== null && value.floor !== '' && Number.isFinite(Number(value.floor)) ? Number(value.floor) : null
  };
}

export function sanitizeProfile(value) {
  if (!value || typeof value !== 'object' || Number(value.version) !== 1) return defaultProfile();
  const profile = defaultProfile();
  profile.importedAt = validIso(value.importedAt) || null;
  profile.icsName = clean(value.icsName, 160);
  profile.importedClasses = Array.isArray(value.importedClasses) ? value.importedClasses.map(sanitizeOccurrence).filter(Boolean) : [];
  profile.manualClasses = Array.isArray(value.manualClasses) ? value.manualClasses.map(sanitizeManual).filter(Boolean) : [];
  const buffer = Number(value.preferences && value.preferences.travelBufferMinutes);
  const group = Number(value.preferences && value.preferences.groupSize);
  profile.preferences.travelBufferMinutes = Number.isFinite(buffer) ? Math.min(60, Math.max(0, Math.round(buffer))) : 15;
  profile.preferences.groupSize = Number.isFinite(group) && group > 0 ? Math.round(group) : null;
  return profile;
}

export function manualOccurrences(series, rangeStart, rangeEnd) {
  const item = sanitizeManual(series);
  if (!item) return [];
  const lower = Math.max(rangeStart.getTime(), Date.parse(`${item.validFrom}T00:00:00+08:00`));
  const upper = Math.min(rangeEnd.getTime(), Date.parse(`${item.validUntil}T00:00:00+08:00`) + DAY_MS);
  const results = [];
  for (let cursor = lower; cursor < upper; cursor += DAY_MS) {
    const date = new Date(cursor);
    const dateKey = singaporeDateKey(date);
    const weekday = new Date(`${dateKey}T12:00:00+08:00`).getUTCDay();
    if (!item.days.includes(weekday)) continue;
    const start = singaporeDateTime(dateKey, item.startTime);
    const end = singaporeDateTime(dateKey, item.endTime);
    if (!start || !end || end <= start) continue;
    results.push({
      id: `${item.id}:${dateKey}`,
      seriesId: item.id,
      title: item.title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      location: item.location,
      room: item.room,
      block: item.block,
      floor: item.floor,
      source: 'manual'
    });
  }
  return results;
}

export function occurrencesForRange(profileValue, rangeStart, rangeEnd) {
  const profile = sanitizeProfile(profileValue);
  const imported = profile.importedClasses.filter((item) => Date.parse(item.endIso) > rangeStart.getTime() && Date.parse(item.startIso) < rangeEnd.getTime());
  const manual = profile.manualClasses.flatMap((item) => manualOccurrences(item, rangeStart, rangeEnd));
  const byId = new Map();
  imported.concat(manual).forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values()).sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso) || a.title.localeCompare(b.title));
}

export function todayModel(profile, now = new Date()) {
  const date = singaporeDateKey(now);
  const bounds = dateBounds(date);
  const events = occurrencesForRange(profile, bounds.start, bounds.end);
  const stamp = now.getTime();
  const currentEvents = events.filter((event) => Date.parse(event.startIso) <= stamp && stamp < Date.parse(event.endIso));
  const current = currentEvents[0] || null;
  const next = events.find((event) => Date.parse(event.startIso) > stamp) || null;
  let conflicts = 0;
  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index].startIso) < Date.parse(events[index - 1].endIso)) conflicts += 1;
  }
  return { date, events, current, currentEvents, next, conflicts };
}

function minuteForOccurrence(value) {
  const parts = singaporeParts(new Date(value));
  return parts.hour * 60 + parts.minute;
}

function isFreeAccess(row) {
  return /\bFree Access\b/i.test(String(row && row.event || ''));
}

export function recommendRooms(payload, model, preferences, now = new Date()) {
  const today = singaporeDateKey(now);
  if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.rooms)) {
    return { state: 'unavailable', message: 'Today’s campus room snapshot is unavailable.', rooms: [] };
  }
  if (!Array.isArray(payload.schedule_dates) || !payload.schedule_dates.includes(today)) {
    return { state: 'stale', message: 'Room suggestions are paused because the campus snapshot is not for today.', rooms: [] };
  }
  const prefs = sanitizeProfile({ version: 1, preferences }).preferences;
  const current = model.current;
  const next = model.next;
  const startMinute = current ? minuteForOccurrence(current.endIso) : singaporeMinute(now);
  const requiredEnd = next ? minuteForOccurrence(next.startIso) - prefs.travelBufferMinutes : startMinute + 60;
  if (next && requiredEnd <= startMinute) {
    return { state: 'leave', message: `Leave now — your ${prefs.travelBufferMinutes}-minute travel buffer has started.`, rooms: [], startMinute, requiredEnd };
  }
  if (startMinute >= 24 * 60 || requiredEnd > 24 * 60) {
    return { state: 'unavailable', message: 'No same-day study window can be calculated.', rooms: [] };
  }
  const targetBlock = next && next.block ? next.block : null;
  const inventory = new Map(payload.rooms.map((room) => [clean(room.room, 100).toUpperCase(), room]));
  const matches = [];
  const seen = new Set();
  payload.rows.filter(isFreeAccess).forEach((row) => {
    const room = clean(row.room, 100);
    if (!room || seen.has(room.toUpperCase())) return;
    if (!Number.isFinite(Number(row.start_min)) || !Number.isFinite(Number(row.end_min))) return;
    if (Number(row.start_min) > startMinute || Number(row.end_min) < requiredEnd) return;
    const rawInfo = inventory.get(room.toUpperCase()) || row;
    const info = roomInfo(room, [rawInfo]);
    const capacity = Number(row.capacity) || info.capacity || roomCapacity(row.room_description);
    if (prefs.groupSize && (!capacity || capacity < prefs.groupSize)) return;
    seen.add(room.toUpperCase());
    matches.push({
      room,
      block: info.block || clean(row.block, 4) || null,
      floor: info.floor == null ? (Number.isFinite(Number(row.floor)) ? Number(row.floor) : null) : info.floor,
      capacity: capacity || null,
      freeUntilMinute: Number(row.end_min),
      sameBlock: Boolean(targetBlock && (info.block || row.block) === targetBlock)
    });
  });
  matches.sort((a, b) => {
    if (a.sameBlock !== b.sameBlock) return a.sameBlock ? -1 : 1;
    if (prefs.groupSize) {
      const surplusA = (a.capacity || 9999) - prefs.groupSize;
      const surplusB = (b.capacity || 9999) - prefs.groupSize;
      if (surplusA !== surplusB) return surplusA - surplusB;
    }
    if (a.freeUntilMinute !== b.freeUntilMinute) return b.freeUntilMinute - a.freeUntilMinute;
    return a.room.localeCompare(b.room);
  });
  if (!matches.length) {
    return {
      state: 'empty',
      message: next ? 'No confirmed Free Access room covers the full gap before your next class.' : 'No confirmed room is open for the next hour.',
      rooms: [], startMinute, requiredEnd
    };
  }
  return { state: 'ready', message: '', rooms: matches.slice(0, 3), startMinute, requiredEnd, targetBlock };
}

export function formatMinute(minute) {
  const normalized = Math.max(0, Math.min(24 * 60, Number(minute)));
  if (normalized === 24 * 60) return 'midnight';
  const hour = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 || 12;
  return `${display}:${pad(mins)} ${suffix}`;
}

export function formatTime(input) {
  return new Intl.DateTimeFormat('en-SG', { timeZone: SINGAPORE_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(input));
}

export function durationLabel(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export { DAY_MS, SINGAPORE_TZ };
