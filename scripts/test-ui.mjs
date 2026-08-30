// Deterministic browser checks for the time-lens room finder.
// Start scripts/serve.mjs first, then run: node scripts/test-ui.mjs [baseUrl]

import { withBrowser, sleep } from './lib/cdp.mjs';

const BASE = process.argv[2] || 'http://localhost:4173';
let failures = 0;

function check(name, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  → ' + detail}`);
  if (!pass) failures++;
}

await withBrowser(async browser => {
  const { targetId, sessionId } = await browser.open(BASE + '/');
  await sleep(900);
  await browser.evaluate(`(async () => {
    const payload = await (await fetch('/sample/sim-timetable.sample.json')).json();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((out, part) => (out[part.type] = part.value, out), {});
    payload.schedule_dates = [parts.year + '-' + parts.month + '-' + parts.day];
    payload.scraped_at = new Date().toISOString();
    payload.rows.forEach(row => {
      if (/free access/i.test(row.event || '')) {
        row.start = '12:00 AM'; row.end = '12:00 AM'; row.start_min = 0; row.end_min = 1440;
      }
    });
    localStorage.setItem('sim-timetable-payload', JSON.stringify(payload));
    location.reload();
  })()`, sessionId);
  await sleep(1000);

  await browser.evaluate(`new Promise(resolve => {
    const started = Date.now();
    (function ready() {
      const app = document.getElementById('app');
      if (app && !app.hidden) return resolve(true);
      if (Date.now() - started > 6000) return resolve(false);
      setTimeout(ready, 100);
    })();
  })`, sessionId);

  const responsive = {};
  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700,
    }, sessionId);
    await sleep(120);
    responsive[viewport.name] = JSON.parse(await browser.evaluate(`(() => {
      const visible = node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length;
      };
      const targets = [...document.querySelectorAll('button, input, select, summary, .btn, .site-nav a')]
        .filter(visible).map(node => Math.round(node.getBoundingClientRect().height));
      const grid = document.querySelector('.availability-grid');
      return JSON.stringify({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        minTarget: targets.length ? Math.min(...targets) : 0,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        hasLens: !!document.querySelector('.time-lens'),
      });
    })()`, sessionId));
  }

  const themeResult = await browser.evaluate(`(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    return getComputedStyle(document.body).backgroundColor;
  })()`, sessionId);

  check('390px layout has no horizontal page overflow', responsive.mobile.overflow <= 0, String(responsive.mobile.overflow));
  check('768px layout has no horizontal page overflow', responsive.tablet.overflow <= 0, String(responsive.tablet.overflow));
  check('1440px layout has no horizontal page overflow', responsive.desktop.overflow <= 0, String(responsive.desktop.overflow));
  check('mobile controls meet the 44px touch target', responsive.mobile.minTarget >= 44, String(responsive.mobile.minTarget));
  check('mobile Free Access results use one column', responsive.mobile.gridColumns === 1, String(responsive.mobile.gridColumns));
  check('desktop Free Access results use two columns', responsive.desktop.gridColumns === 2, String(responsive.desktop.gridColumns));
  check('the time lens renders at every viewport', responsive.mobile.hasLens && responsive.tablet.hasLens && responsive.desktop.hasLens);
  check('dark theme applies the ink-green background token', themeResult === 'rgb(13, 19, 16)', themeResult);

  const result = JSON.parse(await browser.evaluate(`(() => {
    const clock = SIMTimetable.singaporeClock('2026-08-28T16:30:00.000Z');
    const rows = [
      { room: 'LT.A.1.01', block: 'A', floor: 1, start: '9:00 AM', end: '2:00 PM', start_min: 540, end_min: 840, event: 'Free Access', room_description: 'A.1.01 (60pax-CRS)' },
      { room: 'SR.B.2.01', block: 'B', floor: 2, start: '10:00 AM', end: '12:00 PM', start_min: 600, end_min: 720, event: 'SST Free Access', room_description: 'B.2.01 (20pax)' },
      { room: 'TR.A.2.07', block: 'A', floor: 2, start: '10:00 AM', end: '1:00 PM', start_min: 600, end_min: 780, event: 'Free Access', room_description: 'Tutor room' },
      { room: 'LT.C.3.01', block: 'C', floor: 3, start: '1:00 PM', end: '5:00 PM', start_min: 780, end_min: 1020, event: 'Free Access', room_description: 'C.3.01 (100pax)' },
      { room: 'LAB.C.3.07', block: 'C', floor: 3, start: '8:00 AM', end: '9:00 AM', start_min: 480, end_min: 540, event: 'Free Access', room_description: 'C.3.07 (30pax)' },
      { room: 'LAB.C.3.07', block: 'C', floor: 3, start: '2:00 PM', end: '10:00 PM', start_min: 840, end_min: 1320, event: 'Free Access', room_description: 'C.3.07 (30pax)' },
      { room: 'LT.A.1.01', block: 'A', floor: 1, start: '3:00 PM', end: '5:00 PM', start_min: 900, end_min: 1020, event: 'Lecture', room_description: 'A.1.01 (60pax-CRS)' }
    ];
    document.body.innerHTML = '<div id="fixture"></div>';
    const root = document.getElementById('fixture');
    const controller = SIMTimetable.mount(root, rows, {
      mode: 'now', now: '2026-08-29T03:00:00.000Z', scheduleCurrent: true,
      rooms: [{ room: 'LAB.X', block: 'A', floor: 1, activities: 0, description: 'Lab' }]
    });
    const atEleven = [...root.querySelectorAll('.availability-card.is-free h3')].map(n => n.textContent);
    const initialState = controller.getState();
    const lensBars = root.querySelectorAll('.lens-bars span').length;

    const group = root.querySelector('[data-f="group"]');
    group.value = '40'; group.dispatchEvent(new Event('change', { bubbles: true }));
    const groupRooms = [...root.querySelectorAll('.availability-card.is-free h3')].map(n => n.textContent);

    group.value = ''; group.dispatchEvent(new Event('change', { bubbles: true }));
    const duration = root.querySelector('[data-f="duration"]');
    duration.value = '120'; duration.dispatchEvent(new Event('change', { bubbles: true }));
    const durationRooms = [...root.querySelectorAll('.availability-card.is-free h3')].map(n => n.textContent);

    duration.value = '0'; duration.dispatchEvent(new Event('change', { bubbles: true }));
    controller.setQueryMinute(720);
    const boundaryRooms = [...root.querySelectorAll('.availability-card.is-free h3')].map(n => n.textContent);
    controller.setQueryMinute(840);
    const atTwo = [...root.querySelectorAll('.availability-card.is-free h3')].map(n => n.textContent);
    const expandedTimelines = root.querySelectorAll('.room-details').length;

    controller.setQueryMinute(660);
    group.value = '100'; group.dispatchEvent(new Event('change', { bubbles: true }));
    const hasNextAction = !!root.querySelector('[data-action="next"]');
    group.value = ''; group.dispatchEvent(new Event('change', { bubbles: true }));

    controller.setMode('today');
    const legacyMode = controller.getMode();
    controller.setMode('schedule');
    const scheduleRows = root.querySelectorAll('.schedule-table tbody tr').length;
    const mobileCards = root.querySelectorAll('.schedule-card').length;

    const staleRoot = document.createElement('div');
    document.body.appendChild(staleRoot);
    SIMTimetable.mount(staleRoot, rows, {
      mode: 'now', now: '2026-08-29T03:00:00.000Z', scheduleCurrent: false,
      initial: { queryMinute: 840 }
    });

    return JSON.stringify({
      singaporeDate: clock.date, singaporeMinutes: clock.minutes,
      atEleven, initialState, lensBars, groupRooms, durationRooms,
      boundaryRooms, atTwo, expandedTimelines, hasNextAction, legacyMode,
      scheduleRows, mobileCards,
      staleLabel: staleRoot.querySelector('[data-el="queryLabel"]').textContent,
      staleNowDisabled: staleRoot.querySelector('[data-el="nowBtn"]').disabled,
      staleCards: staleRoot.querySelectorAll('.availability-card.is-free').length
    });
  })()`, sessionId));

  check('Singapore date is independent of visitor timezone', result.singaporeDate === '2026-08-29', result.singaporeDate);
  check('Singapore minute calculation is correct', result.singaporeMinutes === 30, String(result.singaporeMinutes));
  check('the default query follows the exact current minute', result.initialState.queryMinute === 660 && result.initialState.queryTracksNow, JSON.stringify(result.initialState));
  check('Free Access results use longest availability first', result.atEleven.join(',') === 'LT.A.1.01,TR.A.2.07,SR.B.2.01', result.atEleven.join(', '));
  check('the lens exposes 30-minute availability bars', result.lensBars > 10, String(result.lensBars));
  check('group size excludes unknown and undersized rooms', result.groupRooms.length === 1 && result.groupRooms[0] === 'LT.A.1.01', result.groupRooms.join(', '));
  check('duration uses remaining time from the selected minute', result.durationRooms.length === 2 && !result.durationRooms.includes('SR.B.2.01'), result.durationRooms.join(', '));
  check('Free Access is start-inclusive and end-exclusive', !result.boundaryRooms.includes('SR.B.2.01'), result.boundaryRooms.join(', '));
  check('time selection finds later and multi-window rooms', result.atTwo.includes('LT.C.3.01') && result.atTwo.includes('LAB.C.3.07'), result.atTwo.join(', '));
  check('each result carries its expandable day schedule', result.expandedTimelines === result.atTwo.length, String(result.expandedTimelines));
  check('zero results offer a jump to the next matching time', result.hasNextAction);
  check('legacy Today mode maps to the Free Access finder', result.legacyMode === 'now', result.legacyMode);
  check('Full timetable renders desktop and mobile representations', result.scheduleRows === 7 && result.mobileCards === 7, `${result.scheduleRows}/${result.mobileCards}`);
  check('stale data is labelled Reference and disables Now', result.staleLabel === 'Reference' && result.staleNowDisabled && result.staleCards > 0, `${result.staleLabel}/${result.staleCards}`);

  await browser.close(targetId);
}, { port: 9456 });

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
