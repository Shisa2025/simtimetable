// Deterministic browser checks for the student room finder.
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
  check('mobile availability results use one column', responsive.mobile.gridColumns === 1, String(responsive.mobile.gridColumns));
  check('desktop availability results use two columns', responsive.desktop.gridColumns === 2, String(responsive.desktop.gridColumns));
  check('dark theme applies the planned background token', themeResult === 'rgb(15, 23, 42)', themeResult);

  const result = JSON.parse(await browser.evaluate(`(() => {
    const clock = SIMTimetable.singaporeClock('2026-08-28T16:30:00.000Z');
    const rows = [
      { room: 'LT.A.1.01', block: 'A', floor: 1, start: '9:00 AM', end: '2:00 PM', start_min: 540, end_min: 840, event: 'Free Access', room_description: 'A.1.01 (60pax-CRS)' },
      { room: 'SR.B.2.01', block: 'B', floor: 2, start: '10:00 AM', end: '12:00 PM', start_min: 600, end_min: 720, event: 'SST Free Access', room_description: 'B.2.01 (20pax)' },
      { room: 'TR.A.2.07', block: 'A', floor: 2, start: '10:00 AM', end: '1:00 PM', start_min: 600, end_min: 780, event: 'Free Access', room_description: 'Tutor room' },
      { room: 'LT.C.3.01', block: 'C', floor: 3, start: '1:00 PM', end: '5:00 PM', start_min: 780, end_min: 1020, event: 'Free Access', room_description: 'C.3.01 (100pax)' },
      { room: 'LT.A.1.01', block: 'A', floor: 1, start: '3:00 PM', end: '5:00 PM', start_min: 900, end_min: 1020, event: 'Lecture', room_description: 'A.1.01 (60pax-CRS)' }
    ];
    document.body.innerHTML = '<div id="fixture"></div>';
    const root = document.getElementById('fixture');
    const controller = SIMTimetable.mount(root, rows, {
      mode: 'now', now: '2026-08-29T03:00:00.000Z', scheduleCurrent: true,
      rooms: [{ room: 'LAB.X', block: 'A', floor: 1, activities: 0, description: 'Lab' }]
    });
    const initialCards = [...root.querySelectorAll('.availability-card.is-open h3')].map(n => n.textContent);
    const initialLater = [...root.querySelectorAll('.availability-card.is-later h3')].map(n => n.textContent);
    const capacity = SIMTimetable.normalize(rows)[0].capacity;

    const group = root.querySelector('[data-f="group"]');
    group.value = '40'; group.dispatchEvent(new Event('change', { bubbles: true }));
    const groupOpen = [...root.querySelectorAll('.availability-card.is-open h3')].map(n => n.textContent);
    const groupLater = [...root.querySelectorAll('.availability-card.is-later h3')].map(n => n.textContent);

    group.value = ''; group.dispatchEvent(new Event('change', { bubbles: true }));
    const duration = root.querySelector('[data-f="duration"]');
    duration.value = '120'; duration.dispatchEvent(new Event('change', { bubbles: true }));
    const durationOpen = [...root.querySelectorAll('.availability-card.is-open h3')].map(n => n.textContent);

    const boundaryRoot = document.createElement('div');
    document.body.appendChild(boundaryRoot);
    SIMTimetable.mount(boundaryRoot, rows, {
      mode: 'now', now: '2026-08-29T04:00:00.000Z', scheduleCurrent: true
    });
    const boundaryOpen = [...boundaryRoot.querySelectorAll('.availability-card.is-open h3')].map(n => n.textContent);

    controller.setMode('today');
    const todayRooms = root.querySelectorAll('.timeline-card').length;
    const unknownLabels = root.querySelectorAll('.status-unknown').length;
    controller.setMode('schedule');
    const scheduleRows = root.querySelectorAll('.schedule-table tbody tr').length;
    const mobileCards = root.querySelectorAll('.schedule-card').length;

    return JSON.stringify({
      singaporeDate: clock.date, singaporeMinutes: clock.minutes, capacity,
      initialCards, initialLater, groupOpen, groupLater, durationOpen,
      boundaryOpen, todayRooms, unknownLabels, scheduleRows, mobileCards,
      mode: controller.getMode(), hasFocusStyles: true
    });
  })()`, sessionId));

  check('Singapore date is independent of visitor timezone', result.singaporeDate === '2026-08-29', result.singaporeDate);
  check('Singapore minute calculation is correct', result.singaporeMinutes === 30, String(result.singaporeMinutes));
  check('capacity is derived from room description', result.capacity === 60, String(result.capacity));
  check('Open now uses the start-inclusive/end-exclusive window', result.initialCards.length === 3, result.initialCards.join(', '));
  check('Open now sorts the longest remaining window first', result.initialCards[0] === 'LT.A.1.01', result.initialCards.join(', '));
  check('later rooms are shown alongside current rooms', result.initialLater.length === 1 && result.initialLater[0] === 'LT.C.3.01', result.initialLater.join(', '));
  check('group-size filter excludes unknown and undersized rooms', result.groupOpen.length === 1 && result.groupOpen[0] === 'LT.A.1.01', result.groupOpen.join(', '));
  check('group-size filter applies to later rooms', result.groupLater.length === 1 && result.groupLater[0] === 'LT.C.3.01', result.groupLater.join(', '));
  check('duration filter uses remaining time for current rooms', result.durationOpen.length === 2 && !result.durationOpen.includes('SR.B.2.01'), result.durationOpen.join(', '));
  check('a Free Access window is closed at its exact end time', !result.boundaryOpen.includes('SR.B.2.01'), result.boundaryOpen.join(', '));
  check('Today view lists every confirmed Free Access room', result.todayRooms === 4, String(result.todayRooms));
  check('Today view labels unallocated gaps as unknown', result.unknownLabels > 0, String(result.unknownLabels));
  check('Full schedule renders desktop and mobile representations', result.scheduleRows === 5 && result.mobileCards === 5, `${result.scheduleRows}/${result.mobileCards}`);
  check('public controller supports the schedule mode', result.mode === 'schedule', result.mode);

  await browser.close(targetId);
}, { port: 9456 });

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
