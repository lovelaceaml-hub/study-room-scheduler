// Member app in a real browser, against a fake Firebase that answers like
// the Cloud Functions. Every page runs on the harness's fixed church clock
// (Saturday, October 3, 2026, 9:00 AM; booking days Saturday Oct 3 through
// Tuesday Oct 6) unless a test sets another time, so nothing depends on the
// day the tests run. Every name is fictional.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { start, newPage, lastCall, fitsWidth, TEST_NOW } from './support/harness.mjs';
import { formatDay } from '../public/shared/format.js';
import { shortName } from '../public/app/demo-backend.js';

const require = createRequire(import.meta.url);
const { bookableDates, dayInfo, todayAt } = require('../functions/lib/schedule.js');
const { clientConfig } = require('../functions/lib/views.js');
const { publicName } = require('../functions/lib/names.js');

// Saturday, October 3, 2026 at a church-clock time.
const saturdayAt = time => new Date(`2026-10-03T${time}:00-07:00`);
const MINUTE = 60 * 1000;
const daysAt = now => bookableDates(now).map(dayInfo);
const TODAY = todayAt(TEST_NOW);
// Tuesday: no time on it has passed, and the times below are clear of its services.
const DAY = daysAt(TEST_NOW).find(day => day.date !== TODAY && day.services.length).date;
const DAY_LABEL = formatDay(DAY);
// The server's rules, with the fields the server contract adds filled in
// for a server that does not send them yet.
const CONFIG = {
  windowDays: 4, hold: 'blocked', nameMax: 120, noteMax: 1000, holdReasonMax: 240, keepDays: 56, sessionMinutes: 20,
  ...clientConfig()
};
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;
const TYPE_OF = { room: 'room', wb: 'whiteboard', tv: 'tv' };

function row(unit, start, end, name, purpose, extra = {}) {
  return { id: `${unit}-${start}`, date: DAY, type: TYPE_OF[unit.split('-')[0]], unit, start, end, name, purpose, reservedFor: '', mine: false, ...extra };
}

// One of this device's reservations, as My reservations gets it.
function reservation(id, start, end, extra = {}) {
  return { id, date: DAY, start, end, endedEarlyFrom: null, status: 'approved', type: 'room', unit: 'room-1', purpose: 'other', name: 'Sam Sample', reservedFor: 'Planning', notice: null, ...extra };
}

const BOOKINGS = [
  row('room-1', '11:00', '12:30', 'B John', 'contact', { reservedFor: 'Sample Contact' }),
  row('room-2', '12:00', '13:00', 'Reserved', 'blocked'),
  row('room-3', '11:00', '12:00', 'Avery', 'other', { reservedFor: 'Study' }),
  row('room-4', '11:00', '12:00', 'Casey', 'other', { reservedFor: 'Review' }),
  // From 4 to 5 PM every room is taken; Dana began at 3 PM.
  row('room-1', '15:00', '17:00', 'Dana', 'other', { reservedFor: 'Study' }),
  row('room-2', '16:00', '17:00', 'Eli', 'other', { reservedFor: 'Study' }),
  row('room-3', '16:00', '17:00', 'Fay', 'contact', { reservedFor: 'Sample Contact' }),
  row('room-4', '16:00', '17:00', 'Reserved', 'blocked'),
  row('wb-2', '17:00', '18:30', 'Sam', 'other', { id: 'mine-1', mine: true, reservedFor: 'Planning' })
];
const MINE = [
  reservation('mine-1', '17:00', '18:30', { type: 'whiteboard', unit: 'wb-2' }),
  reservation('mine-2', '13:00', '14:00', { status: 'cancelled' }),
  reservation('mine-3', '18:00', '19:00', { status: 'overridden', unit: null, notice: { kind: 'released', fromUnit: 'room-2', toUnit: null, toEnd: null, byPurpose: 'contact' } })
];

function schedule({ now = TEST_NOW, bookings = BOOKINGS, mine = MINE } = {}) {
  return { config: CONFIG, days: daysAt(now), bookings, mine };
}

// Runs in the page as the fake Cloud Functions. `window.__server` holds the
// normal answers; `window.__hooks[name]` replaces one call for a test. The
// contract fields of `mine` (ended, earlyEnds, canCancel, byAdmin) follow
// the page's clock, like the server's; `oldServer` leaves them out, like a
// server from before the contract. `serverAhead` is how far the server's
// clock (sent as `serverTime`) is ahead of the page's.
function backend(fixture, { oldServer = false, serverAhead = 0 } = {}) {
  return `(() => {
    const state = ${JSON.stringify(fixture)};
    const oldServer = ${oldServer};
    let rules = null;
    let count = 0;
    // Like the server, a repeated request id gets the first answer.
    const answered = new Map();
    window.__state = state;
    window.__hooks = {};
    async function mineView(item) {
      rules ??= import(new URL('/shared/availability.js', location.href).href);
      const { hasEnded, earlyEndChoices, earlierEnds } = await rules;
      const active = item.status === 'approved';
      if (oldServer) return { ...item, canCancel: active, canEndEarly: active && earlierEnds(state.config, item.start, item.end).length > 0 };
      const ended = active && hasEnded(state.config, item.date, item.end);
      const earlyEnds = active && !ended ? earlyEndChoices(state.config, item.date, item.start, item.end) : [];
      return { byAdmin: false, ended, earlyEnds, canEndEarly: earlyEnds.length > 0, canCancel: active && !ended, ...item,
        notice: item.status === 'cancelled' ? null : item.notice };
    }
    window.__server = {
      async memberSchedule() {
        return { version: 2, serverTime: Date.now() + ${serverAhead}, ...structuredClone(state), mine: await Promise.all(state.mine.map(mineView)) };
      },
      memberSubmitBooking(data) {
        if (data.requestId && answered.has(data.requestId)) return { ...answered.get(data.requestId), repeated: true };
        count += 1;
        const unit = data.takeoverUnit || data.requestedUnit || { room: 'room-2', whiteboard: 'wb-1', tv: 'tv-1' }[data.resourceType];
        const id = 'new-' + count;
        state.bookings.push({ id, date: data.date, type: data.resourceType, unit, start: data.start, end: data.end, name: data.name.split(' ')[0], purpose: data.purpose, reservedFor: data.reservedFor, mine: true });
        state.mine.push({ id, date: data.date, start: data.start, end: data.end, endedEarlyFrom: null, status: 'approved', type: data.resourceType, unit, purpose: data.purpose, name: data.name, reservedFor: data.reservedFor, notice: null });
        const result = { id, unit, takeover: data.allowTakeover === true };
        if (data.requestId) answered.set(data.requestId, result);
        return result;
      },
      memberCancelBooking(data) {
        state.bookings = state.bookings.filter(row => row.id !== data.bookingId);
        state.mine.find(row => row.id === data.bookingId).status = 'cancelled';
        return { ok: true };
      },
      memberEndBookingEarly(data) {
        const item = state.mine.find(row => row.id === data.bookingId);
        Object.assign(item, { endedEarlyFrom: item.endedEarlyFrom ?? item.end, end: data.end });
        state.bookings.forEach(row => { if (row.id === data.bookingId) row.end = data.end; });
        return { end: data.end };
      }
    };
    return async (name, data) => (window.__hooks[name] || window.__server[name])(data, state);
  })()`;
}

