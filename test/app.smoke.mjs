// Member app in a real browser, against a fake Firebase that answers like
// the Cloud Functions. Every name is fictional.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { start, newPage, lastCall, fitsWidth } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const { bookableDates, dayInfo, weekdayOf } = require('../functions/lib/schedule.js');
const { clientConfig } = require('../functions/lib/views.js');

const days = bookableDates().map(dayInfo);
const SATURDAY = days.find(day => weekdayOf(day.date) === 6).date;
const TYPE_OF = { room: 'room', wb: 'whiteboard', tv: 'tv' };

function scheduleRow(unit, start, end, name, purpose, extra = {}) {
  return { id: `${unit}-${start}`, date: SATURDAY, type: TYPE_OF[unit.split('-')[0]], unit, start, end, name, purpose, reservedFor: '', mine: false, ...extra };
}

const FIXTURE = {
  config: clientConfig(),
  days,
  bookings: [
    scheduleRow('room-1', '11:00', '12:30', 'B John', 'contact', { reservedFor: 'Sample Contact' }),
    scheduleRow('room-2', '12:00', '13:00', 'Reserved', 'blocked'),
    scheduleRow('room-3', '11:00', '12:00', 'Avery', 'other', { reservedFor: 'Study' }),
    scheduleRow('room-4', '11:00', '12:00', 'Casey', 'other', { reservedFor: 'Review' }),
    scheduleRow('room-1', '16:00', '17:00', 'Dana', 'other', { reservedFor: 'Study' }),
    scheduleRow('room-2', '16:00', '17:00', 'Eli', 'other', { reservedFor: 'Study' }),
    scheduleRow('room-3', '16:00', '17:00', 'Fay', 'contact', { reservedFor: 'Sample Contact' }),
    scheduleRow('room-4', '16:00', '17:00', 'Reserved', 'blocked'),
    scheduleRow('wb-2', '17:00', '18:30', 'Sam', 'other', { id: 'mine-1', mine: true, reservedFor: 'Planning' })
  ],
  mine: [
    { id: 'mine-1', date: SATURDAY, start: '17:00', end: '18:30', endedEarlyFrom: null, status: 'approved', type: 'whiteboard', unit: 'wb-2', purpose: 'other', name: 'Sam Sample', reservedFor: 'Planning', notice: null, canCancel: true, canEndEarly: true },
    { id: 'mine-2', date: SATURDAY, start: '13:00', end: '14:00', endedEarlyFrom: null, status: 'cancelled', type: 'room', unit: 'room-1', purpose: 'other', name: 'Sam Sample', reservedFor: 'Planning', notice: null, canCancel: false, canEndEarly: false },
    { id: 'mine-3', date: SATURDAY, start: '18:00', end: '19:00', endedEarlyFrom: null, status: 'overridden', type: 'room', unit: null, purpose: 'other', name: 'Sam Sample', reservedFor: 'Planning',
      notice: { kind: 'released', fromUnit: 'room-2', toUnit: null, toEnd: null, byPurpose: 'contact' }, canCancel: false, canEndEarly: false }
  ]
};

// Runs in the page. `window.__refuse` makes the next change fail like the server would.
const BACKEND = `(() => {
  const state = ${JSON.stringify(FIXTURE)};
  let count = 0;
  return async (name, data) => {
    if (window.__refuse && name !== 'memberSchedule') {
      const error = window.__refuse;
      window.__refuse = null;
      throw error;
    }
    if (name === 'memberSchedule') return { version: 2, ...structuredClone(state) };
    if (name === 'memberSubmitBooking') {
      count += 1;
      const unit = data.requestedUnit || { room: 'room-2', whiteboard: 'wb-1', tv: 'tv-1' }[data.resourceType];
      const id = 'new-' + count;
      state.bookings.push({ id, date: data.date, type: data.resourceType, unit, start: data.start, end: data.end, name: data.name.split(' ')[0], purpose: data.purpose, reservedFor: data.reservedFor, mine: true });
      state.mine.push({ id, date: data.date, start: data.start, end: data.end, endedEarlyFrom: null, status: 'approved', type: data.resourceType, unit, purpose: data.purpose, name: data.name, reservedFor: data.reservedFor, notice: null, canCancel: true, canEndEarly: true });
      return { id, unit, tookOver: data.allowTakeover };
    }
    if (name === 'memberCancelBooking') {
      state.bookings = state.bookings.filter(row => row.id !== data.bookingId);
      Object.assign(state.mine.find(row => row.id === data.bookingId), { status: 'cancelled', canCancel: false, canEndEarly: false });
      return { ok: true };
    }
    if (name === 'memberEndBookingEarly') {
      const item = state.mine.find(row => row.id === data.bookingId);
      Object.assign(item, { endedEarlyFrom: item.end, end: data.end, canEndEarly: false });
      state.bookings.forEach(row => { if (row.id === data.bookingId) row.end = data.end; });
      return { end: data.end };
    }
  };
})()`;

