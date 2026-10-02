'use strict';

// Requests that arrive at the same moment. The in-memory Firestore runs
// transactions one at a time, as Firestore's serializable transactions
// behave, so these show that every decision is made inside a transaction:
// a read made outside one would see stale data here and double-book.

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./support/fake-firestore');
const actions = require('../lib/actions');
const { useFixedClock, seedBooking, memberRequest, settle } = require('./support/fixtures');

useFixedClock();

const other = fields => memberRequest({ purpose: 'other', reservedFor: 'Study', ...fields });
const approvedOn = (db, unit) => db.all('bookings').filter(booking => booking.status === 'approved' && booking.assignments?.room === unit);

test('two members asking for the last room: one gets it, the other is told it is taken', async () => {
  const db = new FakeFirestore();
  ['1', '2', '3'].forEach(unit => seedBooking(db, `r${unit}`, { purpose: 'contact', assignments: { room: `room-${unit}` } }));
  const results = await Promise.all([
    settle(actions.submitReservation(db, other(), 'device-a')),
    settle(actions.submitReservation(db, other(), 'device-b'))
  ]);
  assert.deepEqual(results.map(result => result.ok?.unit || result.code).sort(), ['already-exists', 'room-4']);
  assert.equal(approvedOn(db, 'room-4').length, 1);
});

test('six requests at once from one device: exactly four are confirmed', async () => {
  const db = new FakeFirestore();
  const starts = ['11:00', '12:00', '13:00', '16:00', '17:00', '18:00'];
  const results = await Promise.all(starts.map(start => settle(actions.submitReservation(db,
    other({ start, end: `${Number(start.slice(0, 2)) + 1}:00` }), 'device-a'))));
  assert.equal(results.filter(result => result.ok).length, 4);
  assert.equal(results.filter(result => result.code === 'resource-exhausted').length, 2);
  assert.equal(db.all('bookings').filter(booking => booking.ownerUid === 'device-a' && booking.status === 'approved').length, 4);
});

test('the same request sent twice at once is booked once', async () => {
  const db = new FakeFirestore();
  const request = other({ requestId: 'double-tap-0123456789' });
  const [first, second] = await Promise.all([
    actions.submitReservation(db, request, 'device-a'),
    actions.submitReservation(db, request, 'device-a')
  ]);
  assert.equal(first.id, second.id);
  assert.equal(second.repeated, true);
  assert.equal(db.all('bookings').length, 1);
});

test('a takeover racing the holder\'s own cancel leaves one holder either way', async () => {
  for (const cancelFirst of [true, false]) {
    const db = new FakeFirestore();
    ['1', '2', '3', '4'].forEach(unit => seedBooking(db, `o${unit}`, { ownerUid: `device-${unit}`, assignments: { room: `room-${unit}` } }));
    const cancel = () => settle(actions.cancelReservation(db, 'o1', 'device-1'));
    const take = () => settle(actions.submitReservation(db, memberRequest({ allowTakeover: true }), 'device-c'));
    const [cancelled, taken] = cancelFirst ? await Promise.all([cancel(), take()]) : (await Promise.all([take(), cancel()])).reverse();
    assert.equal(taken.ok.unit, 'room-1');
    assert.equal(taken.ok.takeover, !cancelFirst, 'a free unit is booked without a takeover');
    assert.equal(cancelled.code, cancelFirst ? undefined : 'failed-precondition');
    assert.equal(db.read('bookings', 'o1').status, cancelFirst ? 'cancelled' : 'overridden');
    assert.equal(approvedOn(db, 'room-1').length, 1);
  }
});

test('an Admin restore racing a new booking for the same unit: one of them wins', async () => {
  for (const restoreFirst of [true, false]) {
    const db = new FakeFirestore();
    seedBooking(db, 'a', { status: 'cancelled', assignments: { room: 'room-1' } });
    ['2', '3', '4'].forEach(unit => seedBooking(db, `c${unit}`, { purpose: 'contact', assignments: { room: `room-${unit}` } }));
    const restore = () => settle(actions.adminRestore(db, 'a', { room: 'room-1' }, 'admin'));
    const book = () => settle(actions.submitReservation(db, other(), 'device-b'));
    const [restored, booked] = restoreFirst ? await Promise.all([restore(), book()]) : (await Promise.all([book(), restore()])).reverse();
    assert.equal(restored.code, restoreFirst ? undefined : 'already-exists');
    assert.equal(booked.code, restoreFirst ? 'already-exists' : undefined);
    assert.equal(approvedOn(db, 'room-1').length, 1);
  }
});

test('two Contact takeovers of the same unit: the second finds nothing left to take', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'o1', { assignments: { room: 'room-1' } });
  ['2', '3', '4'].forEach(unit => seedBooking(db, `c${unit}`, { purpose: 'contact', assignments: { room: `room-${unit}` } }));
  const results = await Promise.all(['device-a', 'device-b'].map(device =>
    settle(actions.submitReservation(db, memberRequest({ allowTakeover: true, takeoverUnit: 'room-1' }), device))));
  assert.deepEqual(results.map(result => result.ok?.unit || result.message), ['room-1', 'The schedule changed. Check the time and confirm again.']);
  assert.equal(approvedOn(db, 'room-1').length, 1);
  assert.equal(db.read('bookings', 'o1').status, 'overridden');
});

test('two Admin adds for the same unit: the second is refused', async () => {
  const db = new FakeFirestore();
  const booking = {
    date: '2026-10-03', start: '11:00', end: '12:00', name: 'Hold', purpose: 'blocked', reservedFor: '',
    needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, note: ''
  };
  const results = await Promise.all([settle(actions.adminAdd(db, booking, 'admin')), settle(actions.adminAdd(db, booking, 'admin'))]);
  assert.deepEqual(results.map(result => result.code || 'ok'), ['ok', 'already-exists']);
  assert.equal(approvedOn(db, 'room-1').length, 1);
});
