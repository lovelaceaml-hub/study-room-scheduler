import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = normalize(new URL('..', import.meta.url).pathname);
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = normalize(join(root, url.pathname === '/' ? 'tv.html' : url.pathname.replace(/^\/+/, '')));
    if (!file.startsWith(root)) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  const RealDate = Date;
  const fixedTime = '2026-07-20T12:00:00-07:00';
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return new RealDate(fixedTime).valueOf(); }
  }
  window.Date = FixedDate;
});
const blockedFirebaseRequests = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.url().includes('gstatic.com/firebasejs')) blockedFirebaseRequests.push(request.url());
});

try {
  await page.goto(`http://127.0.0.1:${port}/tv.html?tv=1&demo=1&test=1&date=not-a-date`, { waitUntil: 'networkidle' });
  assert.deepEqual(await page.evaluate(() => ({
    leadingInitial: window.__SRS_TV_TEST_HELPERS__.publicName('D Chloe Daniels'),
    titledName: window.__SRS_TV_TEST_HELPERS__.publicName('B. Anthony Lovelace')
  })), {
    leadingInitial: 'D Chloe',
    titledName: 'B Anthony'
  }, 'TV names preserve a bare leading initial while keeping titles private');
  assert.equal(await page.getByText('Choose day', { exact: true }).count(), 1);
  assert.ok(await page.locator('.day-choice').count() >= 2);
  assert.match(page.url(), /date=\d{4}-\d{2}-\d{2}/, 'Invalid date safely falls back to Today');
  assert.equal(blockedFirebaseRequests.length, 0, 'Demo view must not load Firebase');

  const futureChoice = page.locator('.day-choice').filter({ hasNotText: 'Today' }).first();
  await futureChoice.click();
  await page.locator('.board').waitFor();
  assert.equal(await page.locator('.current-time').count(), 0, 'Future dates do not show a current-time marker');
  assert.match(await page.locator('.time-ruler').innerText(), /11:00 PM/, 'The timeline runs through 11 PM');
  assert.equal(await page.locator('section[aria-label="Study room availability"]').count(), 1);
  assert.equal(await page.locator('.room-card').count(), 4, 'The display starts with one availability card per study room');
  assert.equal(await page.locator('section[aria-label="Study room timeline"]').count(), 1);
  assert.equal(await page.getByText('Selected day’s timeline', { exact: true }).count(), 1, 'A selected future day is not mislabeled as Today');
  assert.equal(await page.locator('.schedule-row').count(), 4, 'The supporting timeline has only four room rows');
  assert.equal(await page.locator('.pending-row, .booking.pending').count(), 0, 'Pending requests are never displayed on the lobby screen');
  assert.equal(await page.locator('section[aria-label="Whiteboards"], section[aria-label="TVs"]').count(), 0, 'Shared-equipment sections are removed from the TV display');
  assert.doesNotMatch(await page.locator('body').innerText(), /Whiteboard requests|TV requests|Requested — awaiting approval/, 'No request lane text remains');
  assert.equal(await page.locator('.booking[aria-label*="B Anthony"]').count(), 1, 'TV names keep title initials and omit surnames unless needed');
  assert.equal(await page.locator('text=Anthony Lovelace').count(), 0, 'TV never exposes a full name');
  assert.match(await page.locator('.room-card').first().innerText(), /First reservation|Open all day/, 'A selected future day uses a day summary instead of a false live status');
  assert.ok(await page.locator('.service-block').count() > 0, 'Service bands remain visible in the room timeline');
  assert.match(page.url(), /date=\d{4}-\d{2}-\d{2}/, 'Changing days creates a shareable link');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true, '720p board stays on one screen');

  await page.setViewportSize({ width: 1920, height: 1080 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.room-card').count(), 4, 'Narrow layouts keep all four room summaries');
  assert.equal(await page.evaluate(() => {
    const scroller = document.querySelector('.timeline-scroller');
    return Boolean(scroller && scroller.scrollWidth > scroller.clientWidth);
  }), true, 'Narrow layouts scroll the timetable instead of compressing time labels');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Only the timeline scrolls horizontally on narrow screens');
  const narrowTickGeometry = await page.evaluate(() => {
    const scroller = document.querySelector('.timeline-scroller').getBoundingClientRect();
    const visibleTicks = [...document.querySelectorAll('.tick')]
      .map(tick => ({ text: tick.textContent, ...tick.getBoundingClientRect().toJSON() }))
      .filter(rect => rect.left >= scroller.left && rect.right <= scroller.right)
      .sort((a, b) => a.left - b.left);
    return { visibleTicks, nonOverlapping: visibleTicks.every((rect, index) => index === 0 || visibleTicks[index - 1].right <= rect.left) };
  });
  assert.equal(narrowTickGeometry.nonOverlapping, true, `Every visible narrow-screen hour label has its own horizontal space: ${JSON.stringify(narrowTickGeometry.visibleTicks)}`);

  const publicScheduleUrl = 'https://us-west1-lvz-rooms.cloudfunctions.net/publicLobbySchedule';
  const liveContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const livePage = await liveContext.newPage();
  const liveFirebaseRequests = [];
  const liveScheduleRequests = [];
  const liveErrors = [];
  livePage.on('pageerror', error => liveErrors.push(error.message));
  livePage.on('request', request => {
    if (request.url().includes('gstatic.com/firebasejs')) liveFirebaseRequests.push(request.url());
  });
  await livePage.addInitScript(() => {
    const RealDate = Date;
    const fixedTime = '2026-07-20T12:00:00-07:00';
    class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedTime])); }
      static now() { return new RealDate(fixedTime).valueOf(); }
    }
    window.Date = FixedDate;
  });
  await livePage.addInitScript(() => {
    window.localStorage.setItem('srs-tv-cache-v2', JSON.stringify({ dates: {
      '2026-07-21': { updatedAt: 1761000000000, bookings: [{
        id: 'cached-room', date: '2026-07-21', start: '09:00', end: '10:00',
        name: 'Elder Cached Member', status: 'approved', needs: { room: true }, assignments: { room: 'room-1' }
      }] }
    } }));
  });
  await livePage.route(publicScheduleUrl, async route => {
    liveScheduleRequests.push(route.request().url());
    if (liveScheduleRequests.length === 1) {
      await route.fulfill({ status: 503, headers: { 'content-type': 'text/plain' }, body: 'Unavailable' });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        generatedAt: '2026-07-20T19:00:00.000Z',
        bookings: [
          { date: '2026-07-21', start: '10:00', end: '12:00', room: 'room-1', name: 'Brother Anthony Lovelace' },
          { date: '2026-07-21', start: '12:00', end: '13:00', room: 'room-2', name: 'Sister Kiana Davis', reservedFor: 'Private person' },
          { date: '2026-07-21', start: '13:00', end: '14:00', room: 'room-3', name: 'Sister Kiana Kim' }
        ]
      })
    });
  });
  try {
    await livePage.goto(`http://127.0.0.1:${port}/tv.html?tv=1&test=1&date=2026-07-21`, { waitUntil: 'networkidle' });
    assert.equal(liveScheduleRequests.length, 1, 'Live TV reads the public schedule endpoint');
    assert.match(await livePage.locator('body').innerText(), /E Cached/, 'A failed live request keeps the cached schedule visible');
    await livePage.evaluate(() => window.dispatchEvent(new Event('online')));
    await livePage.locator('.booking[aria-label*="B Anthony"]').waitFor();
    assert.equal(liveScheduleRequests.length, 2, 'The online event retries the public schedule request');
    assert.equal(liveFirebaseRequests.length, 0, 'Live TV does not load Firebase modules');
    assert.equal(await livePage.locator('.booking').count(), 3, 'Live TV renders only the server-provided room bookings');
    assert.equal(await livePage.locator('.booking[aria-label*="S Kiana D"]').count(), 1);
    assert.equal(await livePage.locator('.booking[aria-label*="S Kiana K"]').count(), 1);
    assert.equal(await livePage.getByText('Brother Anthony Lovelace').count(), 0, 'Live TV never renders a full name');
    assert.equal(await livePage.getByText('Private person').count(), 0, 'Private endpoint fields never reach the display');
    assert.deepEqual(liveErrors, []);
  } finally {
    await liveContext.close();
  }

  const checkRoomCardAt = async (fixedTime, roomIndex, expectedState, expectedNext) => {
    const scenarioContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'America/Los_Angeles' });
    const scenario = await scenarioContext.newPage();
    await scenario.addInitScript(time => {
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...args) { super(args.length ? args[0] : time); }
        static now() { return new RealDate(time).valueOf(); }
      }
      window.Date = FixedDate;
    }, fixedTime);
    try {
      await scenario.goto(`http://127.0.0.1:${port}/tv.html?tv=1&demo=1&date=2026-07-21`, { waitUntil: 'networkidle' });
      const text = await scenario.locator('.room-card').nth(roomIndex).innerText();
      assert.match(text, expectedState);
      assert.match(text, expectedNext, 'Availability state keeps the next approved booking visible');
    } finally {
      await scenarioContext.close();
    }
  };
  await checkRoomCardAt('2026-07-21T08:00:00-07:00', 0, /Available when rooms open/, /Next: B Anthony · 10:00 AM–12:00 PM/);
  // Tuesday's service moved to 7:30-8:30 PM on 12 September 2026.
  await checkRoomCardAt('2026-07-21T20:00:00-07:00', 2, /Service in progress/, /Next: Marcus · 10:00 PM–10:30 PM/);
  assert.deepEqual(errors, []);
  console.log('TV demo/date selector smoke checks passed');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
