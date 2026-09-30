// Lobby TV in a real browser, with the public schedule answered locally.
// Every name is fictional.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { start, newPage, fitsWidth } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const { lobbyDates, dayInfo, weekdayOf, todayAt } = require('../functions/lib/schedule.js');
const { clientConfig } = require('../functions/lib/views.js');

const days = lobbyDates().map(dayInfo);
const SATURDAY = days.find(day => weekdayOf(day.date) === 6).date;
const TODAY = todayAt();
const PAYLOAD = {
  version: 1,
  generatedAt: new Date().toISOString(),
  config: clientConfig(),
  days,
  bookings: [
    { date: SATURDAY, start: '11:00', end: '12:30', room: 'room-1', name: 'B John' },
    { date: SATURDAY, start: '12:00', end: '13:00', room: 'room-3', name: 'Reserved' }
  ]
};

let harness;
before(async () => { harness = await start(); });
after(async () => harness.stop());

async function openTv(query = '') {
  const session = await newPage(harness.browser, { width: 1920, height: 1080 });
  const state = { online: true, requests: 0 };
  await session.context.route('**/publicLobbySchedule', route => {
    state.requests += 1;
    return state.online ? route.fulfill({ json: PAYLOAD }) : route.abort();
  });
  await session.page.goto(`${harness.base}/tv.html${query}`);
  return { ...session, state };
}

test('the TV shows each room and the day\'s reservations', async () => {
  const { page, errors, context } = await openTv(`?date=${SATURDAY}`);
  await page.locator('#connection-label', { hasText: 'Live' }).waitFor();
  assert.deepEqual(await page.locator('.tv-room h2').allTextContents(), ['Room 1', 'Room 2', 'Room 3', 'Room 4']);
  assert.equal(await page.locator('.tv-booking', { hasText: 'B John' }).count(), 1);
  assert.equal(await page.locator('.tv-service').count() > 0, true);
  assert.equal(await page.locator('.tv-day-button[aria-pressed="true"]').count(), 1);
  assert.equal(await fitsWidth(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a day with no room schedule says so', async () => {
  const { page, errors, context } = await openTv();
  await page.locator('#connection-label', { hasText: 'Live' }).waitFor();
  if (days.find(day => day.date === TODAY).scheduled) {
    assert.equal(await page.locator('.tv-room').count(), 4);
  } else {
    await page.getByRole('heading', { name: 'No room schedule today' }).waitFor();
  }
  await page.getByRole('button', { name: 'Today' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('when the connection drops, the last schedule stays up', async () => {
  const { page, errors, context, state } = await openTv(`?date=${SATURDAY}`);
  await page.locator('#connection-label', { hasText: 'Live' }).waitFor();
  state.online = false;
  await page.reload();
  await page.locator('#connection-label', { hasText: 'Reconnecting' }).waitFor();
  assert.equal(await page.locator('.tv-booking', { hasText: 'B John' }).count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('demo mode shows a sample without calling the server', async () => {
  const { page, errors, context, state } = await openTv('?demo=1');
  await page.locator('#connection-label', { hasText: 'Sample schedule' }).waitFor();
  await page.locator('.tv-day-button').nth(1).click();
  await page.locator('.tv-booking', { hasText: 'Robin' }).waitFor();
  assert.equal(state.requests, 0);
  assert.deepEqual(errors, []);
  await context.close();
});
