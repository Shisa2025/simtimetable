// Browser checks for the local-first Today/Week workspace.
// Start scripts/serve.mjs first, then run: node scripts/test-assistant-ui.mjs [baseUrl]

import { withBrowser, sleep } from './lib/cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:4173';
let failures = 0;

function check(name, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  -> ' + detail}`);
  if (!pass) failures += 1;
}

await withBrowser(async (browser) => {
  const { targetId, sessionId } = await browser.open(BASE + '/');
  await sleep(900);

  const empty = JSON.parse(await browser.evaluate(`JSON.stringify({
    title: document.title,
    onboarding: document.querySelector('.assistant-focus h2')?.textContent,
    ads: document.querySelectorAll('script[src*="adsbygoogle"]').length,
    path: location.pathname
  })`, sessionId));
  check('root opens the Today workspace', empty.path === '/' && /SIM Campus Assistant/.test(empty.title), `${empty.path} / ${empty.title}`);
  check('empty state offers timetable setup', empty.onboarding === 'Add your class timetable', empty.onboarding);
  check('Today/Week does not load AdSense', empty.ads === 0, String(empty.ads));

  await browser.evaluate(`(() => {
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).reduce((out, part) => (out[part.type] = part.value, out), {});
    const dateKey = date.year + '-' + date.month + '-' + date.day;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).reduce((out, part) => (out[part.type] = part.value, out), {});
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const currentStart = new Date(now.getTime() - 30 * 60000).toISOString();
    const currentEnd = new Date(now.getTime() + 30 * 60000).toISOString();
    const nextStart = new Date(now.getTime() + 180 * 60000).toISOString();
    const nextEnd = new Date(now.getTime() + 240 * 60000).toISOString();
    localStorage.setItem('sim-campus-assistant-profile-v1', JSON.stringify({
      version: 1, importedAt: now.toISOString(), icsName: 'test.ics',
      importedClasses: [
        { id: 'current', seriesId: 'a', title: 'Current Seminar', startIso: currentStart, endIso: currentEnd, location: 'SR.B.3.02', room: 'SR.B.3.02', block: 'B', floor: 3, source: 'ics' },
        { id: 'next', seriesId: 'b', title: 'Next Lecture', startIso: nextStart, endIso: nextEnd, location: 'LT.A.1.10', room: 'LT.A.1.10', block: 'A', floor: 1, source: 'ics' }
      ],
      manualClasses: [], preferences: { travelBufferMinutes: 15, groupSize: 10 }
    }));
    localStorage.setItem('sim-timetable-payload', JSON.stringify({
      version: 2, scraped_at: new Date(now.getTime() + 86400000).toISOString(), schedule_dates: [dateKey],
      rooms: [
        { room: 'SR.A.2.01', block: 'A', floor: 2, description: 'A.2.01 (20pax)' },
        { room: 'SR.B.3.02', block: 'B', floor: 3, description: 'B.3.02 (40pax)' }
      ],
      rows: [
        { room: 'SR.A.2.01', block: 'A', floor: 2, room_description: 'A.2.01 (20pax)', start_min: 0, end_min: 1440, event: 'Free Access' },
        { room: 'SR.B.3.02', block: 'B', floor: 3, room_description: 'B.3.02 (40pax)', start_min: 0, end_min: 1440, event: 'Free Access' }
      ]
    }));
    location.reload();
  })()`, sessionId);
  await sleep(1200);

  const populated = JSON.parse(await browser.evaluate(`JSON.stringify({
    focus: document.querySelector('.assistant-focus h2')?.textContent,
    agenda: document.querySelectorAll('.agenda-item').length,
    suggestions: [...document.querySelectorAll('.suggestion-room strong')].map(node => node.textContent),
    status: document.querySelector('.focus-status')?.textContent,
    error: document.body.innerText.includes('ReferenceError')
  })`, sessionId));
  check('current class leads the Today card', populated.focus === 'Current Seminar' && /In class now/.test(populated.status), `${populated.focus} / ${populated.status}`);
  check('Today agenda renders personal classes', populated.agenda === 2, String(populated.agenda));
  check('same-block Free Access room ranks first', populated.suggestions[0] === 'SR.A.2.01', populated.suggestions.join(', '));
  check('assistant page has no visible runtime error', !populated.error);

  if (process.env.CAPTURE_DIR) {
    mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
    for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 360, height: 780 }]) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700
      }, sessionId);
      await sleep(120);
      const capture = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      writeFileSync(join(process.env.CAPTURE_DIR, `assistant-${viewport.name}.png`), Buffer.from(capture.data, 'base64'));
    }
  }

  await browser.evaluate(`location.hash = 'week'`, sessionId);
  await sleep(250);
  const week = JSON.parse(await browser.evaluate(`JSON.stringify({
    visible: !document.getElementById('weekView').hidden,
    days: document.querySelectorAll('.week-day').length,
    events: document.querySelectorAll('.week-event').length,
    current: document.querySelectorAll('.week-day.is-today').length
  })`, sessionId));
  check('Week contains all seven days including weekends', week.visible && week.days === 7, `${week.visible}/${week.days}`);
  check('Week marks today and renders classes', week.current === 1 && week.events === 2, `${week.current}/${week.events}`);

  const responsive = {};
  for (const viewport of [{ name: 'mobile', width: 360, height: 780 }, { name: 'desktop', width: 1440, height: 900 }]) {
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700
    }, sessionId);
    await sleep(120);
    responsive[viewport.name] = JSON.parse(await browser.evaluate(`JSON.stringify({
      overflow: document.documentElement.scrollWidth - innerWidth,
      columns: getComputedStyle(document.querySelector('.week-grid')).gridTemplateColumns.split(' ').length,
      minText: parseFloat(getComputedStyle(document.querySelector('.assistant-focus')).fontSize)
    })`, sessionId));
  }
  check('360px assistant layout has no horizontal page overflow', responsive.mobile.overflow <= 0, String(responsive.mobile.overflow));
  check('mobile Week becomes a one-column agenda', responsive.mobile.columns === 1, String(responsive.mobile.columns));
  check('desktop Week presents seven columns', responsive.desktop.columns === 7, String(responsive.desktop.columns));
  check('assistant body text remains at least 16px', responsive.mobile.minText >= 16, String(responsive.mobile.minText));

  const dialog = JSON.parse(await browser.evaluate(`(() => {
    location.hash = 'today';
    document.querySelector('[data-open-setup]').click();
    return JSON.stringify({ open: document.getElementById('setupDialog').open, tabs: document.querySelectorAll('[data-setup-tab]').length });
  })()`, sessionId));
  check('timetable setup opens as an accessible dialog', dialog.open && dialog.tabs === 3, `${dialog.open}/${dialog.tabs}`);

  const manual = JSON.parse(await browser.evaluate(`(() => {
    document.querySelector('[data-setup-tab="manual"]').click();
    const form = document.getElementById('manualClassForm');
    form.elements.title.value = 'Manual Tutorial';
    form.elements.startTime.value = '18:00';
    form.elements.endTime.value = '19:00';
    form.requestSubmit();
    const saved = JSON.parse(localStorage.getItem('sim-campus-assistant-profile-v1'));
    return JSON.stringify({ count: saved.manualClasses.length, title: saved.manualClasses[0]?.title, message: document.getElementById('assistantMessage').textContent });
  })()`, sessionId));
  check('manual repeating class saves to the local profile', manual.count === 1 && manual.title === 'Manual Tutorial', `${manual.count}/${manual.title}`);
  check('manual save reports success', /added/.test(manual.message), manual.message);

  await browser.close(targetId);

  const legacy = await browser.open(BASE + '/#free-access');
  await sleep(900);
  const legacyLocation = JSON.parse(await browser.evaluate(`JSON.stringify({ path: location.pathname, hash: location.hash })`, legacy.sessionId));
  check('legacy root hash redirects to the room finder', legacyLocation.path === '/rooms' && legacyLocation.hash === '#free-access', `${legacyLocation.path}${legacyLocation.hash}`);
  await browser.close(legacy.targetId);

  const roomsPage = await browser.open(BASE + '/rooms#free-access');
  await sleep(800);
  const publicPage = JSON.parse(await browser.evaluate(`JSON.stringify({
    ads: document.querySelectorAll('script[src*="adsbygoogle"]').length,
    app: !!document.getElementById('timetable'),
    brand: document.querySelector('.brand-copy strong')?.textContent
  })`, roomsPage.sessionId));
  check('public room finder retains AdSense', publicPage.ads === 1, String(publicPage.ads));
  check('public room finder keeps the existing app surface', publicPage.app && publicPage.brand === 'SIM Campus Assistant', `${publicPage.app}/${publicPage.brand}`);
  await browser.close(roomsPage.targetId);
}, { port: 9457 });

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
