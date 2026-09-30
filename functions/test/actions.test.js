'use strict';

// Database changes and access checks, run against an in-memory Firestore.
// Needs the functions/ dependencies (`npm ci --prefix functions`). Every name
// and PIN here is fictional.

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./support/fake-firestore');
const actions = require('../lib/actions');
const guard = require('../lib/guard');
const { parseMemberRequest } = require('../lib/bookings');
const { bookableDates, weekdayOf } = require('../lib/schedule');

const SATURDAY = bookableDates().find(date => weekdayOf(date) === 6);

function seedBooking(db, id, fields) {
  db.seed('bookings', id, {
    date: SATURDAY, start: '11:00', end: '12:00', name: `Holder ${id}`, purpose: 'other', reservedFor: 'Study',
    needs: { room: true, whiteboard: false, tv: false }, status: 'approved', ownerUid: `owner-${id}`,
    ...fields,
    assignments: { room: null, whiteboard: null, tv: null, ...fields.assignments }
  });
}

function request(fields) {
  return parseMemberRequest({
    date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'contact',
    name: 'Sam Sample', reservedFor: 'Sample Contact', ...fields
  });
}

const code = error => error.code;

test('a reservation takes the first free unit and records its owner', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'a', { assignments: { room: 'room-1' } });
  const result = await actions.submitReservation(db, request({}), 'device-a');
  assert.equal(result.unit, 'room-2');
  const saved = db.read('bookings', result.id);
  assert.equal(saved.ownerUid, 'device-a');
  assert.equal(saved.status, 'approved');
  assert.deepEqual(saved.assignments, { room: 'room-2', whiteboard: null, tv: null });
  assert.deepEqual(saved.needs, { room: true, whiteboard: false, tv: false });
});

test('a full time is refused unless the member confirmed a takeover', async () => {
  const db = new FakeFirestore();
  ['1', '2', '3', '4'].forEach(unit => seedBooking(db, unit, { assignments: { room: `room-${unit}` } }));
  await assert.rejects(actions.submitReservation(db, request({}), 'device-a'), error => code(error) === 'already-exists');
  const result = await actions.submitReservation(db, request({ allowTakeover: true }), 'device-a');
  assert.equal(result.tookOver, true);
  assert.equal(db.read('bookings', '1').status, 'overridden');
  assert.equal(db.read('bookings', '1').priorityNotice.kind, 'released');
});

test('a takeover shortens an earlier reservation and moves a later one when it can', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'earlier', { start: '10:00', end: '12:00', assignments: { room: 'room-1' } });
  seedBooking(db, 'later', { start: '11:30', end: '12:00', assignments: { room: 'room-1' } });
  seedBooking(db, 'x', { start: '11:00', end: '11:30', purpose: 'contact', assignments: { room: 'room-2' } });
  seedBooking(db, 'y', { start: '11:00', end: '12:00', purpose: 'contact', assignments: { room: 'room-3' } });
  seedBooking(db, 'z', { start: '11:00', end: '12:00', purpose: 'contact', assignments: { room: 'room-4' } });
  const result = await actions.submitReservation(db, request({ start: '11:00', end: '12:00', allowTakeover: true }), 'device-a');
  assert.equal(result.unit, 'room-1');
  assert.equal(db.read('bookings', 'earlier').end, '11:00');
  assert.equal(db.read('bookings', 'earlier').priorityNotice.kind, 'shortened');
  // Room 2 is free from 11:30, so the later reservation moves there.
  assert.deepEqual(db.read('bookings', 'later').assignments.room, 'room-2');
  assert.equal(db.read('bookings', 'later').priorityNotice.kind, 'moved');
});

test('one device may hold four reservations a day', async () => {
  const db = new FakeFirestore();
  for (const start of ['11:00', '12:00', '13:00', '16:00']) {
    seedBooking(db, start, { start, end: `${Number(start.slice(0, 2)) + 1}:00`, ownerUid: 'device-a', assignments: { room: 'room-4' } });
  }
  await assert.rejects(actions.submitReservation(db, request({ start: '17:00', end: '18:00' }), 'device-a'), error => code(error) === 'resource-exhausted');
});

test('only the device that booked can cancel or end early', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'mine', { start: '11:00', end: '12:30', ownerUid: 'device-a', assignments: { room: 'room-1' } });
  await assert.rejects(actions.cancelReservation(db, 'mine', 'device-b'), error => code(error) === 'permission-denied');
  await assert.rejects(actions.endEarly(db, 'mine', '12:00', 'device-b', 'device-b'), error => code(error) === 'permission-denied');
  await actions.endEarly(db, 'mine', '12:00', 'device-a', 'device-a');
  await actions.endEarly(db, 'mine', '11:30', 'device-a', 'device-a');
  assert.equal(db.read('bookings', 'mine').end, '11:30');
  assert.equal(db.read('bookings', 'mine').endedEarlyFrom, '12:30', 'the first end time is kept');
  await assert.rejects(actions.endEarly(db, 'mine', '11:00', 'device-a', 'device-a'), error => code(error) === 'failed-precondition');
  await actions.cancelReservation(db, 'mine', 'device-a');
  assert.equal(db.read('bookings', 'mine').status, 'cancelled');
  await assert.rejects(actions.cancelReservation(db, 'mine', 'device-a'), error => code(error) === 'failed-precondition');
});

