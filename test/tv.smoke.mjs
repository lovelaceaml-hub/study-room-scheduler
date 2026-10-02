// Lobby TV in a real browser, with the public schedule answered locally as
// the server would answer at the page's own time. Pages run on the fixed
// test clock (Saturday, Oct 3, 2026, 9:00 AM in Los Angeles) unless a test
// sets another. Every name is fictional.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { start, newPage, fitsWidth, TEST_NOW } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const { lobbyDates, dayInfo } = require('../functions/lib/schedule.js');
const { clientConfig } = require('../functions/lib/views.js');

const CONFIG = {
  windowDays: 4, hold: 'blocked', nameMax: 120, noteMax: 1000, holdReasonMax: 240, keepDays: 56, sessionMinutes: 20, maxActivePerDay: 4,
  ...clientConfig()
};
const SATURDAY = '2026-10-03';
const MINUTE = 60 * 1000;
const CACHE_KEY = 'srs-tv-schedule';
const BOOKINGS = [
  { date: SATURDAY, start: '11:00', end: '12:30', room: 'room-1', name: 'B John' },
  { date: SATURDAY, start: '12:00', end: '13:00', room: 'room-3', name: 'Reserved' }
];
const payloadAt = (now, bookings = BOOKINGS) => ({
  version: 1, generatedAt: now.toISOString(), config: CONFIG, days: lobbyDates(now).map(dayInfo), bookings
});
const churchTime = time => new Date(`2026-10-03T${time}:00-07:00`);

let harness;
before(async () => { harness = await start(); });
after(async () => harness?.stop());

// `state.online` false refuses the request; `state.hang` never answers it.
async function openTv({ now = TEST_NOW, width = 1920, height = 1080, query = '', bookings = BOOKINGS, timezoneId, cached = null, online = true } = {}) {
  const session = await newPage(harness.browser, { width, height, now, timezoneId });
  const state = { online, hang: false, requests: 0 };
  await session.context.route('**/publicLobbySchedule', async route => {
    state.requests += 1;
    if (state.hang) return;
    if (!state.online) return route.abort();
    const pageNow = await session.page.evaluate(() => Date.now()).catch(() => Date.now());
    return route.fulfill({ json: payloadAt(new Date(pageNow), bookings) });
  });
  if (cached) {
    await session.page.goto(`${harness.base}/icon.svg`);
    await session.page.evaluate(([key, value]) => localStorage.setItem(key, value), [CACHE_KEY, JSON.stringify(cached)]);
  }
  await session.page.goto(`${harness.base}/tv.html${query}`);
  return { ...session, state };
}

const label = page => page.locator('#connection-label');
const roomText = (page, index) => page.locator('.tv-room').nth(index).innerText().then(text => text.replace(/\s*\n+\s*/g, ' | '));
const pressed = page => page.locator('.tv-day-button[aria-pressed="true"]').innerText().then(text => text.trim());
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));

