// Admin page in a real browser, against a fake Firebase that answers like the
// Cloud Functions: Admin rows, a session that stays open until 20 minutes
// pass without a change, and refusals in the server's words. Pages run on the
// fixed test clock (Saturday, Oct 3, 2026, 9:00 AM in Los Angeles); time only
// moves on when a test moves it. The PIN and every name are fictional.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { start, newPage, lastCall, fitsWidth, TEST_NOW } from './support/harness.mjs';

const require = createRequire(import.meta.url);
const { bookableDates, dayInfo } = require('../functions/lib/schedule.js');
const { clientConfig } = require('../functions/lib/views.js');

// The rules adminSchedule sends, with the fields the contract adds filled in
// for a functions/ that does not send them yet.
const CONFIG = {
  windowDays: 4, hold: 'blocked', nameMax: 120, noteMax: 1000, holdReasonMax: 240, keepDays: 56, sessionMinutes: 20,
  ...clientConfig()
};
const DAYS = bookableDates(TEST_NOW).map(dayInfo);
const TODAY = '2026-10-03'; // Saturday; 9:00 AM on the test clock
const DAY = '2026-10-06'; // Tuesday; nothing on it has passed
const TYPES = Object.keys(CONFIG.resources);
const MINUTE = 60 * 1000;
const TOKEN = 'fixture-session-token-0123456789-abcdef';
const EXPIRED = 'Admin locked after 20 minutes without changes. Enter the PIN to continue.';

// A row as adminSchedule sends it. `units` maps each needed type to its unit
// (null when it has none).
function row(id, units, fields = {}) {
  const needs = Object.fromEntries(TYPES.map(type => [type, type in units]));
  const assignments = Object.fromEntries(TYPES.map(type => [type, units[type] ?? null]));
  const status = fields.status ?? 'approved';
  const missing = TYPES.filter(type => needs[type] && !assignments[type]);
  return {
    id, date: DAY, start: '11:00', end: '12:00', name: 'Sample Person', purpose: 'other', reservedFor: '',
    needs, assignments, status, byMember: false, endedEarlyFrom: null, notice: null, byAdmin: false, note: '',
    restorable: status !== 'approved' || missing.length > 0, missing, createdAt: null,
    ...fields
  };
}

function fixture(extra = [], changes = {}) {
  return {
    config: CONFIG,
    days: DAYS,
    bookings: [
      row('r1', { room: 'room-1' }, { start: '11:00', end: '12:30', name: 'Brother John Smith', purpose: 'contact', reservedFor: 'Sample Contact', byMember: true }),
      row('r2', { room: 'room-3' }, { start: '13:00', end: '14:00', name: 'Grace Park', reservedFor: 'Study', status: 'cancelled', byMember: true }),
      row('r3', { room: 'room-2' }, { start: '12:00', end: '13:00', name: 'Deep clean', purpose: 'blocked', note: 'Staff only' }),
      row('r4', { whiteboard: 'wb-2' }, { start: '16:00', end: '17:00', name: 'Avery Example', reservedFor: 'Planning', byMember: true }),
      ...extra
    ],
    removeBatches: [3],
    ...changes
  };
}

