'use strict';

// Database changes, run against an in-memory Firestore on a fixed clock.
// Needs the functions/ dependencies (`npm ci --prefix functions`). Every name
// here is fictional.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const { FakeFirestore } = require('./support/fake-firestore');
const actions = require('../lib/actions');
const {
  SATURDAY, TUESDAY, local, useFixedClock, setClock, seedBooking, memberRequest, settle, hasCode
} = require('./support/fixtures');

useFixedClock();

const FOUR_A_DAY = 'You already have 4 reservations on this day. Cancel one in My reservations to make another.';

test('a reservation takes the first free unit and records its owner', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'a', { assignments: { room: 'room-1' } });
  const result = await actions.submitReservation(db, memberRequest(), 'device-a');
  assert.deepEqual(Object.keys(result), ['id', 'unit', 'takeover']);
  assert.equal(result.unit, 'room-2');
  assert.equal(result.takeover, false);
  const saved = db.read('bookings', result.id);
  assert.equal(saved.ownerUid, 'device-a');
  assert.equal(saved.status, 'approved');
  assert.equal(saved.takeover, false);
  assert.ok(saved.createdAt instanceof Timestamp);
  assert.deepEqual(saved.assignments, { room: 'room-2', whiteboard: null, tv: null });
  assert.deepEqual(saved.needs, { room: true, whiteboard: false, tv: false });
});

test('a full time is refused unless the member confirmed a takeover', async () => {
  const db = new FakeFirestore();
  ['1', '2', '3', '4'].forEach(unit => seedBooking(db, unit, { assignments: { room: `room-${unit}` } }));
  await assert.rejects(actions.submitReservation(db, memberRequest(), 'device-a'),
    { code: 'already-exists', message: 'No study rooms are free for that whole time. Choose another time.' });
  await assert.rejects(actions.submitReservation(db, memberRequest({ requestedUnit: 'room-2' }), 'device-a'),
    { code: 'already-exists', message: 'Room 2 is taken for part of that time. Choose another time.' });
  const result = await actions.submitReservation(db, memberRequest({ allowTakeover: true }), 'device-a');
  assert.deepEqual([result.unit, result.takeover], ['room-1', true]);
  assert.equal(db.read('bookings', result.id).takeover, true);
  assert.equal(db.read('bookings', '1').status, 'overridden');
  assert.equal(db.read('bookings', '1').priorityNotice.kind, 'released');
  assert.ok(db.read('bookings', '1').priorityNotice.at instanceof Timestamp, 'nested server times are stored as times');
});

test('a takeover shortens an earlier reservation and moves a later one when it can', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'earlier', { start: '10:00', end: '12:00', assignments: { room: 'room-1' } });
  seedBooking(db, 'later', { start: '11:30', end: '12:00', assignments: { room: 'room-1' } });
  seedBooking(db, 'x', { start: '11:00', end: '11:30', purpose: 'contact', assignments: { room: 'room-2' } });
  seedBooking(db, 'y', { purpose: 'contact', assignments: { room: 'room-3' } });
  seedBooking(db, 'z', { purpose: 'contact', assignments: { room: 'room-4' } });
  const result = await actions.submitReservation(db, memberRequest({ allowTakeover: true }), 'device-a');
  assert.equal(result.unit, 'room-1');
  assert.equal(db.read('bookings', 'earlier').end, '11:00');
  assert.equal(db.read('bookings', 'earlier').priorityNotice.kind, 'shortened');
  // Room 2 is free from 11:30, so the later reservation moves there.
  assert.equal(db.read('bookings', 'later').assignments.room, 'room-2');
  assert.equal(db.read('bookings', 'later').priorityNotice.kind, 'moved');
});

test('one device may hold four reservations a day; cancelled ones and other days do not count', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'gone', { start: '16:00', end: '17:00', ownerUid: 'device-a', status: 'cancelled', assignments: { room: 'room-4' } });
  for (const start of ['10:00', '11:00', '12:00', '13:00']) {
    seedBooking(db, `tue-${start.slice(0, 2)}`, { date: TUESDAY, start, end: `${Number(start.slice(0, 2)) + 1}:00`, ownerUid: 'device-a', assignments: { room: 'room-4' } });
  }
  for (const start of ['11:00', '12:00', '13:00']) {
    seedBooking(db, `sat-${start.slice(0, 2)}`, { start, end: `${Number(start.slice(0, 2)) + 1}:00`, ownerUid: 'device-a', assignments: { room: 'room-4' } });
  }
  await actions.submitReservation(db, memberRequest({ start: '16:00', end: '17:00' }), 'device-a');
  await assert.rejects(actions.submitReservation(db, memberRequest({ start: '17:00', end: '18:00' }), 'device-a'),
    { code: 'resource-exhausted', message: FOUR_A_DAY });
  await actions.submitReservation(db, memberRequest({ start: '17:00', end: '18:00' }), 'device-b');
});