test('the TV shows each room and the day\'s reservations', async () => {
  const { page, errors, context } = await openTv();
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.deepEqual(await page.locator('.tv-room h2').allTextContents(), ['Room 1', 'Room 2', 'Room 3', 'Room 4']);
  assert.equal(await roomText(page, 0), 'Room 1 | Opens at 11:00 AM | Next: B John, 11:00 AM to 12:30 PM');
  assert.equal(await page.locator('.tv-booking', { hasText: 'B John' }).count(), 1);
  assert.equal(await page.locator('.tv-service').count() > 0, true);
  assert.equal(await pressed(page), 'Today');
  assert.equal(await page.locator('#day-label').textContent(), 'Saturday, October 3, 2026');
  assert.equal(await page.locator('#updated').textContent(), 'Updated 9:00 AM');
  assert.equal(await fitsWidth(page), true);
  const axe = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(axe.violations.map(violation => violation.id), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a day with no room schedule says so', async () => {
  const { page, errors, context } = await openTv({ now: new Date('2026-10-04T12:00:00-07:00') });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  await page.getByRole('heading', { name: 'No room schedule today' }).waitFor();
  await page.getByText(/^Rooms can be reserved on Tuesday/).waitFor();
  assert.equal(await pressed(page), 'Today');
  assert.deepEqual(errors, []);
  await context.close();
});

test('when the connection drops, the last schedule stays up and says so after 3 minutes', async () => {
  const { page, errors, context, state } = await openTv();
  await label(page).filter({ hasText: 'Live' }).waitFor();
  state.online = false;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.tv-booking')?.textContent.includes('B John'));
  await page.clock.fastForward(2 * MINUTE);
  await settle(page);
  assert.equal(await label(page).textContent(), 'Live', 'a short outage does not alarm anyone');
  await page.clock.fastForward(1 * MINUTE + 5000);
  await label(page).filter({ hasText: 'Reconnecting' }).waitFor();
  assert.equal(await page.locator('#updated').textContent(), 'Updated 9:00 AM');
  assert.equal(await page.locator('.tv-booking', { hasText: 'B John' }).count(), 1);
  state.online = true;
  await page.clock.fastForward(MINUTE);
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('a request that never answers is given up after 20 seconds', async () => {
  const { page, errors, context, state } = await openTv();
  await label(page).filter({ hasText: 'Live' }).waitFor();
  state.hang = true;
  const before = state.requests;
  for (let step = 0; step < 4; step += 1) {
    await page.clock.runFor(MINUTE);
    await settle(page);
  }
  assert.ok(state.requests >= before + 3, `requests kept going (${state.requests - before})`);
  await label(page).filter({ hasText: 'Reconnecting' }).waitFor();
  state.hang = false;
  await page.clock.runFor(MINUTE);
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('an old copy without today is not shown as today\'s schedule', async () => {
  const then = new Date('2026-09-29T15:42:00-07:00');
  const cached = { ...payloadAt(then, [{ date: '2026-09-29', start: '17:00', end: '18:00', room: 'room-1', name: 'B John' }]), savedAt: then.getTime() };
  const { page, errors, context, state } = await openTv({ now: new Date('2026-10-02T09:15:00-07:00'), cached, online: false });
  await page.getByRole('heading', { name: 'No current schedule' }).waitFor();
  await page.getByText('Not connected since Tue, Sep 29, 3:42 PM.').waitFor();
  assert.equal(await page.locator('#updated').textContent(), 'Updated Tue, Sep 29, 3:42 PM');
  assert.equal(await label(page).textContent(), 'Reconnecting');
  assert.equal(await page.locator('#day-label').textContent(), 'Friday, October 2, 2026');
  assert.equal(await page.locator('.tv-day-button').count(), 0);
  assert.equal(await page.locator('.tv-booking').count(), 0);
  state.online = true;
  await page.clock.fastForward(MINUTE);
  await label(page).filter({ hasText: 'Live' }).waitFor();
  await page.getByRole('heading', { name: 'No room schedule today' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('at midnight the TV moves on to the new day', async () => {
  const { page, errors, context } = await openTv({ now: new Date('2026-10-03T23:58:30-07:00') });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await page.locator('#day-label').textContent(), 'Saturday, October 3, 2026');
  for (let step = 0; step < 4; step += 1) {
    await page.clock.runFor(30000);
    await settle(page);
  }
  await page.getByRole('heading', { name: 'No room schedule today' }).waitFor();
  assert.equal(await page.locator('#day-label').textContent(), 'Sunday, October 4, 2026');
  assert.equal(await pressed(page), 'Today');
  assert.equal(await page.locator('.tv-day-button', { hasText: 'Sat, Oct 3' }).count(), 0, 'yesterday is gone');
  assert.equal(await label(page).textContent(), 'Live');
  assert.deepEqual(errors, []);
  await context.close();
});

test('room cards count services: 9:30 AM opens at 11, 12:10 PM is free until 2:30', async () => {
  const one = [{ date: SATURDAY, start: '11:00', end: '12:00', room: 'room-1', name: 'B John' }];
  const early = await openTv({ now: churchTime('09:30'), bookings: [] });
  await label(early.page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await roomText(early.page, 1), 'Room 2 | Opens at 11:00 AM');
  await early.context.close();

  const noon = await openTv({ now: churchTime('12:10'), bookings: one });
  await label(noon.page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await roomText(noon.page, 1), 'Room 2 | Free until 2:30 PM | Afternoon service at 2:30 PM');
  assert.equal(await noon.page.locator('.tv-room.free').count(), 4);
  await noon.context.close();

  const { page, errors, context } = await openTv({ now: churchTime('11:30'), bookings: one });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await roomText(page, 0), 'Room 1 | In use | B John until 12:00 PM');
  assert.equal(await page.locator('.tv-room.busy').count(), 1);
  assert.deepEqual([...early.errors, ...noon.errors, ...errors], []);
  await context.close();
});

test('a full day fits 1280x720: no clipped times, names stay inside', async () => {
  const names = ['B Johnathan', 'S Grace', 'D Min-jun', 'S Seo-yeon L', 'Reserved', 'B Maximiliano-Alessandro'];
  const bookings = [];
  let index = 0;
  for (const room of ['room-1', 'room-2', 'room-3', 'room-4']) {
    for (const [from, to] of [['11:00', '11:30'], ['11:30', '12:30'], ['12:30', '13:00'], ['13:00', '14:30'], ['15:30', '16:00'], ['16:00', '16:30'], ['16:30', '18:00'], ['18:00', '18:30'], ['20:30', '21:00'], ['21:00', '23:00']]) {
      bookings.push({ date: SATURDAY, start: from, end: to, room, name: names[index++ % names.length] });
    }
  }
  bookings[2].name = 'Christopherjonathanalexanderwilliamsonfictional';
  for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    const { page, errors, context } = await openTv({ now: churchTime('13:47'), width, height, bookings });
    await label(page).filter({ hasText: 'Live' }).waitFor();
    const report = await page.evaluate(() => {
      const inside = (child, parent) => {
        const a = child.getBoundingClientRect();
        const b = parent.getBoundingClientRect();
        return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
      };
      const blocks = [...document.querySelectorAll('.tv-booking')];
      const track = document.querySelector('.tv-ruler .tv-track').getBoundingClientRect();
      const last = document.querySelector('.tv-tick.last').getBoundingClientRect();
      const timeline = document.querySelector('.tv-timeline');
      return {
        page: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
        timelineScrolls: timeline.scrollWidth > timeline.clientWidth,
        lastTickInside: last.right <= track.right + 1,
        clippedTimes: blocks.map(block => block.querySelector('small')).filter(small => small && small.scrollWidth > small.clientWidth + 1).map(small => small.textContent),
        shortWithTime: blocks.filter(block => block.classList.contains('short') && block.querySelector('small')).length,
        namesOutside: blocks.filter(block => !inside(block.querySelector('b'), block)).length,
        cardsOverflow: [...document.querySelectorAll('.tv-room')].filter(card => card.scrollWidth > card.clientWidth + 1 || [...card.children].some(child => !inside(child, card))).length,
        font: parseFloat(getComputedStyle(document.body).fontSize)
      };
    });
    assert.deepEqual(report, {
      page: true, timelineScrolls: false, lastTickInside: true, clippedTimes: [], shortWithTime: 0, namesOutside: 0, cardsOverflow: 0, font: report.font
    }, `${width}x${height}`);
    assert.ok(report.font >= 16, `${width}x${height} text is at least 16 px`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a tapped day goes back to Today two minutes after the last tap', async () => {
  const { page, errors, context } = await openTv({ now: churchTime('12:10') });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  await page.getByRole('button', { name: 'Tue, Oct 6' }).click();
  assert.equal(await pressed(page), 'Tue, Oct 6');
  assert.equal(new URL(page.url()).search, '', 'the address does not change');
  await page.clock.runFor(MINUTE);
  await page.getByRole('button', { name: 'Tue, Oct 6' }).click();
  await page.clock.runFor(MINUTE + 50000);
  await settle(page);
  assert.equal(await pressed(page), 'Tue, Oct 6', 'the second tap starts the two minutes again');
  await page.clock.runFor(15000);
  await page.locator('.tv-day-button[aria-pressed="true"]', { hasText: 'Today' }).waitFor();
  await context.close();

  const linked = await openTv({ now: churchTime('12:10'), query: '?date=2026-10-06' });
  await label(linked.page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await pressed(linked.page), 'Tue, Oct 6', 'a day in the address still opens');
  assert.deepEqual([...errors, ...linked.errors], []);
  await linked.context.close();
});

test('the TV registers the service worker so it opens offline', async () => {
  const context = await harness.browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'allow', timezoneId: 'America/Los_Angeles' });
  await context.route('**/publicLobbySchedule', route => route.fulfill({ json: payloadAt(new Date()) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${harness.base}/tv.html`);
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration('/')));
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')).scope), `${harness.base}/`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('online events never stack up extra refreshes', async () => {
  const { page, errors, context, state } = await openTv({ now: churchTime('12:00') });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  for (let event = 0; event < 10; event += 1) await page.evaluate(() => dispatchEvent(new Event('online')));
  state.online = false;
  for (let step = 0; step < 10; step += 1) {
    await page.clock.runFor(30000);
    await settle(page);
  }
  state.online = true;
  for (let step = 0; step < 3; step += 1) {
    await page.clock.runFor(MINUTE);
    await settle(page);
  }
  const before = state.requests;
  for (let step = 0; step < 20; step += 1) {
    await page.clock.runFor(MINUTE);
    await settle(page);
  }
  const made = state.requests - before;
  assert.ok(made >= 19 && made <= 21, `about one request a minute (${made} in 20 minutes)`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a device set to UTC, the clock and "Updated" still use church time', async () => {
  const { page, errors, context } = await openTv({ now: churchTime('13:47'), timezoneId: 'UTC' });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await page.locator('#clock').textContent(), '1:47 PM');
  assert.equal(await page.locator('#updated').textContent(), 'Updated 1:47 PM');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the timeline keeps its scroll position when the TV redraws', async () => {
  const { page, errors, context } = await openTv({ now: churchTime('12:10'), width: 600, height: 1000 });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  const timeline = page.locator('.tv-timeline');
  assert.ok(await timeline.evaluate(element => element.scrollWidth > element.clientWidth), 'a narrow screen scrolls the timeline');
  const scrolled = await timeline.evaluate(element => {
    element.scrollLeft = 100;
    return element.scrollLeft;
  });
  assert.equal(scrolled, 100);
  const before = await page.locator('.tv-now').first().getAttribute('style');
  await page.clock.runFor(5 * MINUTE);
  await page.waitForFunction(style => document.querySelector('.tv-now').getAttribute('style') !== style, before);
  assert.equal(await timeline.evaluate(element => element.scrollLeft), 100);
  assert.equal(await fitsWidth(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the TV reloads itself once after 4:00 AM, and only when connected', async () => {
  const { page, errors, context, state } = await openTv({ now: new Date('2026-10-03T03:20:00-07:00') });
  await label(page).filter({ hasText: 'Live' }).waitFor();
  await page.evaluate(() => { window.firstPage = true; });
  state.online = false;
  const before = state.requests;
  await page.clock.fastForward(45 * MINUTE);
  await page.waitForFunction(() => document.querySelector('#clock').textContent === '4:05 AM');
  await page.clock.fastForward(MINUTE);
  await settle(page);
  assert.ok(state.requests > before);
  assert.equal(await page.evaluate(() => window.firstPage), true, 'no reload while offline');
  state.online = true;
  const loaded = page.waitForEvent('load');
  await page.clock.fastForward(MINUTE);
  await loaded;
  await label(page).filter({ hasText: 'Live' }).waitFor();
  assert.equal(await page.evaluate(() => window.firstPage), undefined);
  await page.evaluate(() => { window.secondPage = true; });
  const after = state.requests;
  await page.clock.fastForward(5 * MINUTE);
  await page.waitForFunction(() => document.querySelector('#clock').textContent === '4:12 AM');
  assert.ok(state.requests > after);
  await settle(page);
  assert.equal(await page.evaluate(() => window.secondPage), true, 'it reloads once, not again');
  assert.deepEqual(errors, []);
  await context.close();
});

test('demo mode shows a sample without calling the server', async () => {
  const { page, errors, context, state } = await openTv({ query: '?demo=1' });
  await label(page).filter({ hasText: 'Sample schedule' }).waitFor();
  await page.locator('.tv-day-button').nth(1).click();
  await page.locator('.tv-booking', { hasText: 'Robin' }).waitFor();
  assert.equal(state.requests, 0);
  assert.deepEqual(errors, []);
  await context.close();
});