test('Admin adds, cancels and restores bookings without double-booking a unit', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'a', { assignments: { room: 'room-1' } });
  const booking = {
    date: SATURDAY, start: '11:30', end: '12:30', name: 'Hold', purpose: 'blocked', reservedFor: '',
    needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, note: 'Private'
  };
  await assert.rejects(actions.adminAdd(db, booking, 'admin'), error => code(error) === 'already-exists');
  const { id } = await actions.adminAdd(db, { ...booking, assignments: { room: 'room-2', whiteboard: null, tv: null } }, 'admin');
  assert.equal(db.read('bookings', id).ownerUid, null);
  assert.deepEqual(await actions.readNotes(db, [id, 'a']), { [id]: 'Private' });

  await actions.adminCancel(db, 'a', 'admin');
  seedBooking(db, 'b', { assignments: { room: 'room-1' } });
  await assert.rejects(actions.adminRestore(db, 'a', { room: 'room-1' }, 'admin'), error => code(error) === 'already-exists');
  await actions.adminRestore(db, 'a', { room: 'room-3' }, 'admin');
  assert.equal(db.read('bookings', 'a').status, 'approved');
  assert.equal(db.read('bookings', 'a').assignments.room, 'room-3');
  await assert.rejects(actions.adminRestore(db, 'a', { room: 'room-4' }, 'admin'), error => code(error) === 'failed-precondition');
});

test('notes can be saved, cleared and read only by id', async () => {
  const db = new FakeFirestore();
  await actions.saveNote(db, 'a', '  Keys at the desk ', 'admin');
  assert.deepEqual(await actions.readNotes(db, ['a']), { a: 'Keys at the desk' });
  await actions.saveNote(db, 'a', '', 'admin');
  assert.deepEqual(await actions.readNotes(db, ['a']), {});
  await assert.rejects(actions.readNotes(db, ['../x']), error => code(error) === 'invalid-argument');
});

test('old records and their notes are removed', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'old', { date: '2025-01-04' });
  seedBooking(db, 'new', {});
  db.seed('privateBookingNotes', 'old', { note: 'Old' });
  assert.deepEqual(await actions.removeOldRecords(db), { removed: 1, more: false });
  assert.equal(db.read('bookings', 'old'), undefined);
  assert.equal(db.read('privateBookingNotes', 'old'), undefined);
  assert.notEqual(db.read('bookings', 'new'), undefined);
});

// ---------- Access ----------

const call = (uid, data = {}, address = '203.0.113.5') => ({
  auth: uid ? { uid } : null,
  data,
  rawRequest: { headers: { 'x-forwarded-for': `198.51.100.9, ${address}` } }
});

test('calls without a signed-in device are refused', () => {
  assert.throws(() => guard.requireUser(call(null)), error => code(error) === 'unauthenticated');
});

test('reservation requests are limited per network address', async () => {
  const db = new FakeFirestore();
  for (let count = 1; count < 8; count += 1) await guard.limitReservationRequests(db, call('device-a'));
  await assert.rejects(guard.limitReservationRequests(db, call('device-b')), error => code(error) === 'resource-exhausted');
  await guard.limitReservationRequests(db, call('device-a', {}, '203.0.113.6'));
});

test('the Admin PIN opens a session tied to the device and the PIN', async () => {
  const db = new FakeFirestore();
  await assert.rejects(guard.startAdminSession(db, call('device-a', { pin: '0000' }), '2468'), error => code(error) === 'permission-denied');
  const { sessionToken } = await guard.startAdminSession(db, call('device-a', { pin: '2468' }), '2468');
  await guard.requireAdmin(db, call('device-a', { sessionToken }), '2468');
  await assert.rejects(guard.requireAdmin(db, call('device-b', { sessionToken }), '2468'), error => code(error) === 'permission-denied');
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken }), '1357'), error => code(error) === 'permission-denied', 'a changed PIN ends the session');
});

test('five wrong PINs lock an address for 15 minutes', async () => {
  const db = new FakeFirestore();
  for (let count = 1; count < 5; count += 1) {
    await assert.rejects(guard.startAdminSession(db, call('device-a', { pin: '0000' }), '2468'), error => code(error) === 'permission-denied');
  }
  await assert.rejects(guard.startAdminSession(db, call('device-a', { pin: '0000' }), '2468'), error => code(error) === 'resource-exhausted');
  await assert.rejects(guard.startAdminSession(db, call('device-a', { pin: '2468' }), '2468'), error => code(error) === 'resource-exhausted');
  await guard.startAdminSession(db, call('device-a', { pin: '2468' }, '203.0.113.7'), '2468');
});