let harness;
before(async () => { harness = await start(); });
after(async () => harness?.stop());

// Opens the app and shows `day` (null: leave the day the app picked).
async function openApp(query = '', { fixture = schedule(), oldServer = false, serverAhead = 0, day = DAY, ...options } = {}) {
  const session = await newPage(harness.browser, { backend: backend(fixture, { oldServer, serverAhead }), ...options });
  await session.page.goto(`${harness.base}/${query}`);
  await session.page.locator('#reserve:not([disabled])').waitFor();
  if (day && !query.includes('view=mine')) await session.page.locator(`[data-date="${day}"]`).click();
  return { ...session, sheet: session.page.locator('#booking-sheet') };
}

const slot = (unit, time, date = DAY) => ({ name: `Open, reserve ${unit} at ${time}, ${formatDay(date)}`, exact: true });
const calls = (page, name) => page.evaluate(callable => window.__calls.filter(call => call.name === callable), name);

// From a tapped open time to the confirmation.
async function tapToConfirm(page, sheet, unit, time, { purpose = 'Other', detail = 'Purpose', date = DAY } = {}) {
  await page.getByRole('button', slot(unit, time, date)).click();
  await sheet.getByRole('button', { name: purpose, exact: true }).click();
  await sheet.locator('[data-end]').first().click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel(detail).fill('Study');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Confirm reservation' }).waitFor();
}

async function seriousAxe(page, selector, label) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  return results.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => `${label}: ${item.id}`);
}

