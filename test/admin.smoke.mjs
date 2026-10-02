// Admin page in a real browser, against a fake Firebase. The PIN and every
// name are fictional.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { start, newPage, lastCall, fitsWidth } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const { bookableDates, dayInfo, todayAt } = require('../functions/lib/schedule.js');
const { clientConfig } = require('../functions/lib/views.js');

const days = bookableDates().map(dayInfo);
// A booking day other than today, so no time used below has passed. The
// times are clear of services on both Tuesday and Saturday.
const DAY = days.find(day => day.date !== todayAt()).date;
const assignments = units => ({ room: null, whiteboard: null, tv: null, ...units });
const needs = units => ({ room: 'room' in units, whiteboard: 'whiteboard' in units, tv: 'tv' in units });
const record = (id, units, fields) => ({ id, date: DAY, needs: needs(units), assignments: assignments(units), ownerUid: null, ...fields });

const FIXTURE = {
  config: clientConfig(),
  days,
  bookings: [
    record('r1', { room: 'room-1' }, { start: '11:00', end: '12:30', name: 'Brother John Smith', purpose: 'contact', reservedFor: 'Sample Contact', status: 'approved', ownerUid: 'device-x' }),
    record('r2', { room: 'room-3' }, { start: '13:00', end: '14:00', name: 'Grace Park', purpose: 'other', reservedFor: 'Study', status: 'cancelled', ownerUid: 'device-y' }),
    record('r3', { room: 'room-2' }, { start: '12:00', end: '13:00', name: 'Deep clean', purpose: 'blocked', reservedFor: '', status: 'approved' }),
    record('r4', { whiteboard: 'wb-2' }, { start: '16:00', end: '17:00', name: 'Avery Example', purpose: 'other', reservedFor: 'Planning', status: 'approved', ownerUid: 'device-z' })
  ],
  notes: { r3: 'Staff only' }
};

const BACKEND = `(() => {
  const state = ${JSON.stringify(FIXTURE)};
  window.__state = state;
  const refuse = (code, message) => Object.assign(new Error(message), { code });
  return async (name, data) => {
    if (name === 'adminStartSession') {
      if (data.pin !== '2468') throw refuse('permission-denied', 'That PIN is not correct.');
      return { sessionToken: 'fixture-session-token-0123456789-abcdef', expiresAt: Date.now() + (window.__sessionMs || 1200000) };
    }
    if (!data.sessionToken) throw refuse('permission-denied', 'Admin is locked.');
    if (window.__endSession) throw refuse('permission-denied', 'Your Admin session ended. Enter the PIN again.');
    if (name === 'adminEndSession') return { ok: true };
    if (name === 'adminSchedule') return { config: state.config, days: state.days, bookings: structuredClone(state.bookings) };
    if (name === 'adminNoteAction') {
      if (data.action === 'read') return { notes: Object.fromEntries(data.bookingIds.filter(id => state.notes[id]).map(id => [id, state.notes[id]])) };
      state.notes[data.bookingId] = data.note;
      return { ok: true };
    }
    const booking = state.bookings.find(item => item.id === data.bookingId);
    if (data.action === 'add') {
      state.bookings.push({ id: 'added', ...data.booking, needs: { room: true, whiteboard: false, tv: false }, status: 'approved', ownerUid: null });
      return { id: 'added' };
    }
    if (data.action === 'cancel') booking.status = 'cancelled';
    if (data.action === 'restore') Object.assign(booking, { status: 'approved', assignments: { ...booking.assignments, ...data.assignments } });
    if (data.action === 'end-early') Object.assign(booking, { endedEarlyFrom: booking.end, end: data.end });
    if (data.action === 'remove-old') return { removed: 3, more: false };
    return { ok: true };
  };
})()`;

let harness;
before(async () => { harness = await start(); });
after(async () => harness?.stop());