// Runs in the page. Each answer is worked out first and then, when a test
// holds that call (window.__hold), sent late, like a slow connection. Rows
// get `ended` and `earlyEnds` worked out at the server's time, unless a row
// sets them itself. `legacy` answers like the server before the contract:
// none of the newer row fields, notes through a separate read, and no
// expiresInMs.
const backend = state => `(() => {
  const state = ${JSON.stringify(state)};
  const SESSION_MS = ${20 * MINUTE};
  const TOKEN = ${JSON.stringify(TOKEN)};
  const LOCKED_OUT = 'Too many PIN attempts. Wait 15 minutes and try again.';
  Object.assign(window, { __state: state, __hold: {}, __refuse: {}, __skew: 0, __computed: [], __answered: [], __kill: false, __failSchedule: false });
  let session = null;
  let wrongPins = 0;
  const serverNow = () => Date.now() - window.__skew;
  const refuse = (code, message) => Object.assign(new Error(message), { code });
  const types = Object.keys(state.config.resources);
  const unitName = id => types.flatMap(type => state.config.resources[type].units).find(unit => unit.id === id)?.name;
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const slide = () => {
    session.expiresAt = serverNow() + SESSION_MS;
    return state.legacy ? {} : { expiresInMs: SESSION_MS };
  };
  const settle = record => {
    record.missing = types.filter(type => record.needs[type] && !record.assignments[type]);
    record.restorable = record.status !== 'approved' || record.missing.length > 0;
  };
  // The church's date and minute at the server's time.
  const clock = () => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: state.config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(serverNow()));
    const part = type => parts.find(item => item.type === type).value;
    return { date: part('year') + '-' + part('month') + '-' + part('day'), minutes: Number(part('hour')) * 60 + Number(part('minute')) };
  };
  const timeOf = value => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  const timing = record => {
    if ('earlyEnds' in record || !record.start || !record.end) return record;
    const now = clock();
    const ended = record.date < now.date || (record.date === now.date && minutes(record.end) <= now.minutes);
    const earliest = record.date > now.date ? 0 : Math.ceil(now.minutes / 30) * 30;
    const earlyEnds = [];
    if (record.status === 'approved' && !ended) {
      for (let end = minutes(record.start) + 30; end < minutes(record.end); end += 30) if (end >= earliest) earlyEnds.push(timeOf(end));
    }
    return { ...record, ended, earlyEnds };
  };
  const rows = () => structuredClone(state.bookings).map(record => {
    if (!state.legacy) return timing(record);
    const { note, byMember, restorable, missing, byAdmin, ended, earlyEnds, ...older } = record;
    return { ...older, ownerUid: byMember ? 'device-x' : null };
  });

  function answer(name, data) {
    if (name === 'adminStartSession') {
      if (wrongPins > 5) throw refuse('resource-exhausted', LOCKED_OUT);
      if (data.pin !== '2468') {
        wrongPins += 1;
        throw wrongPins > 5 ? refuse('resource-exhausted', LOCKED_OUT) : refuse('permission-denied', 'That PIN is not correct.');
      }
      session = {};
      const left = slide();
      return { sessionToken: TOKEN, expiresAt: session.expiresAt, ...left };
    }
    if (window.__kill) session = null;
    if (!session || data.sessionToken !== TOKEN || session.expiresAt <= serverNow()) {
      session = null;
      throw refuse('permission-denied', 'Your Admin session ended. Enter the PIN again.');
    }
    if (name === 'adminEndSession') {
      session = null;
      return { ok: true };
    }
    if (name === 'adminSchedule') {
      if (window.__failSchedule) throw refuse('unavailable', 'The service is unavailable.');
      return { config: state.config, days: state.days, bookings: rows() };
    }
    if (name === 'adminNoteAction' && data.action === 'read') {
      return { notes: Object.fromEntries(state.bookings.filter(item => data.bookingIds.includes(item.id) && item.note).map(item => [item.id, item.note])) };
    }
    const record = state.bookings.find(item => item.id === data.bookingId);
    if (name === 'adminNoteAction') {
      record.note = data.note.trim();
      return { ok: true, ...slide() };
    }
    if (data.action === 'add') {
      const booking = data.booking;
      const id = 'added-' + state.bookings.length;
      const added = {
        id, date: booking.date, start: booking.start, end: booking.end, name: booking.name.trim(), purpose: booking.purpose,
        reservedFor: booking.reservedFor.trim(), needs: Object.fromEntries(types.map(type => [type, Boolean(booking.assignments[type])])),
        assignments: Object.fromEntries(types.map(type => [type, booking.assignments[type] || null])), status: 'approved',
        byMember: false, endedEarlyFrom: null, notice: null, byAdmin: false, note: booking.note.trim(), createdAt: serverNow()
      };
      settle(added);
      state.bookings.push(added);
      return { id, ...slide() };
    }
    if (data.action === 'cancel') {
      if (record.status !== 'approved') throw refuse('failed-precondition', 'This reservation was already cancelled or replaced.');
      Object.assign(record, { status: 'cancelled', byAdmin: true, notice: null });
      settle(record);
      return { ok: true, ...slide() };
    }
    if (data.action === 'end-early') {
      Object.assign(record, { endedEarlyFrom: record.endedEarlyFrom || record.end, end: data.end });
      return { end: data.end, ...slide() };
    }
    if (data.action === 'restore') {
      for (const [type, unit] of Object.entries(data.assignments)) {
        const holder = state.bookings.find(other => other.id !== record.id && other.status === 'approved' && other.date === record.date
          && other.assignments[type] === unit && minutes(other.start) < minutes(record.end) && minutes(record.start) < minutes(other.end));
        if (holder) throw refuse('already-exists', unitName(unit) + ' is already reserved by ' + holder.name + ' at that time.');
      }
      Object.assign(record, { status: 'approved', assignments: { ...record.assignments, ...data.assignments }, notice: null, byAdmin: false });
      settle(record);
      return { ok: true, ...slide() };
    }
    if (data.action === 'remove-old') {
      const removed = state.removeBatches.shift() ?? 0;
      return { removed, more: state.removeBatches.length > 0, ...slide() };
    }
    throw refuse('invalid-argument', 'Unknown Admin action.');
  }

  return async (name, data) => {
    const key = name + ':' + (data.action || '');
    try {
      const refusal = window.__refuse[key];
      if (refusal) {
        delete window.__refuse[key];
        throw refuse(refusal.code, refusal.message);
      }
      let result;
      let failure;
      try { result = answer(name, data); } catch (error) { failure = error; }
      window.__computed.push(key);
      if (window.__hold[key]) await window.__hold[key];
      if (failure) throw failure;
      return result;
    } finally {
      window.__answered.push(key);
    }
  };
})()`;

let harness;
before(async () => { harness = await start(); });
after(async () => harness?.stop());

const formatDay = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const entry = (page, name) => page.locator('.entry', { hasText: name });
const answered = (page, key) => page.evaluate(callKey => window.__answered.filter(item => item === callKey).length, key);
const calls = (page, name, action) => page.evaluate(([callName, callAction]) => window.__calls.filter(call => call.name === callName && (!callAction || call.data.action === callAction)).length, [name, action]);
// Lets the page finish what an answer started before a test looks for what
// must not be there.
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
const focusedKey = page => page.evaluate(() => document.activeElement?.dataset.key || document.activeElement?.id || document.activeElement?.tagName);