test('only the device that booked can cancel or end early, and a cancel records who did it', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'mine', { start: '11:00', end: '12:30', ownerUid: 'device-a', assignments: { room: 'room-1' } });
  await assert.rejects(actions.cancelReservation(db, 'mine', 'device-b'), hasCode('permission-denied'));
  await assert.rejects(actions.endEarly(db, 'mine', '12:00', 'device-b', 'device-b'), hasCode('permission-denied'));
  assert.deepEqual(await actions.endEarly(db, 'mine', '12:00', 'device-a', 'device-a'), { end: '12:00' });
  await actions.endEarly(db, 'mine', '11:30', 'device-a', 'device-a');
  assert.equal(db.read('bookings', 'mine').end, '11:30');
  assert.equal(db.read('bookings', 'mine').endedEarlyFrom, '12:30', 'the first end time is kept');
  await assert.rejects(actions.endEarly(db, 'mine', '11:00', 'device-a', 'device-a'), hasCode('failed-precondition'));
  await actions.cancelReservation(db, 'mine', 'device-a');
  const saved = db.read('bookings', 'mine');
  assert.deepEqual([saved.status, saved.cancelledBy, saved.updatedBy], ['cancelled', 'member', 'device-a']);
  await assert.rejects(actions.cancelReservation(db, 'mine', 'device-a'), { code: 'failed-precondition', message: 'This reservation was already cancelled or replaced.' });
  await assert.rejects(actions.endEarly(db, 'mine', '11:30', 'device-a', 'device-a'), hasCode('failed-precondition'));
  await assert.rejects(actions.cancelReservation(db, 'missing', 'device-a'), hasCode('not-found'));
});

test('once a reservation has ended, a member can neither cancel nor end it early; Admin can still cancel it', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'done', { ownerUid: 'device-a', assignments: { room: 'room-1' } });
  seedBooking(db, 'long', { start: '11:00', end: '12:30', ownerUid: 'device-a', assignments: { room: 'room-2' } });
  seedBooking(db, 'last-week', { date: '2026-09-26', ownerUid: 'device-a', assignments: { room: 'room-3' } });
  const ended = { code: 'failed-precondition', message: 'This reservation has already ended.' };

  setClock(local(SATURDAY, '11:10'));
  await assert.rejects(actions.endEarly(db, 'long', '11:00', 'device-a', 'device-a'), hasCode('failed-precondition'));
  setClock(local(SATURDAY, '11:40'));
  await assert.rejects(actions.endEarly(db, 'long', '11:30', 'device-a', 'device-a'), { code: 'failed-precondition', message: 'Choose an end time from now on.' });
  await assert.rejects(actions.endEarly(db, 'long', '11:30', null, 'admin'), { code: 'failed-precondition', message: 'Choose an end time from now on.' });

  setClock(local(SATURDAY, '12:00'));
  await assert.rejects(actions.cancelReservation(db, 'done', 'device-a'), ended);
  await assert.rejects(actions.endEarly(db, 'done', '11:30', 'device-a', 'device-a'), ended);
  await assert.rejects(actions.cancelReservation(db, 'last-week', 'device-a'), ended);
  await actions.cancelReservation(db, 'long', 'device-a');
  await actions.adminCancel(db, 'done', 'admin-device');
  const saved = db.read('bookings', 'done');
  assert.deepEqual([saved.status, saved.cancelledBy, saved.updatedBy], ['cancelled', 'admin', 'admin-device']);
});