test('the schedule shows public names, holds and my own reservation', async () => {
  const { page, errors, context } = await openApp();
  await page.getByRole('button', { name: /^B John, Contact, Room 1/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Reserved, Room 2, 12:00 PM/ }).count(), 1);
  assert.equal(await page.getByRole('button', slot('Room 3', '1:00 PM')).count(), 1, 'an open time says what it is first');
  assert.equal(await page.locator('#hint').textContent(), 'Choose an open time to reserve it.');
  const firstService = daysAt(TEST_NOW).find(day => day.date === DAY).services[0].label;
  assert.equal(await page.locator('.service').first().textContent().then(text => text.includes(firstService)), true);
  await page.locator('.type-button[data-type="whiteboard"]').click();
  await page.getByRole('button', { name: 'Sam, yours, Other, Board 2 (Large), 5:00 PM to 6:30 PM', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', slot('Board 4 (Vertical)', '1:00 PM')).count(), 1, 'the unit note is read out');
  // On a phone your own block says so in words, in place of the purpose.
  assert.equal(await page.locator('.booking.mine .booking-mine').isVisible(), true);
  assert.equal(await page.locator('.booking.mine .booking-purpose').isVisible(), false);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await fitsWidth(page), true, `no sideways scroll at ${width}px`);
  }
  assert.deepEqual(await seriousAxe(page, 'body', 'schedule'), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('member schedule refreshes at 30 seconds instead of every 15', async () => {
  const { page, errors, context } = await openApp();
  const before = (await calls(page, 'memberSchedule')).length;
  await page.clock.fastForward(15000);
  assert.equal((await calls(page, 'memberSchedule')).length, before);
  await page.clock.fastForward(15000);
  await page.waitForFunction(count => window.__calls.filter(call => call.name === 'memberSchedule').length > count, before);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a phone clock that is wrong is offered start times by the server\'s clock', async () => {
  // The server says 4:10 PM, so 4:30 PM is the first open start either way.
  for (const [deviceTime, serverAhead] of [['16:40', -30 * MINUTE], ['15:40', 30 * MINUTE]]) {
    const now = saturdayAt(deviceTime);
    const { page, errors, context, sheet } = await openApp('', { now, serverAhead, fixture: schedule({ now: saturdayAt('16:10'), bookings: [], mine: [] }), day: null });
    await page.locator(`[data-date="${TODAY}"][aria-pressed="true"]`).waitFor();
    assert.equal(await page.locator('.open-slot[data-unit="room-1"]').first().getAttribute('data-start'), String(16 * 60 + 30), deviceTime);
    await page.locator('#reserve').click();
    await sheet.getByRole('button', { name: 'Other', exact: true }).click();
    await sheet.getByRole('heading', { name: 'Start time' }).waitFor();
    assert.equal(await sheet.locator('[data-start]').first().textContent().then(text => text.trim()), '4:30 PM', deviceTime);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('the page opens on the first day with time left, which on Saturday morning is today', async () => {
  const { page, errors, context } = await openApp('', { day: null });
  await page.locator(`[data-date="${TODAY}"][aria-pressed="true"]`).waitFor();
  // Before the 10:00 AM service ends nothing starts; 11:00 AM is the first open time.
  assert.equal(await page.locator('.open-slot[data-unit="room-1"]').first().getAttribute('data-start'), '660');
  assert.deepEqual(errors, []);
  await context.close();
});

test('at 4:10 PM the first open start today is 4:30 PM', async () => {
  const now = saturdayAt('16:10');
  const { page, errors, context, sheet } = await openApp('', { now, fixture: schedule({ now, bookings: [], mine: [] }), day: null });
  await page.locator(`[data-date="${TODAY}"][aria-pressed="true"]`).waitFor();
  assert.equal(await page.locator('.open-slot[data-unit="room-1"]').first().getAttribute('data-start'), String(16 * 60 + 30));
  assert.equal(await page.getByRole('button', slot('Room 1', '4:00 PM', TODAY)).count(), 0);
  await page.locator('#reserve').click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Start time' }).waitFor();
  assert.equal(await sheet.locator('[data-start]').first().textContent().then(text => text.trim()), '4:30 PM');
  assert.deepEqual(errors, []);
  await context.close();
});

test('late on Saturday the page opens on Sunday, and Saturday says it has no times left', async () => {
  const now = saturdayAt('23:10');
  const { page, errors, context } = await openApp('', { now, fixture: schedule({ now, bookings: [], mine: [] }), day: null });
  await page.locator('[data-date="2026-10-04"][aria-pressed="true"]').waitFor();
  await page.locator(`[data-date="${TODAY}"]`).click();
  await page.locator('#hint', { hasText: 'No more open times on this day.' }).waitFor();
  assert.equal(await page.locator('.open-slot').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('reserving from the Reserve button keeps the day and kind on screen and lets the server pick the unit', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.locator('#reserve').click();
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  assert.equal(await sheet.locator('.sheet-step').textContent(), 'Step 1 of 5');
  assert.deepEqual(await sheet.locator('.chips span').allTextContents(), [DAY_LABEL, 'Study room']);
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
  const { requestId, ...data } = (await lastCall(page, 'memberSubmitBooking')).data;
  assert.match(requestId, REQUEST_ID);
  assert.deepEqual(data, {
    date: DAY, start: '13:00', end: '14:00', resourceType: 'room', requestedUnit: null,
    purpose: 'other', name: 'Sam Sample', reservedFor: 'Choir practice', allowTakeover: false
  });
  await sheet.getByRole('button', { name: 'See it on the schedule', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches('.booking.highlight'));
  // Another kind on screen: the Reserve button reserves that kind.
  await page.locator('.type-button[data-type="tv"]').click();
  await page.locator('#reserve').click();
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  assert.deepEqual(await sheet.locator('.chips span').allTextContents(), [DAY_LABEL, 'TV']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('tapping an open time books exactly that unit, and a refusal reloads the schedule and keeps the details', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.getByRole('button', slot('Room 2', '11:00 AM')).click();
  await sheet.getByRole('button', { name: 'New Member', exact: true }).click();
  await sheet.getByRole('button', { name: /^11:30 AM, 30 min$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Member name').fill('Sample Member');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  const loads = (await calls(page, 'memberSchedule')).length;
  await page.evaluate(() => {
    window.__hooks.memberSubmitBooking = () => {
      delete window.__hooks.memberSubmitBooking;
      throw { code: 'already-exists', message: 'Room 2 is taken for part of that time. Choose another time.' };
    };
  });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByText('Room 2 is taken for part of that time. Choose another time.').waitFor();
  assert.ok((await calls(page, 'memberSchedule')).length > loads, 'the schedule reloads after a refusal');
  assert.equal(await sheet.getByRole('heading', { name: 'Confirm reservation' }).count(), 1, 'stays on the confirmation');
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await page.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const [first, second] = await calls(page, 'memberSubmitBooking');
  assert.equal(second.data.requestedUnit, 'room-2');
  assert.equal(second.data.requestId, first.data.requestId, 'a retry of the same draft keeps its request id');
  assert.deepEqual(errors, []);
  await context.close();
});

test('when the chosen time was taken, the refusal reloads the schedule and says the time is gone', async () => {
  const { page, errors, context, sheet } = await openApp();
  await tapToConfirm(page, sheet, 'Room 2', '1:00 PM');
  await page.evaluate(date => {
    window.__hooks.memberSubmitBooking = (data, state) => {
      state.bookings.push({ id: 'taken', date, type: 'room', unit: 'room-2', start: '13:00', end: '14:00', name: 'Avery', purpose: 'other', reservedFor: 'Study', mine: false });
      throw { code: 'already-exists', message: 'Room 2 is taken for part of that time. Choose another time.' };
    };
  }, DAY);
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByText('This time is no longer open. Go back and choose another time.').waitFor();
  await page.locator('[data-booking="taken"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-key="slot-room-2-780"]').count(), 0, 'the grid no longer offers it');
  assert.equal((await calls(page, 'memberSubmitBooking')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a lost answer is checked against the schedule, and a retry reuses the request id', async () => {
  const { page, errors, context, sheet } = await openApp();
  // The server made the reservation, but the answer never arrived.
  await tapToConfirm(page, sheet, 'Room 2', '1:00 PM');
  await page.evaluate(() => {
    window.__hooks.memberSubmitBooking = data => {
      delete window.__hooks.memberSubmitBooking;
      window.__server.memberSubmitBooking(data);
      throw { code: 'unavailable', message: 'unavailable' };
    };
  });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  assert.equal((await calls(page, 'memberSubmitBooking')).length, 1, 'no second booking');
  await sheet.getByRole('button', { name: 'See it on the schedule', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.booking === 'new-1');

  // This time nothing was made: the member is told, and the retry is recognisable.
  await tapToConfirm(page, sheet, 'Room 3', '1:00 PM');
  await page.evaluate(() => {
    window.__hooks.memberSubmitBooking = () => {
      delete window.__hooks.memberSubmitBooking;
      throw { code: 'internal', message: 'internal' };
    };
  });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByText('We couldn’t confirm the reservation. Check your connection, then try again.').waitFor();
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const ids = (await calls(page, 'memberSubmitBooking')).map(call => call.data.requestId);
  assert.equal(ids.length, 3);
  assert.equal(ids[2], ids[1], 'the retry sends the same request id');
  assert.notEqual(ids[1], ids[0], 'a new draft gets a new request id');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a second Escape while saving closes the sheet cleanly, and the result comes back', async () => {
  const { page, errors, context, sheet } = await openApp();
  await tapToConfirm(page, sheet, 'Room 2', '1:00 PM');
  await page.evaluate(() => {
    window.__hooks.memberSubmitBooking = async data => {
      await new Promise(resolve => { window.__finishSave = resolve; });
      return window.__server.memberSubmitBooking(data);
    };
  });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('button', { name: 'Reserving…' }).waitFor();
  assert.equal(await sheet.locator('.sheet-step').textContent(), 'Saving…');
  assert.equal(await sheet.getByRole('button', { name: 'Close' }).isDisabled(), true, 'the X waits while saving');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.body.classList.contains('sheet-open'));
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => scrollY > 0, null, { timeout: 2000 });
  await page.waitForFunction(() => window.__finishSave);
  await page.evaluate(() => window.__finishSave());
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('sheet-open')), false);
  assert.equal((await calls(page, 'memberSubmitBooking')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a slow schedule refresh does not hold up the confirmation, and its older answer is ignored', async () => {
  const { page, errors, context, sheet } = await openApp();
  await tapToConfirm(page, sheet, 'Room 2', '1:00 PM');
  // A refresh starts, like the periodic one, and its answer is held back.
  await page.evaluate(() => {
    window.__hooks.memberSchedule = async () => {
      delete window.__hooks.memberSchedule;
      const before = await window.__server.memberSchedule();
      await new Promise(resolve => { window.__finishSchedule = resolve; });
      return before;
    };
    dispatchEvent(new Event('online'));
  });
  await page.waitForFunction(() => window.__finishSchedule);
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor({ timeout: 3000 });
  await sheet.getByRole('button', { name: 'See it on the schedule', exact: true }).click();
  await page.locator('[data-booking="new-1"]').waitFor();
  await page.evaluate(() => window.__finishSchedule());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
  assert.equal(await page.locator('[data-booking="new-1"]').count(), 1, 'the schedule from before the booking does not come back');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a start that passes while the sheet is open is caught before sending', async () => {
  const now = saturdayAt('16:20');
  const { page, errors, context, sheet } = await openApp('', { now, fixture: schedule({ now, bookings: [], mine: [] }), day: TODAY });
  await tapToConfirm(page, sheet, 'Room 1', '4:30 PM', { date: TODAY });
  await page.clock.fastForward('11:00');
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByText('This start time has passed. Close this and choose a later time.').waitFor();
  assert.equal((await calls(page, 'memberSubmitBooking')).length, 0, 'nothing is sent');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a finished reservation shows Finished and offers nothing', async () => {
  const now = saturdayAt('16:10');
  const past = reservation('past-1', '11:00', '13:00', { date: TODAY });
  const fixture = schedule({ now, bookings: [row('room-1', '11:00', '13:00', 'Sam', 'other', { id: 'past-1', date: TODAY, mine: true })], mine: [past] });
  const { page, errors, context } = await openApp('?view=mine', { now, fixture });
  const mine = page.locator('#mine-sheet');
  await mine.locator('.badge', { hasText: 'Finished' }).waitFor();
  assert.deepEqual(await mine.locator('.group-title').allTextContents(), ['Finished']);
  assert.equal(await mine.locator('.card button').count(), 0);
  await mine.getByRole('button', { name: 'Close' }).click();
  await mine.waitFor({ state: 'hidden' });
  await page.locator(`[data-date="${TODAY}"]`).click();
  await page.getByRole('button', { name: /, yours, / }).click();
  const details = page.locator('#details-sheet');
  await details.getByText('This reservation has finished.').waitFor();
  assert.equal(await details.locator('.actions button').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a reservation under way offers only ends still to come, the first one as the soonest', async () => {
  const now = saturdayAt('16:10');
  const current = reservation('now-1', '16:00', '18:00', { date: TODAY });
  const fixture = schedule({ now, bookings: [row('room-1', '16:00', '18:00', 'Sam', 'other', { id: 'now-1', date: TODAY, mine: true })], mine: [current] });
  for (const oldServer of [false, true]) {
    const { page, errors, context } = await openApp('?view=mine', { now, fixture, oldServer });
    const mine = page.locator('#mine-sheet');
    await mine.getByRole('button', { name: 'End early' }).click();
    await mine.getByRole('heading', { name: 'End early' }).waitFor();
    assert.deepEqual(await mine.locator('[data-end]').evaluateAll(buttons => buttons.map(button => button.dataset.end)), ['16:30', '17:00', '17:30'], `oldServer: ${oldServer}`);
    assert.deepEqual(await mine.locator('.time.now').evaluateAll(buttons => buttons.map(button => button.dataset.end)), ['16:30']);
    assert.equal(await mine.getByRole('button', { name: /^Soonest, 4:30 PM, frees 1 hr 30 min$/ }).count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('My reservations says exactly what a priority reservation or Admin changed', async () => {
  const mineItems = [
    reservation('short-1', '16:00', '17:00', { unit: 'room-2', notice: { kind: 'shortened', fromUnit: 'room-2', toUnit: 'room-2', toEnd: '17:00', byPurpose: 'contact' } }),
    reservation('moved-1', '18:00', '19:00', { unit: 'room-3', purpose: 'new-member', reservedFor: 'Sample Member', notice: { kind: 'moved', fromUnit: 'room-1', toUnit: 'room-3', toEnd: null, byPurpose: 'contact' } }),
    reservation('gone-1', '18:00', '19:00', { status: 'overridden', unit: null, notice: { kind: 'released', fromUnit: 'room-2', toUnit: null, toEnd: null, byPurpose: 'contact' } }),
    reservation('admin-1', '13:00', '14:00', { unit: 'room-4', status: 'cancelled', byAdmin: true }),
    reservation('self-1', '14:00', '15:00', { unit: 'room-4', status: 'cancelled' })
  ];
  const { page, errors, context, sheet } = await openApp('?view=mine', { fixture: schedule({ mine: mineItems }) });
  const mine = page.locator('#mine-sheet');
  await mine.getByRole('heading', { name: 'My reservations' }).waitFor();
  for (const text of [
    'A Contact reservation needed Room 2, so this reservation now ends at 5:00 PM.',
    'A Contact reservation needed Room 1, so this reservation moved to Room 3.',
    'A Contact reservation needed Room 2 and no other study room was free, so this reservation was replaced. Choose another time.',
    'Cancelled by Admin.',
    'Room 2 · Other: Planning',
    'Room 3 · New Member: Sample Member'
  ]) assert.equal(await mine.getByText(text, { exact: true }).count(), 1, text);
  assert.equal(await mine.locator('.badge', { hasText: 'Replaced' }).count(), 1);
  assert.deepEqual(await mine.locator('.group-title').allTextContents(), ['Active', 'Cancelled or replaced']);
  await mine.getByRole('button', { name: 'Reserve another time' }).click();
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  assert.deepEqual(await sheet.locator('.chips span').allTextContents(), [DAY_LABEL, 'Study room']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('My reservations ends a reservation early and the address follows the sheet', async () => {
  const { page, errors, context } = await openApp('?view=mine');
  const sheet = page.locator('#mine-sheet');
  await sheet.getByRole('heading', { name: 'My reservations' }).waitFor();
  assert.deepEqual(await sheet.locator('.group-title').allTextContents(), ['Active', 'Cancelled or replaced']);
  for (const status of ['Confirmed', 'Cancelled', 'Replaced']) assert.equal(await sheet.locator('.badge', { hasText: status }).count(), 1, status);
  await sheet.getByRole('button', { name: 'End early' }).click();
  await sheet.getByRole('button', { name: /^6:00 PM, frees / }).click();
  await sheet.getByRole('heading', { name: 'End at 6:00 PM?' }).waitFor();
  await sheet.getByRole('button', { name: 'End early' }).click();
  await sheet.getByText('Ended early. It was booked until 6:30 PM.').waitFor();
  assert.deepEqual((await lastCall(page, 'memberEndBookingEarly')).data, { bookingId: 'mine-1', end: '18:00' });

  // Opened by the address, it gives focus back to the My reservations link.
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.id === 'mine-link');
  assert.equal(new URL(page.url()).searchParams.has('view'), false);
  await page.getByRole('link', { name: 'My reservations' }).click();
  await sheet.getByRole('heading', { name: 'My reservations' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('view'), 'mine');
  await page.goBack();
  await sheet.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('tapping a reservation shows its details, with actions only on your own', async () => {
  const { page, errors, context } = await openApp();
  const details = page.locator('#details-sheet');
  await page.getByRole('button', { name: /^B John, Contact, Room 1/ }).click();
  await details.getByRole('heading', { name: 'Room 1' }).waitFor();
  assert.equal(await details.getByText('Sample Contact').count(), 1);
  assert.equal(await details.getByRole('button', { name: 'Cancel reservation' }).count(), 0);
  await page.keyboard.press('Escape');
  await details.waitFor({ state: 'hidden' });
  await page.locator('.type-button[data-type="whiteboard"]').click();
  await page.getByRole('button', { name: /, yours, / }).click();
  await details.getByRole('heading', { name: 'Board 2 (Large)' }).waitFor();
  await details.getByRole('button', { name: 'Cancel reservation' }).click();
  await details.getByRole('button', { name: 'Yes, cancel it' }).click();
  await details.waitFor({ state: 'hidden' });
  assert.deepEqual((await lastCall(page, 'memberCancelBooking')).data, { bookingId: 'mine-1' });
  await page.locator('[data-booking="mine-1"]').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('a cancel that fails after the reservation vanished closes the details and says why', async () => {
  const { page, errors, context } = await openApp();
  await page.evaluate(() => {
    window.__hooks.memberCancelBooking = (data, state) => {
      // An Admin cancelled it a moment earlier.
      state.bookings = state.bookings.filter(row => row.id !== data.bookingId);
      state.mine.find(row => row.id === data.bookingId).status = 'cancelled';
      throw { code: 'failed-precondition', message: 'This reservation was already cancelled or replaced.' };
    };
  });
  await page.locator('.type-button[data-type="whiteboard"]').click();
  await page.getByRole('button', { name: /, yours, / }).click();
  const details = page.locator('#details-sheet');
  await details.getByRole('button', { name: 'Cancel reservation' }).click();
  await details.getByRole('button', { name: 'Yes, cancel it' }).click();
  await details.waitFor({ state: 'hidden' });
  await page.locator('#announcer', { hasText: 'This reservation was already cancelled or replaced.' }).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('sheet-open')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('takeover: the preview names who is affected, follows the schedule, and sends the unit shown', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.locator('#reserve').click();
  await sheet.getByRole('button', { name: 'Contact', exact: true }).click();
  await sheet.getByRole('button', { name: '4:00 PM, Priority override' }).click();
  await sheet.getByRole('button', { name: /^5:00 PM, 1 hr, Priority override$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Contact name').fill('Sample Contact');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  const note = sheet.locator('.takeover-note');
  await note.getByText('Every study room is taken at this time, so you get Room 1.').waitFor();
  assert.deepEqual(await note.locator('p').allTextContents(), [
    'Priority override. Every study room is taken at this time, so you get Room 1.',
    'Dana’s reservation there (3:00 PM to 5:00 PM) will end at 4:00 PM.',
    'They see why in My reservations.'
  ]);
  // Dana's turns out to be New Member, so Room 2 (Other only) is taken instead.
  await page.evaluate(() => {
    window.__state.bookings.find(row => row.name === 'Dana').purpose = 'new-member';
    dispatchEvent(new Event('online'));
  });
  await note.getByText('Every study room is taken at this time, so you get Room 2.').waitFor();
  await sheet.getByText('The schedule changed while you were deciding. Check the details and confirm again.').waitFor();
  assert.equal(await note.getByText('Eli’s reservation there will be replaced, because no other study room is free.', { exact: true }).count(), 1);
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const { data } = await lastCall(page, 'memberSubmitBooking');
  assert.equal(data.allowTakeover, true);
  assert.equal(data.takeoverUnit, 'room-2');
  // Other has no priority, so the same full time is not offered.
  await sheet.getByRole('button', { name: 'Reserve something else', exact: true }).click();
  await sheet.getByRole('button', { name: 'Study room', exact: true }).click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await sheet.getByRole('button', { name: '1:00 PM', exact: true }).waitFor();
  assert.equal(await sheet.getByRole('button', { name: /^4:00 PM/ }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Force override: taken times appear only after the button, and the warning step sends forceOverride', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.locator('#reserve').click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  // Other has no priority, so 4 PM is not offered until Force override is on.
  await sheet.getByRole('button', { name: '1:00 PM', exact: true }).waitFor();
  assert.equal(await sheet.getByRole('button', { name: /^4:00 PM/ }).count(), 0);
  await sheet.getByRole('button', { name: 'Force override', exact: true }).click();
  await sheet.getByRole('button', { name: '4:00 PM, Force override' }).click();
  await sheet.getByRole('button', { name: /^5:00 PM, 1 hr, Force override$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Purpose').fill('Practice');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  const note = sheet.locator('.force-note');
  assert.deepEqual(await note.locator('p').allTextContents(), [
    'Force override. Room 1 is held by someone else at this time.',
    'Dana’s reservation there (3:00 PM to 5:00 PM) will end at 4:00 PM.',
    'They see why in My reservations.'
  ]);
  assert.equal(await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).count(), 0, 'no one-tap confirmation');
  await sheet.getByRole('button', { name: 'Force override', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Are you sure?' }).waitFor();
  await sheet.getByRole('button', { name: 'No, go back', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Confirm reservation' }).waitFor();
  await sheet.getByRole('button', { name: 'Force override', exact: true }).click();
  await sheet.getByRole('button', { name: 'Yes, override and reserve', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const { data } = await lastCall(page, 'memberSubmitBooking');
  assert.deepEqual([data.forceOverride, data.allowTakeover, data.takeoverUnit, data.requestedUnit], [true, true, 'room-1', null]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Force override from someone’s reservation keeps their unit and start', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.getByRole('button', { name: /^Fay, Contact, Room 3/ }).click();
  const details = page.locator('#details-sheet');
  await details.getByRole('button', { name: 'Force override', exact: true }).click();
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  await sheet.getByRole('button', { name: 'Contact', exact: true }).click();
  await sheet.getByRole('button', { name: /^5:00 PM, 1 hr, Force override$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Contact name').fill('Sample Contact');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByText('Fay’s reservation there will be replaced, because no other study room is free.', { exact: true }).waitFor();
  await sheet.getByRole('button', { name: 'Force override', exact: true }).click();
  await sheet.getByRole('button', { name: 'Yes, override and reserve', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const { data } = await lastCall(page, 'memberSubmitBooking');
  assert.deepEqual([data.forceOverride, data.takeoverUnit, data.requestedUnit, data.start], [true, 'room-3', 'room-3', '16:00']);
  // A hold and your own reservation offer no override.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Reserved, Room 4/ }).click();
  await details.getByRole('heading', { name: 'Room 4' }).waitFor();
  assert.equal(await details.getByRole('button', { name: 'Force override' }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Escape goes back a step, a double tap keeps the sheet open, and a stray tap keeps the draft', async () => {
  const { page, errors, context, sheet } = await openApp();
  // A double tap on an open time: the second tap lands outside the new sheet.
  const open = page.getByRole('button', slot('Room 3', '1:00 PM'));
  await open.evaluate(element => scrollBy(0, element.getBoundingClientRect().top - 200));
  const box = await open.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  assert.equal(await sheet.evaluate(dialog => dialog.open), true);
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await sheet.locator('[data-end]').first().click();
  await page.getByLabel('Your name').fill('Sam Sample');
  // Step 3: a tap outside, well after the sheet opened, keeps the sheet and what was typed.
  await page.clock.fastForward(1000);
  await page.mouse.click(10, 10);
  await sheet.getByRole('heading', { name: 'Your details' }).waitFor();
  assert.equal(await page.getByLabel('Your name').inputValue(), 'Sam Sample');
  await page.keyboard.press('Escape');
  await sheet.getByRole('heading', { name: 'End time' }).waitFor();
  await sheet.getByRole('heading', { name: 'End time' }).click();
  await page.keyboard.press('Escape');
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  // Step 1: a tap outside closes it.
  await page.mouse.click(10, 10);
  await sheet.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('an unknown schedule version asks for a reload, and never reloads by itself', async () => {
  const { page, errors, context } = await openApp();
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1; });
  await page.evaluate(() => {
    window.__hooks.memberSchedule = async () => ({ ...(await window.__server.memberSchedule()), version: 3 });
    dispatchEvent(new Event('online'));
  });
  await page.getByText('This page is out of date. Reload to update it.').waitFor();
  assert.equal(await page.locator('#status-pill').textContent(), 'Out of date');
  assert.equal(await page.locator('#reserve').isDisabled(), true);
  const loads = (await calls(page, 'memberSchedule')).length;
  await page.clock.fastForward(31000);
  await page.waitForFunction(count => window.__calls.filter(call => call.name === 'memberSchedule').length > count, loads);
  assert.equal(navigations, 0);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.locator('#reserve:not([disabled])').waitFor();
  assert.equal(navigations, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a stalled connection says so after 20 seconds', async () => {
  const { page, errors, context } = await newPage(harness.browser);
  // Never answers, like a captive portal or a stalled network.
  await context.route('**/firebasejs/**', () => {});
  await page.goto(`${harness.base}/`);
  await page.getByText('Loading the schedule…').waitFor();
  await page.clock.fastForward(21000);
  await page.getByText('The schedule is taking too long to load. Check your connection, then reload.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reload', exact: true }).count(), 1);
  assert.equal(await page.locator('#reserve').isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('offline pauses reservations until the connection returns', async () => {
  const { page, errors, context, sheet } = await openApp();
  await page.locator('#reserve').click();
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.getByText('You’re offline. The schedule will update when you reconnect.').waitFor();
  const retry = sheet.locator('.sheet-status').getByRole('button', { name: 'Try again' });
  assert.ok((await retry.boundingBox()).height >= 44, 'Try again is easy to tap');
  assert.equal(await page.locator('#reserve').isDisabled(), true);
  assert.equal(await page.locator('.open-slot').count(), 0);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.getElementById('reserve').disabled);
  await sheet.locator('.sheet-status').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('long and hostile names stay text and fit a 320-pixel screen', async () => {
  const LONG = 'Zebulonathaniel'.repeat(8);
  const HOSTILE = '<img src=x onerror="window.__pwned=1">';
  const bookings = [
    row('room-3', '13:00', '13:30', LONG, 'other', { reservedFor: HOSTILE }),
    row('room-4', '13:00', '15:00', HOSTILE, 'new-member', { reservedFor: LONG }),
    row('room-1', '13:00', '14:00', LONG, 'other', { id: 'own', mine: true, reservedFor: LONG })
  ];
  const mine = [reservation('own', '13:00', '14:00', { name: LONG, reservedFor: HOSTILE })];
  const { page, errors, context, sheet } = await openApp('', { fixture: schedule({ bookings, mine }), width: 320, height: 640 });
  await page.getByText(HOSTILE, { exact: true }).first().waitFor();
  assert.equal(await fitsWidth(page), true, 'schedule');
  // A 30-minute block keeps the start of a long name.
  const short = await page.locator('[data-booking="room-3-13:00"]').evaluate(block => {
    const name = block.querySelector('.booking-name');
    return { clipped: name.getBoundingClientRect().top < block.getBoundingClientRect().top - 0.5, text: name.textContent };
  });
  assert.deepEqual(short, { clipped: false, text: LONG });
  await page.locator('[data-booking="room-4-13:00"]').click();
  const details = page.locator('#details-sheet');
  await details.getByText(LONG, { exact: true }).waitFor();
  assert.equal(await fitsWidth(page), true, 'details');
  assert.equal(await details.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
  await details.getByRole('button', { name: 'Close' }).click();
  await page.locator('#mine-link').click();
  const mineSheet = page.locator('#mine-sheet');
  await mineSheet.getByText(`Room 1 · Other: ${HOSTILE}`, { exact: true }).waitFor();
  assert.equal(await mineSheet.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, 'My reservations');
  await mineSheet.getByRole('button', { name: 'Close' }).click();
  await mineSheet.waitFor({ state: 'hidden' });
  await page.getByRole('button', slot('Room 2', '1:00 PM')).click();
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await sheet.locator('[data-end]').first().click();
  await page.getByLabel('Your name').fill(LONG);
  await page.getByLabel('Purpose').fill(HOSTILE);
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Confirm reservation' }).waitFor();
  assert.equal(await sheet.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, 'confirmation');
  assert.equal(await page.evaluate(() => window.__pwned ?? null), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a focused time on a phone is never hidden under the sticky header or the Reserve bar', async () => {
  const { page, errors, context } = await openApp();
  await page.locator('.type-button[data-type="tv"]').focus();
  const hidden = [];
  let focused = 0;
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab');
    const place = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element.closest('#grid')) return null;
      const box = element.getBoundingClientRect();
      const top = document.querySelector('.board-top').getBoundingClientRect().bottom;
      const bottom = document.querySelector('.reserve-bar').getBoundingClientRect().top;
      return { key: element.dataset.key, covered: box.top < top - 1 || box.bottom > bottom + 1 };
    });
    if (!place) continue;
    focused += 1;
    if (place.covered) hidden.push(place.key);
  }
  assert.ok(focused > 20, `only ${focused} times were focused`);
  assert.deepEqual(hidden, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('every sheet step passes an accessibility check', async () => {
  const { page, errors, context, sheet } = await openApp();
  const found = [];
  const check = async label => found.push(...await seriousAxe(page, 'dialog[open]', label));
  await page.locator('#reserve').click();
  await sheet.getByRole('heading', { name: 'What is it for?' }).waitFor();
  await check('purpose');
  await sheet.getByRole('button', { name: 'Other', exact: true }).click();
  await check('start');
  await sheet.getByRole('button', { name: '1:00 PM', exact: true }).click();
  await check('end');
  await sheet.getByRole('button', { name: /^2:00 PM, 1 hr$/ }).click();
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByText('Enter your name.').waitFor();
  await check('names with an error');
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Purpose').fill('Study');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Confirm reservation' }).waitFor();
  await check('confirm');
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  await check('done');
  await sheet.getByRole('button', { name: 'Reserve something else', exact: true }).click();
  await sheet.getByRole('heading', { name: 'What do you need?' }).waitFor();
  await check('type');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await sheet.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: /^B John, Contact, Room 1/ }).click();
  await page.locator('#details-sheet').getByRole('heading', { name: 'Room 1' }).waitFor();
  await check('details');
  await page.locator('#details-sheet').getByRole('button', { name: 'Close' }).click();
  await page.locator('.type-button[data-type="whiteboard"]').click();
  await page.getByRole('button', { name: /, yours, / }).click();
  await page.locator('#details-sheet').getByRole('button', { name: 'Cancel reservation' }).click();
  await check('details, cancel');
  await page.locator('#details-sheet').getByRole('button', { name: 'Close' }).click();

  const mine = page.locator('#mine-sheet');
  await page.locator('#mine-link').click();
  await mine.getByRole('heading', { name: 'My reservations' }).waitFor();
  await check('My reservations');
  await mine.locator('[data-key="end-mine-1"]').click();
  await check('end early');
  await mine.getByRole('button', { name: /^6:00 PM, frees / }).click();
  await check('end early, confirm');
  await mine.getByRole('button', { name: 'Back', exact: true }).first().click();
  await mine.getByRole('button', { name: 'Back', exact: true }).first().click();
  await mine.locator('[data-key="cancel-mine-1"]').click();
  await mine.getByRole('heading', { name: 'Cancel this reservation?' }).waitFor();
  await check('cancel');
  assert.deepEqual(found, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('demo mode follows the server rules: short names, takeovers and no daily limit', async () => {
  const { page, errors, context } = await newPage(harness.browser);
  await context.route('**/firebasejs/**', route => route.abort());
  await page.goto(`${harness.base}/?demo=1`);
  await page.getByText('Demo mode: a sample schedule').waitFor();
  const sheet = page.locator('#booking-sheet');
  // Fill every room from 5:30 to 6:00 PM today; Casey's sample reservation holds Room 4.
  const book = async (unit, time, end, name) => {
    await page.getByRole('button', slot(unit, time, TODAY)).click();
    await sheet.getByRole('button', { name: 'Other', exact: true }).click();
    await sheet.getByRole('button', { name: new RegExp(`^${end}, `) }).click();
    await page.getByLabel('Your name').fill(name);
    await page.getByLabel('Purpose').fill('Practice');
    await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
    await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
    await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await sheet.waitFor({ state: 'hidden' });
  };
  await book('Room 1', '4:00 PM', '6:00 PM', 'Sister Pat Sample');
  await book('Room 2', '5:00 PM', '6:00 PM', 'Bro. Sam Lee');
  await book('Room 3', '5:00 PM', '6:00 PM', 'Sis. Pat Lee');
  for (const name of [/^S Pat S, yours, Other, Room 1/, /^B Sam, yours, Other, Room 2/, /^S Pat L, yours, Other, Room 3/]) {
    await page.getByRole('button', { name }).waitFor();
  }
  // A Contact reservation takes Room 1; the practice one there began earlier, so it is shortened.
  await page.locator('#reserve').click();
  await sheet.getByRole('button', { name: 'Contact', exact: true }).click();
  await sheet.getByRole('button', { name: '5:30 PM, Priority override' }).click();
  await sheet.getByRole('button', { name: /^6:00 PM, 30 min, Priority override$/ }).click();
  await page.getByLabel('Your name').fill('Quinn Sample');
  await page.getByLabel('Contact name').fill('Sample Contact');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByText('Your reservation there (4:00 PM to 6:00 PM) will end at 5:30 PM.', { exact: true }).waitFor();
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^S Pat S, yours, Other, Room 1, 4:00 PM to 5:30 PM$/ }).waitFor();
  await page.getByRole('button', { name: /^Quinn, yours, Contact, Room 1, 5:30 PM to 6:00 PM/ }).waitFor();
  // A device may make a fifth reservation on the same day.
  await book('Room 2', '9:00 PM', '9:30 PM', 'Bro. Sam Lee');
  await book('Room 3', '9:00 PM', '9:30 PM', 'Bro. Sam Lee');
  await page.getByRole('link', { name: 'My reservations' }).click();
  await page.locator('#mine-sheet').getByText('A Contact reservation needed Room 1, so this reservation now ends at 5:30 PM.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('srs-name')), null, 'a practice name is never kept');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the demo shortens names like the server', () => {
  const names = ['Brother John Smith', 'Sister Mary Lee', 'B. John Smith', 'S Mary', 'Elder Sam Park', 'Pastor Ana Cruz', 'John', 'john smith',
    'Deaconess Ruth A.', 'Missionary Lee Kim'];
  // Owner decision 3 (title abbreviations, a name that is only a title); a
  // server from before it shortens these differently.
  const newer = ['Bro. John Smith', 'Sis. Mary Lee', 'bro John', 'Brother', 'Bro.', 'Sister,', 'B'];
  if (publicName('Bro. John Smith') === 'B John') names.push(...newer);
  const others = [[], ['Sister John Lee'], ['Brother John Smith', 'John Smyth'], ['Ruth B'], ['Ruth A.'], ['Sister Mary Park']];
  for (const name of names) {
    for (const pool of others) assert.equal(shortName(name, pool), publicName(name, pool), `${name} with ${pool.join(', ')}`);
  }
  // Title abbreviations, and a name that is only a title (owner decision 3).
  assert.equal(shortName('Bro. John Smith'), 'B John');
  assert.equal(shortName('Sis. Mary Lee'), 'S Mary');
  assert.equal(shortName('Sis. Pat Lee', ['Sister Pat Sample']), 'S Pat L');
  assert.equal(shortName('Brother'), 'Brother');
});

// A refresh held back while a word is being composed, and stale markup after
// it, never drop letters typed in the meantime (shared/dom.js paint).
test('a background repaint never drops letters being typed', async () => {
  const { context, page, errors } = await newPage(harness.browser, { now: null });
  await page.goto(`${harness.base}/index.html?demo=1`);
  await page.evaluate(async () => {
    const { paint } = await import('/shared/dom.js');
    const region = document.createElement('div');
    document.body.append(region);
    window.__render = value => paint(region, `<input aria-label="Name" data-key="name" value="${value}">`);
    window.__render('');
  });
  const input = page.getByLabel('Name', { exact: true });
  await input.focus();
  await page.keyboard.type('Jon');
  const client = await context.newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'a', selectionStart: 1, selectionEnd: 1 });
  await page.evaluate(() => window.__render('Jon'));
  await client.send('Input.insertText', { text: 'athan' });
  await page.evaluate(() => window.__render('Jon'));
  assert.equal(await input.inputValue(), 'Jonathan');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.key), 'name');
  assert.deepEqual(errors, []);
  await context.close();
});

// The final review's case: the answer is lost but the room was booked, and the
// member's own new reservation then makes the same draft look like a takeover.
// The page must recognise its reservation, never send a second one.
test('a reservation made behind a lost answer is recognised, not booked again as a takeover', async () => {
  const others = ['room-1', 'room-2', 'room-3'].map(unit => row(unit, '17:00', '18:00', 'Avery', 'other', { reservedFor: 'Study' }));
  const { page, errors, context, sheet } = await openApp('', { fixture: schedule({ bookings: others, mine: [] }) });
  await page.locator('#reserve').click();
  await sheet.getByRole('button', { name: 'Contact', exact: true }).click();
  await sheet.getByRole('button', { name: '5:00 PM', exact: true }).click();
  await sheet.getByRole('button', { name: /^6:00 PM, 1 hr$/ }).click();
  await page.getByLabel('Your name').fill('Sam Sample');
  await page.getByLabel('Contact name').fill('Pat Visitor');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Confirm reservation' }).waitFor();
  assert.equal(await sheet.locator('.takeover-note').count(), 0, 'Room 4 is free, so no takeover');
  await page.evaluate(() => {
    window.__hooks.memberSubmitBooking = data => {
      delete window.__hooks.memberSubmitBooking;
      window.__server.memberSubmitBooking({ ...data, requestedUnit: 'room-4' });
      throw { code: 'unavailable', message: 'unavailable' };
    };
    window.__hooks.memberSchedule = () => {
      delete window.__hooks.memberSchedule;
      throw { code: 'unavailable', message: 'unavailable' };
    };
  });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByText('We couldn’t confirm the reservation. Check your connection, then try again.').waitFor();
  await sheet.locator('.sheet-status').getByRole('button', { name: 'Try again' }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  assert.equal((await calls(page, 'memberSubmitBooking')).length, 1, 'nothing was sent again');
  assert.deepEqual(await page.evaluate(() => window.__state.bookings.filter(item => item.start === '17:00').map(item => `${item.unit}:${item.name}`)),
    ['room-1:Avery', 'room-2:Avery', 'room-3:Avery', 'room-4:Sam'], 'nobody was displaced');
  assert.deepEqual(errors, []);
  await context.close();
});

// The answer is lost while the server is still saving, so the reload that
// follows fails and the next one comes back without the reservation. The
// member then fixes a typo in their name and confirms again: the page must
// send the same request id, so the server answers with the first reservation.
test('after a lost answer, editing the name and confirming again books once', async () => {
  const { page, errors, context, sheet } = await openApp();
  await tapToConfirm(page, sheet, 'Room 2', '1:00 PM');
  await page.evaluate(() => {
    window.__hooks.memberSubmitBooking = data => {
      delete window.__hooks.memberSubmitBooking;
      window.__saveLate = () => window.__server.memberSubmitBooking(data);
      throw { code: 'unavailable', message: 'unavailable' };
    };
    window.__hooks.memberSchedule = () => {
      delete window.__hooks.memberSchedule;
      throw { code: 'unavailable', message: 'unavailable' };
    };
  });
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByText('We couldn’t confirm the reservation. Check your connection, then try again.').waitFor();
  await sheet.locator('.sheet-status').getByRole('button', { name: 'Try again' }).click();
  await sheet.locator('.sheet-status').waitFor({ state: 'detached' });
  assert.equal(await sheet.getByRole('heading', { name: 'Confirm reservation' }).count(), 1, 'the reload did not show it yet');
  await page.evaluate(() => window.__saveLate());
  await sheet.getByRole('button', { name: 'Back' }).click();
  await page.getByLabel('Your name').fill('Sam Sampel');
  await sheet.getByRole('button', { name: 'Continue', exact: true }).click();
  await sheet.getByRole('button', { name: 'Confirm reservation', exact: true }).click();
  await sheet.getByRole('heading', { name: 'Reservation confirmed' }).waitFor();
  const ids = (await calls(page, 'memberSubmitBooking')).map(call => call.data.requestId);
  assert.equal(ids.length, 2);
  assert.equal(ids[1], ids[0], 'the edited retry sends the same request id');
  assert.equal(await page.evaluate(() => window.__state.mine.filter(item => item.id.startsWith('new-')).length), 1, 'exactly one reservation');
  assert.deepEqual(errors, []);
  await context.close();
});