async function unlock(page, pin = '2468') {
  await page.getByLabel('Admin PIN').fill(pin);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

async function openAdmin({ state = fixture(), width = 1280, height = 900, now, open = true, day = DAY } = {}) {
  const session = await newPage(harness.browser, { width, height, backend: backend(state), now });
  await session.page.goto(`${harness.base}/admin/`);
  if (open) {
    await unlock(session.page);
    await session.page.locator(`[data-date="${day}"]`).click();
    await session.page.getByRole('heading', { name: `Reservations on ${formatDay(day)}` }).waitFor();
  }
  return session;
}

// Moves the clock to the next automatic refresh and waits for its answer.
async function refreshNow(page) {
  const before = await answered(page, 'adminSchedule:');
  await page.clock.fastForward(30000);
  await page.waitForFunction(count => window.__answered.filter(item => item === 'adminSchedule:').length > count, before);
  await settle(page);
}

test('Admin refreshes every 30 seconds and pauses while the page is hidden', async () => {
  const { page, errors, context } = await openAdmin();
  const before = await answered(page, 'adminSchedule:');
  await page.clock.fastForward(15000);
  assert.equal(await answered(page, 'adminSchedule:'), before);
  await page.clock.fastForward(15000);
  await page.waitForFunction(count => window.__answered.filter(item => item === 'adminSchedule:').length > count, before);
  const afterRefresh = await answered(page, 'adminSchedule:');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(60000);
  assert.equal(await answered(page, 'adminSchedule:'), afterRefresh, 'hidden time does not trigger polling');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(count => window.__answered.filter(item => item === 'adminSchedule:').length > count, afterRefresh);
  assert.deepEqual(errors, []);
  await context.close();
});

// Waits until the server has worked out an answer to `key` (more than
// `count` of them), whether or not it is held.
const computed = (page, key, count = 0) => page.waitForFunction(([callKey, before]) => window.__computed.filter(item => item === callKey).length > before, [key, count]);
const computedCount = (page, key) => page.evaluate(callKey => window.__computed.filter(item => item === callKey).length, key);

// Holds a call's answer until `release(page, key)`.
const hold = (page, key) => page.evaluate(callKey => {
  window.__release ??= {};
  window.__hold[callKey] = new Promise(resolve => { window.__release[callKey] = resolve; });
}, key);
const release = (page, key) => page.evaluate(callKey => {
  delete window.__hold[callKey];
  window.__release[callKey]();
}, key);

async function lockScreenIsClean(page) {
  await page.getByRole('heading', { name: 'Admin is locked' }).waitFor();
  const button = page.getByRole('button', { name: 'Unlock' });
  assert.equal(await button.textContent(), 'Unlock');
  assert.equal(await button.isEnabled(), true);
  assert.equal(await page.locator('#lock').isHidden(), true);
  assert.equal(await page.locator('#lock-time').isHidden(), true);
  assert.equal(await page.locator('[data-region="days"]').count(), 0);
}

test('a wrong PIN is refused and the right one opens the day', async () => {
  const { page, errors, context } = await openAdmin({ open: false, width: 390, height: 844 });
  await unlock(page, '1111');
  await page.getByText('That PIN is not correct.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Unlock' }).isEnabled(), true);
  await unlock(page);
  await page.getByRole('heading', { name: `Reservations on ${formatDay(TODAY)}` }).waitFor();
  assert.equal(await page.locator('#lock-time').textContent(), 'Locks at 9:20 AM');
  await page.locator(`[data-date="${DAY}"]`).click();
  await entry(page, 'Brother John Smith').getByText('Room 1 · Contact: Sample Contact · Made by a member').waitFor();
  await entry(page, 'Deep clean').getByText('Room 2 · Hold · Added by Admin').waitFor();
  await entry(page, 'Deep clean').getByText('Note: Staff only').waitFor();
  assert.equal(await entry(page, 'Grace Park').locator('.badge').textContent(), 'Cancelled');
  assert.equal(await page.locator('.map-booking', { hasText: 'Brother John Smith' }).count(), 1);
  assert.deepEqual(await page.locator('.map-legend span').allTextContents(), ['Contact', 'New Member', 'Other', 'Hold']);
  assert.equal(await fitsWidth(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('adding a reservation sends one unit per type, then clears the form', async () => {
  const { page, errors, context } = await openAdmin();
  const form = page.locator('[data-form="add"]');
  await form.getByLabel('Name', { exact: true }).fill('Hold for cleaning');
  await form.getByLabel('For').selectOption('blocked');
  await form.getByLabel('Reason (private)').fill('Carpet');
  await form.getByLabel('Start').selectOption('13:00');
  await form.getByLabel('End').selectOption('14:00');
  await form.getByLabel('Study room').selectOption('room-3');
  await form.getByLabel('Private note (optional)').fill('Vacuum');
  await form.getByRole('button', { name: 'Add reservation' }).click();
  await page.getByText('Reservation added for Hold for cleaning.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data.booking, {
    date: DAY, start: '13:00', end: '14:00', name: 'Hold for cleaning', purpose: 'blocked',
    reservedFor: 'Carpet', note: 'Vacuum', assignments: { room: 'room-3' }
  });
  await entry(page, 'Hold for cleaning').getByText('Note: Vacuum').waitFor();
  assert.equal(await form.getByLabel('Name', { exact: true }).inputValue(), '');
  assert.equal(await form.getByLabel('Private note (optional)').inputValue(), '');
  assert.equal(await focusedKey(page), 'add-name');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Cancel asks in the row first; end early, restore and notes each reach the server', async () => {
  const { page, errors, context } = await openAdmin();
  const john = entry(page, 'Brother John Smith');
  await john.getByRole('button', { name: 'Cancel' }).click();
  await john.getByRole('heading', { name: 'Cancel this reservation?' }).waitFor();
  await john.getByText('Room 1, Tuesday, Oct 6, 11:00 AM to 12:30 PM. Its time opens for others right away. You can restore it later.').waitFor();
  assert.equal(await john.getByRole('button', { name: 'Cancel', exact: true }).count(), 0, 'the opener hides while the question is open');
  await john.getByRole('button', { name: 'Keep it' }).click();
  await john.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  assert.equal(await focusedKey(page), 'open-cancel-r1');
  assert.equal(await calls(page, 'adminBookingAction'), 0);

  await john.getByRole('button', { name: 'Cancel', exact: true }).click();
  await john.getByRole('button', { name: 'Yes, cancel it' }).click();
  await page.getByText('Brother John Smith\'s reservation was cancelled.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data, { sessionToken: TOKEN, action: 'cancel', bookingId: 'r1' });
  await john.getByText('Cancelled by Admin.').waitFor();
  assert.equal(await john.locator('.badge').textContent(), 'Cancelled');
  assert.equal(await focusedKey(page), 'open-note-r1');

  const avery = entry(page, 'Avery Example');
  await avery.getByRole('button', { name: 'End early' }).click();
  assert.equal(await avery.getByRole('button', { name: 'End early' }).count(), 0);
  await avery.getByLabel('New end time').selectOption('16:30');
  await avery.getByRole('button', { name: 'Save end time' }).click();
  await page.getByText('Avery Example now ends at 4:30 PM.').waitFor();
  await avery.getByText('Ended early; it was booked until 5:00 PM.').waitFor();
  assert.equal(await focusedKey(page), 'open-note-r4');

  const grace = entry(page, 'Grace Park');
  await grace.getByRole('button', { name: 'Restore' }).click();
  assert.equal(await grace.getByRole('button', { name: 'Restore' }).count(), 1, 'only the panel\'s Restore shows');
  assert.equal(await grace.getByLabel('Study room').inputValue(), 'room-3', 'its previous room is suggested');
  await grace.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('Grace Park\'s reservation is confirmed again.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data.assignments, { room: 'room-3' });
  await grace.getByRole('button', { name: 'Cancel', exact: true }).waitFor();

  await avery.getByRole('button', { name: 'Add note' }).click();
  await avery.getByLabel(/Private note/).fill('Brings own markers');
  await avery.getByRole('button', { name: 'Save note' }).click();
  await avery.getByText('Note: Brings own markers').waitFor();
  await page.getByText('Note saved.').waitFor();
  await avery.getByRole('button', { name: 'Edit note' }).click();
  assert.equal(await avery.getByLabel(/Private note/).inputValue(), 'Brings own markers');
  await avery.getByLabel(/Private note/).fill('');
  await avery.getByRole('button', { name: 'Save note' }).click();
  await page.getByText('Note removed.').waitFor();
  await avery.getByRole('button', { name: 'Add note' }).waitFor();
  assert.equal(await avery.getByText('Note: Brings own markers').count(), 0);
  assert.notEqual(await focusedKey(page), 'BODY');
  assert.deepEqual(errors, []);
  await context.close();
});

test('End early offers the ends the server sends', async () => {
  const state = fixture([
    row('e1', { tv: 'tv-1' }, { start: '16:00', end: '18:00', name: 'Server Ends Example', earlyEnds: ['17:00'], ended: false }),
    row('e2', { tv: 'tv-2' }, { start: '16:00', end: '18:00', name: 'Ended Example', earlyEnds: [], ended: true })
  ]);
  const { page, errors, context } = await openAdmin({ state });
  const server = entry(page, 'Server Ends Example');
  await server.getByRole('button', { name: 'End early' }).click();
  assert.deepEqual(await server.getByLabel('New end time').locator('option').allTextContents(), ['5:00 PM']);
  await entry(page, 'Ended Example').getByRole('button', { name: 'Cancel' }).waitFor();
  assert.equal(await entry(page, 'Ended Example').getByRole('button', { name: 'End early' }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a background refresh keeps what the Admin picked in an open form', async () => {
  const { page, errors, context } = await openAdmin();
  const avery = entry(page, 'Avery Example');
  await avery.getByRole('button', { name: 'End early' }).click();
  await avery.getByLabel('New end time').selectOption('16:30');
  await page.evaluate(() => { window.__state.bookings[0].name = 'Brother John Smith Jr'; });
  await refreshNow(page);
  await page.locator('.entry-name', { hasText: 'Brother John Smith Jr' }).waitFor();
  assert.equal(await avery.getByLabel('New end time').inputValue(), '16:30');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Remove old records asks first, counts every batch, and Keep them sends nothing', async () => {
  const { page, errors, context } = await openAdmin({ state: fixture([], { removeBatches: [350, 350, 12] }) });
  await page.getByText('Permanently deletes reservations dated more than 8 weeks ago, and their private notes.').waitFor();
  await page.getByRole('button', { name: 'Remove old records' }).click();
  await page.getByText('Delete reservations dated before Aug 8 and their private notes? This cannot be undone.').waitFor();
  await page.getByRole('button', { name: 'Keep them' }).click();
  await page.getByRole('button', { name: 'Remove old records' }).waitFor();
  assert.equal(await focusedKey(page), 'remove-old');
  assert.equal(await calls(page, 'adminBookingAction', 'remove-old'), 0);

  await hold(page, 'adminBookingAction:remove-old');
  await page.getByRole('button', { name: 'Remove old records' }).click();
  await page.getByRole('button', { name: 'Yes, delete them' }).click();
  const running = page.getByRole('button', { name: 'Removing…' });
  await running.waitFor();
  assert.equal(await running.isDisabled(), true);
  await running.click({ force: true });
  await release(page, 'adminBookingAction:remove-old');
  await page.getByText('Removed 712 old records.').waitFor();
  assert.equal(await calls(page, 'adminBookingAction', 'remove-old'), 3);
  assert.equal(await page.getByRole('button', { name: 'Remove old records' }).isEnabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Lock clears names and drafts; a session the server ended keeps the draft', async () => {
  const { page, errors, context } = await openAdmin();
  await page.locator('#add-name').fill('Sister Draft Example');
  await entry(page, 'Brother John Smith').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await page.getByText('Brother John Smith\'s reservation was cancelled.').waitFor();
  await page.getByRole('button', { name: 'Lock' }).click();
  await lockScreenIsClean(page);
  assert.equal((await lastCall(page, 'adminEndSession')).name, 'adminEndSession');
  assert.equal(await page.locator('#messages').innerHTML(), '', 'messages with full names are gone');
  assert.equal(await page.locator('.form-error').count(), 0);

  await unlock(page);
  await page.getByRole('heading', { name: /^Reservations on/ }).waitFor();
  assert.equal(await page.locator('#add-name').inputValue(), '', 'Lock does not keep drafts');

  await page.locator('#add-name').fill('Sister Draft Example');
  await page.evaluate(() => { window.__kill = true; });
  await page.clock.fastForward(30000);
  await page.getByText('Your Admin session ended. Enter the PIN again. What you typed is kept.').waitFor();
  await lockScreenIsClean(page);
  await page.evaluate(() => { window.__kill = false; });
  await unlock(page);
  await page.getByRole('heading', { name: /^Reservations on/ }).waitFor();
  assert.equal(await page.locator('#add-name').inputValue(), 'Sister Draft Example');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Lock during a save leaves a clean lock screen and drops the answer', async () => {
  const { page, errors, context } = await openAdmin();
  await hold(page, 'adminNoteAction:save');
  await entry(page, 'Avery Example').getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel(/Private note \(only Admin/).fill('Fictional note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await computed(page, 'adminNoteAction:save');
  await page.getByRole('button', { name: 'Lock' }).click();
  await lockScreenIsClean(page);
  await release(page, 'adminNoteAction:save');
  await page.waitForFunction(() => window.__answered.includes('adminNoteAction:save'));
  await settle(page);
  await lockScreenIsClean(page);
  assert.equal(await page.locator('.message').count(), 0);
  await unlock(page);
  await page.getByRole('heading', { name: /^Reservations on/ }).waitFor();
  await page.locator(`[data-date="${DAY}"]`).click();
  await entry(page, 'Avery Example').getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel(/Private note \(only Admin/).fill('Saved after unlocking');
  await page.getByRole('button', { name: 'Save note' }).click();
  await entry(page, 'Avery Example').getByText('Note: Saved after unlocking').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('Admin locking itself during Remove old records leaves a clean lock screen', async () => {
  const { page, errors, context } = await openAdmin();
  await hold(page, 'adminBookingAction:remove-old');
  await page.getByRole('button', { name: 'Remove old records' }).click();
  await page.getByRole('button', { name: 'Yes, delete them' }).click();
  await page.getByRole('button', { name: 'Removing…' }).waitFor();
  await computed(page, 'adminBookingAction:remove-old');
  await page.clock.fastForward(20 * MINUTE);
  await page.getByText(EXPIRED, { exact: true }).waitFor();
  await lockScreenIsClean(page);
  await release(page, 'adminBookingAction:remove-old');
  await page.waitForFunction(() => window.__answered.includes('adminBookingAction:remove-old'));
  await settle(page);
  await lockScreenIsClean(page);
  assert.equal(await page.locator('.message').count(), 0);
  await unlock(page);
  await page.getByRole('button', { name: 'Remove old records' }).click();
  await page.getByRole('button', { name: 'Yes, delete them' }).click();
  await page.getByText('There were no old records to remove.').waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('what was typed comes back after the PIN when Admin locks itself', async () => {
  const { page, errors, context } = await openAdmin();
  const form = page.locator('[data-form="add"]');
  await form.getByLabel('Name', { exact: true }).fill('Sister Fictional Person');
  await form.getByLabel('Contact name').fill('Sample Guest');
  await form.getByLabel('Start').selectOption('13:00');
  await form.getByLabel('End').selectOption('14:00');
  await form.getByLabel('Study room').selectOption('room-4');
  await form.getByLabel('Private note (optional)').fill('A long private note the Admin was typing');
  await entry(page, 'Avery Example').getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel(/Private note \(only Admin/).fill('Half typed');

  await page.clock.fastForward(19 * MINUTE);
  await page.getByRole('heading', { name: /^Reservations on/ }).waitFor();
  await page.clock.fastForward(1 * MINUTE + 1000);
  await page.getByText(`${EXPIRED} What you typed is kept.`, { exact: true }).waitFor();
  await lockScreenIsClean(page);
  assert.equal((await page.locator('body').innerText()).includes('Brother John Smith'), false);

  await unlock(page);
  await page.getByRole('heading', { name: `Reservations on ${formatDay(DAY)}` }).waitFor();
  assert.equal(await form.getByLabel('Name', { exact: true }).inputValue(), 'Sister Fictional Person');
  assert.equal(await form.getByLabel('Contact name').inputValue(), 'Sample Guest');
  assert.equal(await form.getByLabel('Start').inputValue(), '13:00');
  assert.equal(await form.getByLabel('End').inputValue(), '14:00');
  assert.equal(await form.getByLabel('Study room').inputValue(), 'room-4');
  assert.equal(await form.getByLabel('Private note (optional)').inputValue(), 'A long private note the Admin was typing');
  assert.equal(await page.getByLabel(/Private note \(only Admin/).inputValue(), 'Half typed');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a device clock 30 minutes fast still unlocks, and only changes keep Admin open', async () => {
  const skew = 30 * MINUTE;
  const { page, errors, context } = await openAdmin({ open: false, now: new Date(TEST_NOW.getTime() + skew) });
  await page.evaluate(ms => { window.__skew = ms; }, skew);
  await unlock(page);
  await page.getByRole('heading', { name: /^Reservations on/ }).waitFor();
  assert.equal(await page.locator('#lock-time').textContent(), 'Locks at 9:50 AM');

  await page.clock.fastForward(10 * MINUTE);
  await refreshNow(page);
  assert.equal(await page.locator('#lock-time').textContent(), 'Locks at 9:50 AM', 'the refresh does not keep Admin open');
  await page.locator(`[data-date="${DAY}"]`).click();
  await entry(page, 'Avery Example').getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel(/Private note \(only Admin/).fill('Kept open');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByText('Note saved.').waitFor();
  assert.equal(await page.locator('#lock-time').textContent(), 'Locks at 10:00 AM', 'a change keeps Admin open for 20 more minutes');

  await page.clock.fastForward(19 * MINUTE);
  await refreshNow(page);
  assert.equal(await page.getByRole('heading', { name: 'Admin is locked' }).count(), 0);
  await page.clock.fastForward(2 * MINUTE);
  await page.getByText(EXPIRED, { exact: true }).waitFor();
  await lockScreenIsClean(page);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a refresh that started before a cancel never shows the old state', async () => {
  const { page, errors, context } = await openAdmin();
  await hold(page, 'adminSchedule:');
  const before = await computedCount(page, 'adminSchedule:');
  await page.clock.fastForward(30000);
  await computed(page, 'adminSchedule:', before);
  const john = entry(page, 'Brother John Smith');
  await john.getByRole('button', { name: 'Cancel' }).click();
  await john.getByRole('button', { name: 'Yes, cancel it' }).click();
  await page.getByText('Brother John Smith\'s reservation was cancelled.').waitFor();
  await release(page, 'adminSchedule:');
  await john.getByText('Cancelled by Admin.').waitFor();
  await settle(page);
  assert.equal(await john.locator('.badge').textContent(), 'Cancelled');
  assert.equal(await john.getByRole('button', { name: 'Cancel', exact: true }).count(), 0);
  assert.equal(await page.locator('.message.error').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Lock during a refresh shows a clean lock screen', async () => {
  const { page, errors, context } = await openAdmin();
  await hold(page, 'adminSchedule:');
  const before = await computedCount(page, 'adminSchedule:');
  await page.clock.fastForward(30000);
  await computed(page, 'adminSchedule:', before);
  await page.getByRole('button', { name: 'Lock' }).click();
  await lockScreenIsClean(page);
  const answeredBefore = await answered(page, 'adminSchedule:');
  await release(page, 'adminSchedule:');
  await page.waitForFunction(count => window.__answered.filter(item => item === 'adminSchedule:').length > count, answeredBefore);
  await settle(page);
  await lockScreenIsClean(page);
  assert.equal(await page.locator('.form-error').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('unlocking again while a refresh from before the Lock is still out loads the schedule', async () => {
  const { page, errors, context } = await openAdmin();
  await hold(page, 'adminSchedule:');
  const before = await computedCount(page, 'adminSchedule:');
  await page.clock.fastForward(30000);
  await computed(page, 'adminSchedule:', before);
  await page.getByRole('button', { name: 'Lock' }).click();
  await lockScreenIsClean(page);
  await unlock(page);
  await page.locator('[data-role="loading"]').waitFor();
  // The answer from before the Lock arrives now; it is dropped, and the
  // schedule still loads.
  await release(page, 'adminSchedule:');
  await page.locator(`[data-date="${DAY}"]`).click();
  await page.getByRole('heading', { name: `Reservations on ${formatDay(DAY)}` }).waitFor();
  assert.equal(await page.locator('[data-role="loading"]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('names, details, notes and ids show as text, never as markup', async () => {
  const evil = '"><img src=x onerror="window.__pwned=1">';
  const id = 'x1"><img src=x onerror=window.__pwned=2>';
  const state = fixture([
    row(id, { room: 'room-4' }, { start: '17:00', end: '18:00', name: evil, reservedFor: evil, note: evil, byMember: true }),
    row('x2', { room: 'room-2' }, { start: '18:00', end: '19:00', name: '<script>window.__pwned=3</script>', purpose: 'contact" onclick="window.__pwned=4', status: 'cancelled' })
  ]);
  const { page, errors, context } = await openAdmin({ state });
  const row4 = entry(page, 'onerror').first();
  await row4.getByText(`Note: ${evil}`).waitFor();
  await row4.getByRole('button', { name: 'Edit note' }).click();
  assert.equal(await row4.getByLabel(/Private note/).inputValue(), evil);
  await row4.getByRole('button', { name: 'Close' }).click();
  await row4.getByRole('button', { name: 'End early' }).click();
  await row4.getByRole('button', { name: 'Close' }).click();
  await row4.getByRole('button', { name: 'Cancel' }).click();
  await row4.getByRole('heading', { name: 'Cancel this reservation?' }).waitFor();
  await entry(page, '<script>').getByRole('button', { name: 'Restore' }).click();
  await page.locator('.map-booking', { hasText: evil }).waitFor();
  await settle(page);
  assert.equal(await page.evaluate(() => window.__pwned ?? 'unset'), 'unset');
  assert.equal(await page.locator('#admin img, #admin script').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a refresh never replaces a text field being typed in, even mid-word', async () => {
  const { page, errors, context } = await openAdmin();
  const name = page.locator('#add-name');
  await name.click();
  await page.keyboard.type('Sister Fic');
  await name.evaluate(element => { element.probe = true; });
  await page.evaluate(() => { window.__state.bookings[0].name = 'Brother John Smith Jr'; });
  await refreshNow(page);
  await page.locator('.entry-name', { hasText: 'Brother John Smith Jr' }).waitFor();
  assert.equal(await name.evaluate(element => element.probe === true && document.activeElement === element), true);
  await page.keyboard.type('tional');
  assert.equal(await name.inputValue(), 'Sister Fictional');

  // A word being composed (a phone keyboard's suggestion, or an input method)
  // survives a refresh that redraws the same row.
  const avery = entry(page, 'Avery Example');
  await avery.getByRole('button', { name: 'Add note' }).click();
  const note = avery.getByLabel(/Private note/);
  await note.click();
  await page.keyboard.type('Arrives');
  await note.evaluate(element => { element.probe = true; });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: ' la', selectionStart: 3, selectionEnd: 3 });
  await page.evaluate(() => { window.__state.bookings[3].name = 'Avery Example Jr'; });
  await refreshNow(page);
  await page.locator('.entry-name', { hasText: 'Avery Example Jr' }).waitFor();
  await cdp.send('Input.imeSetComposition', { text: ' lat', selectionStart: 4, selectionEnd: 4 });
  await cdp.send('Input.insertText', { text: ' late' });
  assert.equal(await note.inputValue(), 'Arrives late');
  assert.equal(await note.evaluate(element => element.probe === true && document.activeElement === element), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('field limits come from the rules, and each type gets one unit', async () => {
  const config = structuredClone(CONFIG);
  Object.assign(config, { nameMax: 50, noteMax: 300, holdReasonMax: 80 });
  config.purposes.contact.detailMax = 60;
  config.purposes.other.detailMax = 200;
  const { page, errors, context } = await openAdmin({ state: { ...fixture(), config } });
  const form = page.locator('[data-form="add"]');
  const max = locator => locator.getAttribute('maxlength');
  assert.equal(await max(form.getByLabel('Name', { exact: true })), '50');
  assert.equal(await max(form.getByLabel('Contact name')), '60');
  await form.getByLabel('For').selectOption('other');
  assert.equal(await max(form.getByLabel('Purpose')), '200');
  await form.getByLabel('For').selectOption('blocked');
  assert.equal(await max(form.getByLabel('Reason (private)')), '80');
  assert.equal(await max(form.getByLabel('Private note (optional)')), '300');
  await entry(page, 'Avery Example').getByRole('button', { name: 'Add note' }).click();
  assert.equal(await max(page.getByLabel(/Private note \(only Admin/)), '300');

  await form.getByLabel('Start').selectOption('11:00');
  await form.getByLabel('End').selectOption('12:30');
  const rooms = form.getByLabel('Study room');
  assert.deepEqual(await rooms.locator('option').allTextContents(),
    ['None', 'Room 1 (taken by Brother John Smith)', 'Room 2 (taken by Deep clean)', 'Room 3', 'Room 4']);
  assert.deepEqual(await rooms.locator('option').evaluateAll(options => options.map(option => option.disabled)), [false, true, true, false, false]);
  await rooms.selectOption('room-3');
  await rooms.selectOption('room-4');
  await form.getByLabel('TV').selectOption('tv-2');
  await form.getByLabel('Name', { exact: true }).fill('Sample Holder');
  await form.getByRole('button', { name: 'Add reservation' }).click();
  await page.getByText('Reservation added for Sample Holder.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data.booking.assignments, { room: 'room-4', tv: 'tv-2' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Restore suggests a free unit, says when none is free, and stays open on a conflict', async () => {
  const boards = ['wb-1', 'wb-2', 'wb-3', 'wb-4', 'wb-5'];
  const state = fixture([
    row('r5', { room: 'room-3' }, { start: '13:30', end: '14:30', name: 'Taken Holder' }),
    row('r6', { whiteboard: 'wb-1' }, { start: '16:00', end: '17:00', name: 'Board Wanted', status: 'cancelled' }),
    ...boards.slice(0, 4).filter(board => board !== 'wb-2').map(board => row(`b-${board}`, { whiteboard: board }, { start: '16:00', end: '17:00', name: `Holder ${board}` })),
    row('b-wb-5', { whiteboard: 'wb-5' }, { start: '16:30', end: '17:30', name: 'Holder wb-5' })
  ]);
  const { page, errors, context } = await openAdmin({ state });

  const grace = entry(page, 'Grace Park');
  await grace.getByRole('button', { name: 'Restore' }).click();
  assert.equal(await grace.getByLabel('Study room').inputValue(), 'room-1', 'its old room is taken, so the first free one is offered');
  assert.deepEqual(await grace.getByLabel('Study room').locator('option').allTextContents(), ['Room 1', 'Room 2', 'Room 4']);

  const wanted = entry(page, 'Board Wanted');
  await wanted.getByRole('button', { name: 'Restore' }).click();
  await wanted.getByText('No whiteboard is free at that time.').waitFor();
  assert.equal(await wanted.getByRole('button', { name: 'Restore' }).isDisabled(), true);

  await grace.getByRole('button', { name: 'Restore' }).click();
  await page.evaluate(() => { window.__refuse['adminBookingAction:restore'] = { code: 'already-exists', message: 'Room 1 is already reserved by Sample Holder at that time.' }; });
  await grace.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('Room 1 is already reserved by Sample Holder at that time.').waitFor();
  assert.equal(await grace.getByLabel('Study room').isVisible(), true, 'the panel stays open to choose again');
  await grace.getByLabel('Study room').selectOption('room-4');
  await grace.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('Grace Park\'s reservation is confirmed again.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data.assignments, { room: 'room-4' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('priority notices explain each row, and a row that lost a unit can get a new one', async () => {
  const state = fixture([
    row('n1', { room: null, tv: 'tv-1' }, {
      start: '17:00', end: '18:00', name: 'Lost Room Example', notice: { kind: 'released', fromUnit: 'room-2', toUnit: null, toEnd: null, byPurpose: 'contact' }
    }),
    row('n2', { room: 'room-4' }, {
      start: '18:00', end: '19:00', name: 'Moved Example', byMember: true, notice: { kind: 'moved', fromUnit: 'room-2', toUnit: 'room-4', toEnd: null, byPurpose: 'contact' }
    }),
    row('n3', { room: 'room-2' }, {
      start: '14:00', end: '15:00', name: 'Shortened Example', byMember: true,
      notice: { kind: 'shortened', fromUnit: 'room-2', toUnit: 'room-2', fromEnd: '17:00', toEnd: '15:00', byPurpose: 'new-member' }
    }),
    // Shortened to 5 PM by a Contact reservation, then ended early at 4 PM by its member.
    row('n5', { room: 'room-3' }, {
      start: '15:30', end: '16:00', name: 'Shortened Then Ended Example', byMember: true, endedEarlyFrom: '17:00',
      notice: { kind: 'shortened', fromUnit: 'room-3', toUnit: 'room-3', fromEnd: '18:00', toEnd: '17:00', byPurpose: 'contact' }
    }),
    row('n4', { room: null }, {
      start: '21:00', end: '22:00', name: 'Replaced Example', byMember: true, status: 'overridden',
      notice: { kind: 'released', fromUnit: 'room-1', toUnit: null, toEnd: null, byPurpose: 'contact' }
    })
  ]);
  const { page, errors, context } = await openAdmin({ state });
  await entry(page, 'Moved Example').getByText('Moved from Room 2 for a Contact reservation.').waitFor();
  await entry(page, 'Shortened Example').getByText('Shortened for a New Member reservation; it was booked until 5:00 PM.').waitFor();
  assert.equal(await entry(page, 'Shortened Example').getByText('Ended early').count(), 0);
  const both = entry(page, 'Shortened Then Ended Example');
  await both.getByText('Shortened for a Contact reservation; it was booked until 6:00 PM.').waitFor();
  await both.getByText('Ended early; it was booked until 5:00 PM.').waitFor();
  const replaced = entry(page, 'Replaced Example');
  await replaced.getByText('Replaced by a Contact reservation; no other study room was free.').waitFor();
  assert.equal(await replaced.locator('.badge').textContent(), 'Replaced');

  const lost = entry(page, 'Lost Room Example');
  await lost.getByText('Replaced by a Contact reservation; no other study room was free.').waitFor();
  await lost.getByText('No study room, TV 1 · Other · Added by Admin').waitFor();
  assert.equal(await lost.locator('.badge').textContent(), 'Confirmed');
  await lost.getByRole('button', { name: 'Choose a new unit' }).click();
  assert.equal(await lost.getByLabel('TV').count(), 0, 'only the missing unit is asked for');
  await lost.getByLabel('Study room').selectOption('room-3');
  await lost.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('Lost Room Example\'s reservation now has Room 3.').waitFor();
  assert.deepEqual((await lastCall(page, 'adminBookingAction')).data, { sessionToken: TOKEN, action: 'restore', bookingId: 'n1', assignments: { room: 'room-3' } });
  await lost.getByText('Room 3, TV 1 · Other · Added by Admin').waitFor();
  assert.equal(await lost.getByRole('button', { name: 'Choose a new unit' }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('six wrong PINs end in the wait message, and the form still works', async () => {
  const { page, errors, context } = await openAdmin({ open: false });
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await unlock(page, '1111');
    await page.waitForFunction(count => window.__answered.filter(item => item === 'adminStartSession:').length >= count, attempt);
    await page.getByRole('button', { name: 'Unlock' }).waitFor();
  }
  await page.getByText('Too many PIN attempts. Wait 15 minutes and try again.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Unlock' }).isEnabled(), true);
  assert.equal(await page.getByLabel('Admin PIN').isEditable(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('an older record with no name, purpose or units still shows', async () => {
  const legacy = { id: 'legacy1', date: DAY, start: '11:00', end: '12:00', status: 'approved', note: '' };
  const { page, errors, context } = await openAdmin({ state: fixture([legacy, { ...legacy, id: 'legacy2', name: null, status: 'cancelled' }]) });
  await page.getByText('No name').first().waitFor();
  assert.equal(await page.locator('.entry').count(), 6);
  assert.equal(await entry(page, 'No name').first().locator('.entry-meta').first().textContent(), 'Other · Added by Admin');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Search and Hide cancelled filter the day, survive a refresh, and Lock clears the search', async () => {
  const { page, errors, context } = await openAdmin({ state: fixture([row('r5', { room: 'room-4' }, { start: '17:00', end: '18:00', name: 'José Ruiz', reservedFor: 'Choir' })]) });
  const search = page.getByLabel('Search this day');
  const hide = page.getByLabel('Hide cancelled');
  const status = page.locator('#list-shown');
  const names = () => page.locator('.entry-name b').allTextContents();
  await search.fill('room 1');
  assert.deepEqual(await names(), ['Brother John Smith']);
  assert.equal(await status.textContent(), 'Showing 1 of 5.');
  await search.fill('  PLANNING ');
  assert.deepEqual(await names(), ['Avery Example'], 'the member detail, in any case');
  await search.fill('jose choir');
  assert.deepEqual(await names(), ['José Ruiz'], 'every word, without accents');
  await search.fill('hold');
  assert.deepEqual(await names(), ['Deep clean'], 'the purpose');
  await search.fill('nobody');
  assert.deepEqual(await names(), []);
  assert.equal(await status.textContent(), 'No reservations on this day match.');
  await search.fill('');
  assert.equal(await status.isHidden(), true);
  await hide.check();
  assert.equal((await names()).includes('Grace Park'), false);
  assert.equal(await status.textContent(), 'Showing 4 of 5.');
  assert.equal(await page.evaluate(() => localStorage.getItem('srs-admin-hide-cancelled')), '1');
  await search.fill('room');
  await refreshNow(page);
  assert.equal(await search.inputValue(), 'room', 'a refresh keeps the search');
  assert.deepEqual(await names(), ['Brother John Smith', 'Deep clean', 'José Ruiz']);
  // An open panel stays even when the search no longer matches its row.
  await entry(page, 'Brother John Smith').getByRole('button', { name: 'Add note' }).click();
  await search.fill('Avery');
  assert.deepEqual(await names(), ['Brother John Smith', 'Avery Example']);
  await page.locator('#lock').click();
  await unlock(page);
  await page.locator(`[data-date="${DAY}"]`).click();
  assert.equal(await page.getByLabel('Search this day').inputValue(), '', 'Lock clears the search');
  assert.equal(await page.getByLabel('Hide cancelled').isChecked(), true, 'Hide cancelled is remembered');
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a phone nothing scrolls sideways and Add a reservation is one tap from the top', async () => {
  const { page, errors, context } = await openAdmin({ width: 390, height: 844 });
  assert.equal(await fitsWidth(page), true);
  const jump = page.getByRole('link', { name: 'Add a reservation' });
  const box = await jump.boundingBox();
  assert.ok(box && box.y + box.height < 844, 'the link shows without scrolling');
  await jump.click();
  assert.equal(await focusedKey(page), 'add-name');
  assert.equal(await page.locator('#add-name').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  }), true);
  for (const button of ['End early', 'Add note', 'Cancel']) {
    await entry(page, 'Avery Example').getByRole('button', { name: button, exact: true }).click();
    assert.equal(await fitsWidth(page), true, `${button} panel fits`);
    await entry(page, 'Avery Example').getByRole('button', { name: /^(Close|Keep it)$/ }).click();
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('when a refresh fails, one line says which schedule is showing', async () => {
  const { page, errors, context } = await openAdmin();
  await page.evaluate(() => { window.__failSchedule = true; });
  for (let refresh = 0; refresh < 3; refresh += 1) await refreshNow(page);
  await page.getByText('Not connected. Showing the schedule from 9:00 AM.').waitFor();
  assert.equal(await page.locator('.connection').count(), 1);
  assert.equal(await page.locator('.message').count(), 0, 'no message every 30 seconds');
  await entry(page, 'Brother John Smith').waitFor();
  await page.evaluate(() => { window.__failSchedule = false; });
  await refreshNow(page);
  await page.locator('.connection').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('times that have begun are never offered, and End early goes once a reservation ends', async () => {
  const state = fixture([
    row('t1', { room: 'room-1' }, { date: TODAY, start: '11:00', end: '13:00', name: 'Today Example' }),
    row('t2', { room: 'room-2' }, { date: TODAY, start: '11:00', end: '12:00', name: 'Other Example' })
  ]);
  const first = await openAdmin({ state, now: new Date('2026-10-03T11:10:00-07:00'), day: TODAY });
  const { page } = first;
  const startTimes = () => page.locator('#add-start option').allTextContents();
  assert.equal((await startTimes())[1], '11:00 AM', 'at 11:10 the 11:00 slot is still open for 20 minutes');
  const today = entry(page, 'Today Example');
  await today.getByRole('button', { name: 'End early' }).click();
  assert.deepEqual(await today.getByLabel('New end time').locator('option').allTextContents(), ['11:30 AM', '12:00 PM', '12:30 PM']);
  await today.getByRole('button', { name: 'Close' }).click();
  await entry(page, 'Other Example').getByRole('button', { name: 'End early' }).waitFor();

  // A change keeps Admin open past 11:30.
  await page.clock.fastForward(15 * MINUTE);
  await today.getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel(/Private note \(only Admin/).fill('Keeps Admin open');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByText('Note saved.').waitFor();
  await page.clock.fastForward(6 * MINUTE);
  await refreshNow(page);
  // At 11:31 the 11:30 slot is still open (until 11:50); End early is not.
  await page.waitForFunction(() => document.querySelector('#add-start option:nth-child(2)')?.textContent === '11:30 AM');
  await today.getByRole('button', { name: 'End early' }).click();
  assert.deepEqual(await today.getByLabel('New end time').locator('option').allTextContents(), ['12:00 PM', '12:30 PM']);
  assert.equal(await entry(page, 'Other Example').getByRole('button', { name: 'End early' }).count(), 0, '11:30 has passed');
  assert.deepEqual(first.errors, []);
  await first.context.close();

  const later = await openAdmin({ state, now: new Date('2026-10-03T13:05:00-07:00'), day: TODAY });
  const ended = entry(later.page, 'Today Example');
  await ended.getByRole('button', { name: 'Cancel' }).waitFor();
  assert.equal(await ended.getByRole('button', { name: 'End early' }).count(), 0, 'it has ended');
  assert.equal((await later.page.locator('#add-start option').allTextContents())[1], '1:00 PM', 'at 1:05 PM the 1:00 PM slot is still open');
  assert.deepEqual(later.errors, []);
  await later.context.close();
});

test('an older server still works: notes by a separate read, members by ownerUid', async () => {
  const { page, errors, context } = await openAdmin({ state: fixture([], { legacy: true }) });
  await entry(page, 'Deep clean').getByText('Note: Staff only').waitFor();
  await entry(page, 'Brother John Smith').getByText('Made by a member').waitFor();
  assert.equal(await calls(page, 'adminNoteAction', 'read') > 0, true);
  assert.equal(await page.locator('#lock-time').textContent(), 'Locks at 9:20 AM');
  await entry(page, 'Grace Park').getByRole('button', { name: 'Restore' }).waitFor();
  await entry(page, 'Avery Example').getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel(/Private note \(only Admin/).fill('Older server note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await entry(page, 'Avery Example').getByText('Note: Older server note').waitFor();
  assert.equal(await page.locator('#lock-time').textContent(), 'Locks at 9:20 AM', 'without expiresInMs the deadline stays');
  assert.deepEqual(errors, []);
  await context.close();
});