test('a repeated request returns the first result instead of booking twice', async () => {
  const db = new FakeFirestore();
  const requestId = 'repeat-0123456789abc';
  const first = await actions.submitReservation(db, memberRequest({ requestId }), 'device-a');
  assert.deepEqual(first, { id: `r-${requestId}`, unit: 'room-1', takeover: false });
  const again = await actions.submitReservation(db, memberRequest({ requestId }), 'device-a');
  assert.deepEqual(again, { ...first, repeated: true });
  assert.equal(db.all('bookings').length, 1);
  await assert.rejects(actions.submitReservation(db, memberRequest({ requestId }), 'device-b'), hasCode('permission-denied'));

  // A repeat is answered even when the day is now full for this device.
  for (const start of ['12:00', '13:00', '16:00']) {
    await actions.submitReservation(db, memberRequest({ start, end: `${Number(start.slice(0, 2)) + 1}:00` }), 'device-a');
  }
  assert.equal((await actions.submitReservation(db, memberRequest({ requestId }), 'device-a')).repeated, true);

  // A takeover's repeat says it was a takeover.
  ['2', '3', '4'].forEach(unit => seedBooking(db, `o${unit}`, { start: '17:00', end: '18:00', assignments: { room: `room-${unit}` } }));
  seedBooking(db, 'o1', { start: '17:00', end: '18:00', assignments: { room: 'room-1' } });
  const takeover = memberRequest({ start: '17:00', end: '18:00', allowTakeover: true, requestId: 'takeover-0123456789' });
  const taken = await actions.submitReservation(db, takeover, 'device-c');
  assert.deepEqual(await actions.submitReservation(db, takeover, 'device-c'), { ...taken, takeover: true, repeated: true });
});

test('a confirmed takeover takes only the unit the member was shown', async () => {
  const full = db => {
    seedBooking(db, 'o1', { purpose: 'other', assignments: { room: 'room-1' } });
    seedBooking(db, 'n2', { purpose: 'new-member', assignments: { room: 'room-2' } });
    seedBooking(db, 'c3', { purpose: 'contact', assignments: { room: 'room-3' } });
    seedBooking(db, 'o4', { purpose: 'other', assignments: { room: 'room-4' } });
  };
  const changed = { code: 'already-exists', message: 'The schedule changed. Check the time and confirm again.' };

  let db = new FakeFirestore();
  full(db);
  const shown = await actions.submitReservation(db, memberRequest({ allowTakeover: true, takeoverUnit: 'room-2' }), 'device-a');
  assert.deepEqual([shown.unit, shown.takeover], ['room-2', true], 'the unit shown, though Room 1 holds a lower priority');
  assert.equal(db.read('bookings', 'n2').status, 'overridden');
  assert.equal(db.read('bookings', 'o1').status, 'approved');

  db = new FakeFirestore();
  full(db);
  await assert.rejects(actions.submitReservation(db, memberRequest({ allowTakeover: true, takeoverUnit: 'room-3' }), 'device-a'), changed);
  await assert.rejects(actions.submitReservation(db, memberRequest({ allowTakeover: true, takeoverUnit: 'room-1', requestedUnit: 'room-4' }), 'device-a'), changed);
  assert.equal(db.all('bookings').every(booking => booking.status === 'approved' && !booking.priorityNotice), true, 'nothing changed');

  db = new FakeFirestore();
  full(db);
  db.store.delete('bookings/c3');
  const free = await actions.submitReservation(db, memberRequest({ allowTakeover: true, takeoverUnit: 'room-2' }), 'device-a');
  assert.deepEqual([free.unit, free.takeover], ['room-3', false], 'a unit that came free is booked instead');

  db = new FakeFirestore();
  full(db);
  assert.equal((await actions.submitReservation(db, memberRequest({ allowTakeover: true }), 'device-a')).unit, 'room-1', 'an older page: lowest priority first');
});

test('Admin adds, cancels and restores bookings without double-booking a unit', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'a', { assignments: { room: 'room-1' } });
  const booking = {
    date: SATURDAY, start: '11:30', end: '12:30', name: 'Hold', purpose: 'blocked', reservedFor: '',
    needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, note: 'Private'
  };
  await assert.rejects(actions.adminAdd(db, booking, 'admin'), { code: 'already-exists', message: 'Room 1 is already reserved by Holder a at that time.' });
  const { id } = await actions.adminAdd(db, { ...booking, assignments: { room: 'room-2', whiteboard: null, tv: null } }, 'admin');
  assert.equal(db.read('bookings', id).ownerUid, null);
  assert.deepEqual(await actions.readNotes(db, [id, 'a']), { [id]: 'Private' });
  await actions.adminAdd(db, { ...booking, start: '16:00', end: '17:00', note: '' }, 'admin');

  await actions.adminCancel(db, 'a', 'admin');
  await assert.rejects(actions.adminCancel(db, 'a', 'admin'), { code: 'failed-precondition', message: 'This reservation was already cancelled or replaced.' });
  seedBooking(db, 'b', { assignments: { room: 'room-1' } });
  await assert.rejects(actions.adminRestore(db, 'a', { room: 'room-1' }, 'admin'), hasCode('already-exists'));
  await assert.rejects(actions.adminRestore(db, 'a', { room: 'wb-1' }, 'admin'), { code: 'invalid-argument', message: 'Choose a study room.' });
  await actions.adminRestore(db, 'a', { room: 'room-3' }, 'admin');
  const restored = db.read('bookings', 'a');
  assert.deepEqual([restored.status, restored.assignments.room, restored.cancelledBy], ['approved', 'room-3', undefined]);
  await assert.rejects(actions.adminRestore(db, 'a', { room: 'room-4' }, 'admin'), { code: 'failed-precondition', message: 'This reservation is already confirmed.' });
});