let harness;
before(async () => { harness = await start(); });
after(async () => harness.stop());

async function openApp(query = '', options = {}) {
  const session = await newPage(harness.browser, { backend: BACKEND, ...options });
  await session.page.goto(`${harness.base}/${query}`);
  await session.page.getByRole('button', { name: 'Reserve' }).first().waitFor();
  await session.page.locator('.date-button[aria-pressed="true"]').waitFor();
  if (!query.includes('view=mine')) await session.page.locator(`[data-date="${SATURDAY}"]`).click();
  return { ...session, sheet: session.page.locator('#booking-sheet') };
}

test('the schedule shows public names, holds and my own reservation', async () => {
  const { page, errors, context } = await openApp();
  await page.getByRole('button', { name: /^B John, Contact, Room 1/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Reserved, Room 2, 12:00 PM/ }).count(), 1);
  assert.equal(await page.locator('.service').first().textContent().then(text => text.includes('Morning service')), true);
  await page.locator('[data-type="whiteboard"]').click();
  await page.getByRole('button', { name: /Sam, Other, Board 2, .*your reservation/ }).waitFor();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await fitsWidth(page), true, `no sideways scroll at ${width}px`);
  }
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(item => ['serious', 'critical'].includes(item.impact));
  assert.deepEqual(serious.map(item => item.id), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('reserving from the Reserve button lets the server pick the unit', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.getByRole('button', { name: 'Reserve', exact: true }).click();
  await sheet.getByRole('button', { name: 'Study room', exact: true }).click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await sheet.getByRole('button', { name: '1:00 PM', exact: true }).click();
  await sheet.getByRole('button', { name: /^2:00 PM, 1 hr$/ }).click();
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Enter your name.').waitFor();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Purpose').fill('Choir practice');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Confirm reservation' }).waitFor();
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const call = await lastCall(page, 'memberSubmitBooking');
  assert.deepEqual(call.data, {
    date: SATURDAY, start: '13:00', end: '14:00', resourceType: 'room', requestedUnit: null,
    purpose: 'other', name: 'Sam Sample', reservedFor: 'Choir practice', allowTakeover: false
  });
  await sheet.getByRole('button', { name: 'See it on the schedule', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches('.booking.highlight'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('tapping an open time books exactly that unit, and a refusal keeps the details', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.getByRole('button', { name: /^Reserve Room 2 at 11:00 AM/ }).click();
  await sheet.getByRole('button', { name: 'New Member', exact: true }).click();
  await sheet.getByRole('button', { name: /^11:30 AM, 30 min$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Member name').fill('Sample Member');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.evaluate(() => { window.__refuse = { code: 'already-exists', message: 'That unit is taken for part of that time. Choose another time.' }; });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByText('That unit is taken for part of that time.').waitFor();
  assert.equal(await sheet.getByRole('heading', { name: 'Confirm reservation' }).count(), 1, 'stays on the confirmation');
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  assert.equal((await lastCall(page, 'memberSubmitBooking')).data.requestedUnit, 'room-2');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Contact is shown and asked before taking a lower-priority time', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.getByRole('button', { name: 'Reserve', exact: true }).click();
  await sheet.getByRole('button', { name: 'Study room', exact: true }).click();
  await sheet.getByRole('button', { name: 'Contact', exact: true }).click();
  await sheet.getByRole('button', { name: '4:00 PM, Priority override' }).click();
  await sheet.getByRole('button', { name: /^5:00 PM, 1 hr, Priority override$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Contact name').fill('Sample Contact');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('This time is held by a lower-priority reservation.').waitFor();
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  assert.equal((await lastCall(page, 'memberSubmitBooking')).data.allowTakeover, true);
  // Other has no priority, so the same full time is not offered.
  await sheet.getByRole('button', { name: 'Reserve something else', exact: true }).click();
  await sheet.getByRole('button', { name: 'Study room', exact: true }).click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  assert.equal(await sheet.getByRole('button', { name: /^4:00 PM/ }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('tapping a reservation shows its details, with actions only on your own', async () => {
  const { page, errors, context } = await openApp();
  await page.getByRole('button', { name: /^B John, Contact, Room 1/ }).click();
  await page.getByRole('heading', { name: 'Room 1' }).waitFor();
  assert.equal(await page.locator('#details-sheet').getByText('Sample Contact').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Cancel reservation' }).count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('[data-type="whiteboard"]').click();
  await page.getByRole('button', { name: /your reservation/ }).click();
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await page.locator('#details-sheet').waitFor({ state: 'hidden' });
  assert.deepEqual((await lastCall(page, 'memberCancelBooking')).data, { bookingId: 'mine-1' });
  assert.equal(await page.getByRole('button', { name: /your reservation/ }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('My reservations lists each status and can end a reservation early', async () => {
  const { page, errors, context } = await openApp('?view=mine');
  const sheet = page.locator('#mine-sheet');
  await sheet.getByRole('heading', { name: 'My reservations' }).waitFor();
  assert.deepEqual(await sheet.locator('.group-title').allTextContents(), ['Active', 'Cancelled or replaced']);
  for (const status of ['Confirmed', 'Cancelled', 'Replaced']) assert.equal(await sheet.locator('.badge', { hasText: status }).count(), 1, status);
  await sheet.getByText('A Contact reservation needed Room 2 and no other study room was free').waitFor();
  assert.equal(await sheet.getByRole('button', { name: 'Reserve another time' }).count(), 1);

  await sheet.getByRole('button', { name: 'End early' }).click();
  await sheet.getByRole('button', { name: /^End at 6:00 PM/ }).click();
  await sheet.getByRole('heading', { name: 'End at 6:00 PM?' }).waitFor();
  await sheet.getByRole('button', { name: 'End early' }).click();
  await sheet.getByText('Ended early. It was booked until 6:30 PM.').waitFor();
  assert.deepEqual((await lastCall(page, 'memberEndBookingEarly')).data, { bookingId: 'mine-1', end: '18:00' });

  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(new URL(page.url()).searchParams.has('view'), false);
  await page.getByRole('link', { name: 'My reservations' }).click();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'mine');
  await page.goBack();
  await sheet.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('offline pauses reservations until the connection returns', async () => {
  const { page, errors, context } = await openApp();
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.getByText('You’re offline.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reserve', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.open-slot').count(), 0);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.getElementById('reserve').disabled);
  assert.deepEqual(errors, []);
  await context.close();
});

test('demo mode works without the server', async () => {
  const { page, errors, context } = await newPage(harness.browser);
  await context.route('**/firebasejs/**', route => route.abort());
  await page.goto(`${harness.base}/?demo=1`);
  await page.getByText('Demo mode: a sample schedule').waitFor();
  const sheet = page.locator('#booking-sheet');
  await page.locator('.open-slot').first().click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await sheet.locator('[data-end]').first().click();
  await page.getByLabel('Your name').fill('Sister Pat Sample');
  await page.getByLabel('Purpose').fill('Practice');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Confirm reservation' }).click();
  await page.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  await sheet.getByRole('button', { name: 'See it on the schedule' }).click();
  await page.getByRole('button', { name: /^S Pat, Other/ }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});
