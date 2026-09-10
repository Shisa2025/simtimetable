import assert from 'node:assert/strict';
import {
  dateBounds,
  defaultProfile,
  manualOccurrences,
  occurrencesForRange,
  parseIcs,
  recommendRooms,
  sanitizeProfile,
  singaporeDateKey,
  todayModel,
  weekBounds
} from '../assets/assistant-data.js';

const rooms = [
  { room: 'LT.A.1.10', block: 'A', floor: 1, description: 'A.1.10 (100pax)' },
  { room: 'SR.A.2.01', block: 'A', floor: 2, description: 'A.2.01 (20pax)' },
  { room: 'SR.B.3.02', block: 'B', floor: 3, description: 'B.3.02 (40pax)' }
];

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:weekly-class',
  'DTSTART;TZID=Asia/Singapore:20260910T090000',
  'DTEND;TZID=Asia/Singapore:20260910T100000',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'RDATE;TZID=Asia/Singapore:20261015T090000',
  'EXDATE;TZID=Asia/Singapore:20260917T090000',
  'SUMMARY:Long module title that is folded',
  ' across lines',
  'LOCATION:LT.A.1.10',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc-class',
  'DTSTART:20260912T010000Z',
  'DTEND:20260912T023000Z',
  'SUMMARY:Saturday Lab',
  'LOCATION:SR.B.3.02',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:all-day',
  'DTSTART;VALUE=DATE:20260913',
  'SUMMARY:Assignment due',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled',
  'STATUS:CANCELLED',
  'DTSTART;TZID=Asia/Singapore:20260914T090000',
  'DTEND;TZID=Asia/Singapore:20260914T100000',
  'SUMMARY:Cancelled Class',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:unsupported',
  'DTSTART;TZID=Mars/Olympus:20260915T090000',
  'DTEND;TZID=Mars/Olympus:20260915T100000',
  'SUMMARY:Wrong timezone',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const parsed = parseIcs(ics, {
  rooms,
  rangeStart: new Date('2026-09-01T00:00:00Z'),
  rangeEnd: new Date('2026-11-01T00:00:00Z')
});
assert.equal(parsed.series.length, 2, 'only timed, active, supported series are returned');
const weekly = parsed.series.find((item) => item.uid === 'weekly-class');
assert.equal(weekly.title, 'Long module title that is foldedacross lines');
assert.equal(weekly.room, 'LT.A.1.10');
assert.equal(weekly.occurrences.length, 4, 'RRULE + RDATE - EXDATE');
assert.equal(weekly.occurrences[0].startIso, '2026-09-10T01:00:00.000Z');
assert.ok(parsed.warnings.some((warning) => warning.includes('Mars/Olympus')));

const saturday = parsed.series.find((item) => item.uid === 'utc-class').occurrences[0];
assert.equal(saturday.startIso, '2026-09-12T01:00:00.000Z');

const manual = {
  id: 'manual-weekend', title: 'Weekend Seminar',
  validFrom: '2026-09-01', validUntil: '2026-09-30',
  startTime: '10:00', endTime: '12:00', days: [0, 6],
  room: 'SR.A.2.01', block: 'A', floor: 2
};
const manualItems = manualOccurrences(manual, new Date('2026-09-07T16:00:00Z'), new Date('2026-09-14T16:00:00Z'));
assert.equal(manualItems.length, 2, 'Saturday and Sunday both render');
assert.deepEqual(manualItems.map((item) => singaporeDateKey(new Date(item.startIso))), ['2026-09-12', '2026-09-13']);

const profile = sanitizeProfile({
  ...defaultProfile(),
  importedAt: '2026-09-01T00:00:00Z',
  importedClasses: parsed.series.flatMap((item) => item.occurrences),
  manualClasses: [manual],
  preferences: { travelBufferMinutes: 15, groupSize: 10 }
});
assert.equal(profile.version, 1);
assert.equal(profile.manualClasses[0].floor, 2);
assert.equal(sanitizeProfile(defaultProfile()).importedAt, null);

const bounds = weekBounds(new Date('2026-09-10T01:30:00Z'));
assert.equal(singaporeDateKey(bounds.start), '2026-09-07');
assert.equal(occurrencesForRange(profile, bounds.start, bounds.end).length, 4);

const now = new Date('2026-09-10T01:30:00Z');
const currentClass = {
  id: 'current', seriesId: 'current-series', title: 'Current Class',
  startIso: '2026-09-10T00:30:00.000Z', endIso: '2026-09-10T02:00:00.000Z',
  location: 'SR.B.3.02', room: 'SR.B.3.02', block: 'B', floor: 3, source: 'ics'
};
const nextClass = {
  id: 'next', seriesId: 'next-series', title: 'Next Class',
  startIso: '2026-09-10T04:00:00.000Z', endIso: '2026-09-10T05:00:00.000Z',
  location: 'LT.A.1.10', room: 'LT.A.1.10', block: 'A', floor: 1, source: 'ics'
};
const dayProfile = { ...defaultProfile(), importedClasses: [currentClass, nextClass], preferences: { travelBufferMinutes: 15, groupSize: 10 } };
const model = todayModel(dayProfile, now);
assert.equal(model.current.id, 'current');
assert.equal(model.next.id, 'next');

const payload = {
  schedule_dates: ['2026-09-10'], rooms,
  rows: [
    { room: 'SR.A.2.01', block: 'A', floor: 2, room_description: 'A.2.01 (20pax)', start_min: 600, end_min: 720, event: 'Free Access' },
    { room: 'SR.B.3.02', block: 'B', floor: 3, room_description: 'B.3.02 (40pax)', start_min: 600, end_min: 800, event: 'Free Access' },
    { room: 'LT.A.1.10', block: 'A', floor: 1, room_description: 'A.1.10 (100pax)', start_min: 600, end_min: 780, event: 'Lecture' }
  ]
};
const recommendations = recommendRooms(payload, model, dayProfile.preferences, now);
assert.equal(recommendations.state, 'ready');
assert.equal(recommendations.requiredEnd, 705);
assert.equal(recommendations.rooms[0].room, 'SR.A.2.01', 'same block as next class ranks first');
assert.ok(!recommendations.rooms.some((room) => room.room === 'LT.A.1.10'), 'busy and unknown gaps never qualify');

const stale = recommendRooms({ ...payload, schedule_dates: ['2026-09-09'] }, model, dayProfile.preferences, now);
assert.equal(stale.state, 'stale');

const tightModel = { ...model, current: null, next: { ...nextClass, startIso: '2026-09-10T01:40:00.000Z' } };
assert.equal(recommendRooms(payload, tightModel, dayProfile.preferences, now).state, 'leave');

assert.equal(dateBounds('2026-09-10').start.toISOString(), '2026-09-09T16:00:00.000Z');
console.log('PASS assistant data, ICS, week, and room recommendation checks');