test('Admin gives back the unit a priority reservation took from one that kept its other units', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'adm', { ownerUid: null, needs: { room: true, whiteboard: false, tv: true }, assignments: { room: null, tv: 'tv-1' },
    priorityNotice: { kind: 'released', fromUnit: 'room-1' } });
  seedBooking(db, 'c1', { purpose: 'contact', assignments: { room: 'room-1' } });
  await assert.rejects(actions.adminRestore(db, 'adm', { room: 'room-1' }, 'admin'), hasCode('already-exists'));
  await assert.rejects(actions.adminRestore(db, 'adm', { tv: 'tv-2' }, 'admin'), { code: 'invalid-argument', message: 'Choose a study room.' });
  await actions.adminRestore(db, 'adm', { room: 'room-2', tv: 'tv-3' }, 'admin');
  const saved = db.read('bookings', 'adm');
  assert.deepEqual(saved.assignments, { room: 'room-2', whiteboard: null, tv: 'tv-1' }, 'only the missing room is assigned');
  assert.equal(saved.priorityNotice, undefined);
});

test('older records without needs restore the units they held', async () => {
  const db = new FakeFirestore();
  db.seed('bookings', 'old', { date: SATURDAY, start: '11:00', end: '12:00', name: 'Sister Old Record', purpose: 'meeting', status: 'cancelled', ownerUid: 'x', assignments: { room: 'room-1' } });
  db.seed('bookings', 'empty', { date: SATURDAY, start: '11:00', end: '12:00', name: 'Brother Empty', purpose: 'other', status: 'overridden', ownerUid: 'x', assignments: {} });
  await actions.adminRestore(db, 'old', { room: 'room-2' }, 'admin');
  assert.deepEqual(db.read('bookings', 'old').assignments, { room: 'room-2', whiteboard: null, tv: null });
  await assert.rejects(actions.adminRestore(db, 'empty', { room: 'room-3' }, 'admin'),
    { code: 'failed-precondition', message: 'This reservation has no room, whiteboard or TV to restore.' });
});

test('Admin ends early by the same rules', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'm', { start: '11:00', end: '13:00', ownerUid: 'device-a', assignments: { room: 'room-1' } });
  assert.deepEqual(await actions.endEarly(db, 'm', '12:00', null, 'admin'), { end: '12:00' });
  assert.equal(db.read('bookings', 'm').updatedBy, 'admin');
  await assert.rejects(actions.endEarly(db, 'm', '12:15', null, 'admin'), { code: 'failed-precondition', message: 'Choose an earlier end time on the 30-minute grid.' });
  await assert.rejects(actions.endEarly(db, 'm', '12:00', null, 'admin'), hasCode('failed-precondition'));
});

test('notes can be saved, cleared and read only by id', async () => {
  const db = new FakeFirestore();
  await actions.saveNote(db, 'a', '  Keys at the desk\nCall first ', 'admin');
  assert.deepEqual(await actions.readNotes(db, ['a']), { a: 'Keys at the desk\nCall first' });
  assert.equal(db.read('privateBookingNotes', 'a').updatedBy, 'admin');
  await actions.saveNote(db, 'a', '', 'admin');
  assert.deepEqual(await actions.readNotes(db, ['a']), {});
  assert.deepEqual(await actions.readNotes(db, []), {});
  await actions.saveNote(db, 'b', 'n'.repeat(1000), 'admin');
  await assert.rejects(actions.saveNote(db, 'b', 'n'.repeat(1001), 'admin'), { code: 'invalid-argument', message: 'Notes must be 1000 characters or fewer.' });
  for (const note of [null, undefined, 42, ['x']]) {
    await assert.rejects(actions.saveNote(db, 'b', note, 'admin'), { code: 'invalid-argument', message: 'Notes must be text.' });
  }
  assert.equal(db.read('privateBookingNotes', 'b').note.length, 1000, 'a bad save never deletes the note');
  await assert.rejects(actions.readNotes(db, ['../x']), hasCode('invalid-argument'));
  await assert.rejects(actions.readNotes(db, 'a'), { code: 'invalid-argument', message: 'Choose reservations to read notes for.' });
  await assert.rejects(actions.readNotes(db, Array(401).fill('a')), { code: 'invalid-argument', message: 'Too many notes requested.' });
  assert.deepEqual(await actions.readNotes(db, Array(400).fill('b')), { b: 'n'.repeat(1000) });
});