async function unlocked() {
  const session = await newPage(harness.browser, { width: 1280, height: 900, backend: BACKEND });
  const { page } = session;
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${harness.base}/admin/`);
  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator(`[data-date="${DAY}"]`).click();
  await page.getByRole('heading', { name: /^Reservations on / }).waitFor();
  return session;
}

const entry = (page, name) => page.locator('.entry', { hasText: name });

test('a wrong PIN is refused and the right one opens the day', async () => {
  const { page, errors, context } = await newPage(harness.browser, { backend: BACKEND });
  await page.goto(`${harness.base}/admin/`);
  await page.getByLabel('Admin PIN').fill('1111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('That PIN is not correct.').waitFor();
  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator(`[data-date="${DAY}"]`).click();
  await entry(page, 'Brother John Smith').getByText('Room 1 · Contact · Contact name: Sample Contact · Made by a member').waitFor();
  await entry(page, 'Deep clean').getByText('Note: Staff only').waitFor();
  assert.equal(await entry(page, 'Grace Park').locator('.badge').textContent(), 'Cancelled');
  assert.equal(await page.locator('.map-booking', { hasText: 'Brother John Smith' }).count(), 1);
  assert.equal(await fitsWidth(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('adding a booking sends the chosen units and times', async () => {
  const { page, errors, context } = await unlocked();
  const form = page.locator('[data-form="add"]');
  await form.getByLabel('Name', { exact: true }).fill('Hold for cleaning');
  await form.getByLabel('For').selectOption('blocked');
  await form.getByLabel('Reason (private)').fill('Carpet');
  await form.getByLabel('Start').selectOption('13:00');
  await form.getByLabel('End').selectOption('14:00');
  assert.equal(await form.getByRole('checkbox', { name: /Room 1/ }).isDisabled(), false);
  await form.getByRole('checkbox', { name: 'Room 3' }).check();
  await form.getByLabel('Private note (optional)').fill('Vacuum');
  await form.getByRole('button', { name: 'Add reservation' }).click();
  await page.getByText('Reservation added for Hold for cleaning.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data.booking, {
    date: DAY, start: '13:00', end: '14:00', name: 'Hold for cleaning', purpose: 'blocked',
    reservedFor: 'Carpet', note: 'Vacuum', assignments: { room: 'room-3' }
  });
  assert.deepEqual(errors, []);
  await context.close();
});

test('cancel, end early, restore and notes each reach the server', async () => {
  const { page, errors, context } = await unlocked();
  await entry(page, 'Brother John Smith').getByRole('button', { name: 'Cancel' }).click();
  await page.getByText('Brother John Smith\'s reservation was cancelled.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data, { sessionToken: 'fixture-session-token-0123456789-abcdef', action: 'cancel', bookingId: 'r1' });

  await entry(page, 'Avery Example').getByRole('button', { name: 'End early' }).click();
  await entry(page, 'Avery Example').getByLabel('New end time').selectOption('16:30');
  await entry(page, 'Avery Example').getByRole('button', { name: 'Save' }).click();
  await entry(page, 'Avery Example').getByText('Ended early; it was booked until 5:00 PM.').waitFor();

  await entry(page, 'Grace Park').getByRole('button', { name: 'Restore' }).click();
  assert.equal(await entry(page, 'Grace Park').getByLabel('Study room').inputValue(), 'room-3', 'its previous room is suggested');
  await entry(page, 'Grace Park').getByRole('button', { name: 'Restore' }).last().click();
  await page.getByText('Grace Park\'s reservation is confirmed again.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data.assignments, { room: 'room-3' });

  await entry(page, 'Avery Example').getByRole('button', { name: 'Add note' }).click();
  await entry(page, 'Avery Example').getByLabel(/Private note/).fill('Brings own markers');
  await entry(page, 'Avery Example').getByRole('button', { name: 'Save note' }).click();
  await entry(page, 'Avery Example').getByText('Note: Brings own markers').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('a background refresh keeps what the Admin picked in an open form', async () => {
  const { page, errors, context } = await unlocked();
  const row = entry(page, 'Avery Example');
  await row.getByRole('button', { name: 'End early' }).click();
  await row.getByLabel('New end time').selectOption('16:30');
  await page.evaluate(() => { window.__state.bookings[0].name = 'Brother John Smith Jr'; });
  await page.locator('.entry-name', { hasText: 'Brother John Smith Jr' }).waitFor({ timeout: 20000 });
  assert.equal(await row.getByLabel('New end time').inputValue(), '16:30');
  assert.deepEqual(errors, []);
  await context.close();
});

test('removing old records reports how many went', async () => {
  const { page, errors, context } = await unlocked();
  await page.getByRole('button', { name: 'Remove old records' }).click();
  await page.getByText('Removed 3 old records.').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('Lock, an ended session and an expired session all return to the PIN', async () => {
  const { page, errors, context } = await unlocked();
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByRole('heading', { name: 'Admin is locked' }).waitFor();
  assert.equal((await lastCall(page, 'adminEndSession')).name, 'adminEndSession');

  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('heading', { name: /^Reservations on/ }).waitFor();
  await page.evaluate(() => { window.__endSession = true; });
  await page.getByText('Your Admin session ended. Enter the PIN again.').waitFor({ timeout: 20000 });

  await page.evaluate(() => { window.__endSession = false; window.__sessionMs = 1500; });
  await page.getByLabel('Admin PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('heading', { name: 'Admin is locked' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});