test('reservation ids are letters, digits, - and _ only', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'x'.repeat(160), { ownerUid: 'device-a', assignments: { room: 'room-1' } });
  await actions.cancelReservation(db, 'x'.repeat(160), 'device-a');
  for (const id of ['', 'x'.repeat(161), '..', 'a/b', 'a:b', 'a b', 42, null]) {
    await assert.rejects(actions.cancelReservation(db, id, 'device-a'), { code: 'invalid-argument', message: 'Reservation ID is missing.' }, String(id));
  }
});

test('notes for many reservations are read in chunks', async () => {
  const db = new FakeFirestore();
  const ids = Array.from({ length: 250 }, (_, index) => `b${index}`);
  ids.filter((id, index) => index % 2).forEach(id => db.seed('privateBookingNotes', id, { note: `Note ${id}` }));
  const calls = [];
  const getAll = db.getAll.bind(db);
  db.getAll = (...refs) => { calls.push(refs.length); return getAll(...refs); };
  const notes = await actions.notesFor(db, [...ids, ...ids]);
  assert.deepEqual(calls, [100, 100, 50]);
  assert.equal(Object.keys(notes).length, 125);
  assert.equal(notes.b1, 'Note b1');
  assert.deepEqual(await actions.notesFor(db, []), {});
});

test('old records go in bounded batches with their notes, and expired Admin records go too', async () => {
  const db = new FakeFirestore();
  const now = local(SATURDAY, '12:00');
  seedBooking(db, 'kept', { date: '2026-08-08' });
  seedBooking(db, 'old', { date: '2026-08-07' });
  db.seed('privateBookingNotes', 'old', { note: 'Old' });
  db.seed('privateBookingNotes', 'kept', { note: 'Kept' });
  db.seed('adminSessions', 'expired', { uid: 'x', expiresAt: Timestamp.fromMillis(now.getTime() - 1) });
  db.seed('adminSessions', 'current', { uid: 'x', expiresAt: Timestamp.fromMillis(now.getTime() + 60000) });
  db.seed('adminRateLimits', 'stale', { attempts: 9, updatedAt: Timestamp.fromMillis(now.getTime() - 16 * 60000) });
  db.seed('adminRateLimits', 'recent', { attempts: 9, updatedAt: Timestamp.fromMillis(now.getTime() - 14 * 60000) });
  assert.deepEqual(await actions.removeOldRecords(db, now), { removed: 1, more: false });
  assert.equal(db.read('bookings', 'old'), undefined, 'dated 57 days ago');
  assert.equal(db.read('privateBookingNotes', 'old'), undefined);
  assert.notEqual(db.read('bookings', 'kept'), undefined, 'dated 56 days ago');
  assert.notEqual(db.read('privateBookingNotes', 'kept'), undefined);
  assert.deepEqual(db.all('adminSessions').map(item => item.id), ['current']);
  assert.deepEqual(db.all('adminRateLimits').map(item => item.id), ['recent']);

  for (let index = 0; index < 251; index += 1) seedBooking(db, `old${String(index).padStart(3, '0')}`, { date: '2026-07-01' });
  const writes = [];
  const batch = db.batch.bind(db);
  db.batch = () => {
    const inner = batch();
    let count = 0;
    return { delete: ref => { count += 1; inner.delete(ref); }, commit: () => { writes.push(count); return inner.commit(); } };
  };
  assert.deepEqual(await actions.removeOldRecords(db, now), { removed: 250, more: true });
  assert.equal(writes[0], 500, 'one batch of at most 500 writes');
  assert.deepEqual(await actions.removeOldRecords(db, now), { removed: 1, more: false });
  assert.deepEqual(await actions.removeOldRecords(db, now), { removed: 0, more: false });

  for (let index = 0; index < 250; index += 1) seedBooking(db, `again${String(index).padStart(3, '0')}`, { date: '2026-07-01' });
  assert.deepEqual(await actions.removeOldRecords(db, now), { removed: 250, more: false }, 'exactly 250 leaves nothing more');
});
