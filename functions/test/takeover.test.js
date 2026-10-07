'use strict';

// Priority takeovers against an in-memory Firestore on a fixed clock. Every
// name here is fictional.

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./support/fake-firestore');
const actions = require('../lib/actions');
const { memberView } = require('../lib/views');
const {
  SATURDAY, local, useFixedClock, setClock, seedBooking, takeoverRequest, settle, hasCode
} = require('./support/fixtures');

useFixedClock();

const contact = (db, fields) => takeoverRequest(db, fields);

// Contact reservations on every room except `free`, 11:00 to 14:00.
function contactsOn(db, except = []) {
  ['1', '2', '3', '4'].filter(unit => !except.includes(unit))
    .forEach(unit => seedBooking(db, `c${unit}`, { purpose: 'contact', start: '11:00', end: '14:00', assignments: { room: `room-${unit}` } }));
}

test('an Admin reservation keeps its TV when its room is taken, and is replaced once it holds nothing', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'adm', { ownerUid: null, name: 'Brother Admin Booked', needs: { room: true, whiteboard: false, tv: true }, assignments: { room: 'room-1', tv: 'tv-1' } });
  ['2', '3', '4'].forEach(unit => seedBooking(db, `r${unit}`, { purpose: 'contact', assignments: { room: `room-${unit}` } }));
  ['2', '3'].forEach(unit => seedBooking(db, `t${unit}`, { purpose: 'contact', needs: { room: false, whiteboard: false, tv: true }, assignments: { tv: `tv-${unit}` } }));

  await actions.submitReservation(db, contact(db, { resourceType: 'tv' }), 'device-1');
  let saved = db.read('bookings', 'adm');
  assert.deepEqual([saved.status, saved.assignments, saved.priorityNotice.kind], ['approved', { room: 'room-1', whiteboard: null, tv: null }, 'released']);

  await actions.submitReservation(db, contact(db), 'device-2');
  saved = db.read('bookings', 'adm');
  assert.deepEqual([saved.status, saved.assignments, saved.priorityNotice.kind], ['overridden', { room: null, whiteboard: null, tv: null }, 'released']);
  const rows = memberView(db.all('bookings'), [SATURDAY], 'x').bookings;
  assert.equal(rows.some(row => row.id === 'adm'), false);
});

test('displaced reservations get the free units in priority order, then oldest first', async () => {
  // Room 2 is taken until 11:30, so it cannot take the 11:00 Contact
  // reservation, but it has room for one of the two displaced from Room 1.
  const competing = (first, second) => {
    const db = new FakeFirestore();
    contactsOn(db, ['1', '2']);
    seedBooking(db, 'early', { purpose: 'contact', start: '11:00', end: '11:30', assignments: { room: 'room-2' } });
    for (const [id, fields] of [first, second]) seedBooking(db, id, { ...fields, start: '11:30', end: '12:00', assignments: { room: 'room-1' } });
    return db;
  };
  let db = competing(['other-new', { purpose: 'other', createdAt: 5 }], ['other-old', { purpose: 'other', createdAt: 1 }]);
  await actions.submitReservation(db, contact(db), 'device-c');
  assert.equal(db.read('bookings', 'other-old').assignments.room, 'room-2', 'the older reservation moves');
  assert.equal(db.read('bookings', 'other-new').status, 'overridden');

  db = competing(['other', { purpose: 'other', createdAt: 1 }], ['member', { purpose: 'new-member', createdAt: 5 }]);
  await actions.submitReservation(db, contact(db), 'device-c');
  assert.equal(db.read('bookings', 'member').assignments.room, 'room-2', 'New Member before Other');
  assert.equal(db.read('bookings', 'other').status, 'overridden');
});

test('a shortened reservation is told when it now ends and which unit took its place', async () => {
  const db = new FakeFirestore();
  contactsOn(db, ['1']);
  seedBooking(db, 'h', { purpose: 'other', ownerUid: 'device-h', start: '11:00', end: '14:00', assignments: { room: 'room-1' } });
  const taken = await actions.submitReservation(db, contact(db, { purpose: 'new-member', reservedFor: 'Sample Member', start: '12:00', end: '13:00' }), 'device-c');
  const saved = db.read('bookings', 'h');
  assert.equal(saved.end, '12:00');
  const { at, ...notice } = saved.priorityNotice;
  assert.deepEqual(notice, {
    type: 'room', fromUnit: 'room-1', byPurpose: 'new-member', byBookingId: taken.id, forced: false, kind: 'shortened', toUnit: 'room-1', fromEnd: '14:00', toEnd: '12:00'
  });
  const mine = memberView(db.all('bookings'), [SATURDAY], 'device-h').mine[0];
  assert.deepEqual(mine.notice, { kind: 'shortened', fromUnit: 'room-1', toUnit: 'room-1', fromEnd: '14:00', toEnd: '12:00', byPurpose: 'new-member', forced: false });
});

test('holds are never taken, Contact never takes Contact, and Other cannot take anything', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'hold', { purpose: 'blocked', ownerUid: null, assignments: { room: 'room-1' } });
  ['2', '3'].forEach(unit => seedBooking(db, `c${unit}`, { purpose: 'contact', assignments: { room: `room-${unit}` } }));
  seedBooking(db, 'o4', { purpose: 'other', assignments: { room: 'room-4' } });
  await assert.rejects(actions.submitReservation(db, contact(db, { purpose: 'other', reservedFor: 'Study' }), 'device-a'), hasCode('already-exists'));
  await assert.rejects(actions.submitReservation(db, contact(db, { requestedUnit: 'room-1' }), 'device-a'), hasCode('already-exists'));
  await assert.rejects(actions.submitReservation(db, contact(db, { takeoverUnit: 'room-2' }), 'device-a'), hasCode('already-exists'));
  assert.equal((await actions.submitReservation(db, contact(db), 'device-a')).unit, 'room-4');
  await assert.rejects(actions.submitReservation(db, contact(db), 'device-b'), hasCode('already-exists'), 'now every room is held by Contact or a hold');
  assert.equal(db.read('bookings', 'hold').status, 'approved');
});

test('the least important reservations are taken first', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'n1', { purpose: 'new-member', assignments: { room: 'room-1' } });
  seedBooking(db, 'o2a', { purpose: 'other', start: '11:00', end: '11:30', assignments: { room: 'room-2' } });
  seedBooking(db, 'o2b', { purpose: 'other', start: '11:30', end: '12:00', assignments: { room: 'room-2' } });
  seedBooking(db, 'n3', { purpose: 'new-member', assignments: { room: 'room-3' } });
  seedBooking(db, 'c4', { purpose: 'contact', assignments: { room: 'room-4' } });
  const first = await actions.submitReservation(db, contact(db), 'device-a');
  assert.equal(first.unit, 'room-2', 'two Other reservations before one New Member');
  assert.deepEqual([db.read('bookings', 'o2a').status, db.read('bookings', 'o2b').status], ['overridden', 'overridden']);
  assert.equal((await actions.submitReservation(db, contact(db), 'device-b')).unit, 'room-1', 'then New Members, in unit order');
  assert.equal(db.read('bookings', 'n3').status, 'approved');
});

test('a requested unit is the only one a takeover considers', async () => {
  const db = new FakeFirestore();
  ['1', '2', '3', '4'].forEach(unit => seedBooking(db, `o${unit}`, { purpose: 'other', assignments: { room: `room-${unit}` } }));
  assert.equal((await actions.submitReservation(db, contact(db, { requestedUnit: 'room-3' }), 'device-a')).unit, 'room-3');
  assert.equal((await actions.submitReservation(db, contact(db, { requestedUnit: 'room-4', takeoverUnit: 'room-4' }), 'device-b')).unit, 'room-4');
  assert.equal(db.read('bookings', 'o1').status, 'approved');
});

test('a reservation already under way is shortened, never moved or released', async () => {
  // At 11:10 the earliest start is 11:30, so a holder from 11:00 began earlier.
  let db = new FakeFirestore();
  contactsOn(db, ['4']);
  seedBooking(db, 'now', { purpose: 'other', ownerUid: 'device-h', start: '11:00', end: '12:00', assignments: { room: 'room-4' } });
  setClock(local(SATURDAY, '11:10'));
  await assert.rejects(Promise.resolve().then(() => contact(db, { start: '11:00', end: '12:00' })), /already passed/);
  await actions.submitReservation(db, contact(db, { start: '11:30', end: '12:30' }), 'device-c');
  let saved = db.read('bookings', 'now');
  assert.deepEqual([saved.status, saved.assignments.room, saved.end], ['approved', 'room-4', '11:30']);

  // 30 seconds after 11:00 a priority reservation may start at 11:00, and one
  // that began at 10:30 ends then.
  db = new FakeFirestore();
  contactsOn(db, ['4']);
  seedBooking(db, 'begun', { purpose: 'other', start: '10:30', end: '12:00', assignments: { room: 'room-4' } });
  setClock(local(SATURDAY, '11:00:30'));
  await actions.submitReservation(db, contact(db, { start: '11:00', end: '12:00' }), 'device-c');
  saved = db.read('bookings', 'begun');
  assert.deepEqual([saved.status, saved.assignments.room, saved.end], ['approved', 'room-4', '11:00']);

  // One that began this very minute, at the same time, cannot be shortened,
  // so its unit is not taken at all.
  db = new FakeFirestore();
  contactsOn(db, ['4']);
  seedBooking(db, 'same', { purpose: 'other', start: '11:00', end: '12:00', assignments: { room: 'room-4' } });
  setClock(local(SATURDAY, '11:00:40'));
  await assert.rejects(actions.submitReservation(db, contact(db, { start: '11:00', end: '12:00' }), 'device-c'), hasCode('already-exists'));
  saved = db.read('bookings', 'same');
  assert.deepEqual([saved.status, saved.assignments.room, saved.end], ['approved', 'room-4', '12:00']);
});

test('a moved reservation is told where it went, and loses the notice once cancelled', async () => {
  const db = new FakeFirestore();
  contactsOn(db, ['1', '2']);
  seedBooking(db, 'early', { purpose: 'contact', start: '11:00', end: '11:30', assignments: { room: 'room-2' } });
  seedBooking(db, 'm', { purpose: 'other', ownerUid: 'device-m', start: '11:30', end: '12:00', assignments: { room: 'room-1' } });
  await actions.submitReservation(db, contact(db, { start: '11:00', end: '12:00' }), 'device-c');
  assert.deepEqual(memberView(db.all('bookings'), [SATURDAY], 'device-m').mine[0].notice,
    { kind: 'moved', fromUnit: 'room-1', toUnit: 'room-2', fromEnd: null, toEnd: null, byPurpose: 'contact', forced: false });
  await actions.cancelReservation(db, 'm', 'device-m');
  assert.equal(memberView(db.all('bookings'), [SATURDAY], 'device-m').mine[0].notice, null);
});

test('a cancelled priority reservation does not bring back what it displaced', async () => {
  const db = new FakeFirestore();
  contactsOn(db, ['1']);
  seedBooking(db, 'x', { purpose: 'other', ownerUid: 'device-x', assignments: { room: 'room-1' } });
  const taken = await actions.submitReservation(db, contact(db), 'device-p');
  await actions.cancelReservation(db, taken.id, 'device-p');
  assert.equal(db.read('bookings', 'x').status, 'overridden');
  assert.equal((await settle(actions.cancelReservation(db, 'x', 'device-x'))).code, 'failed-precondition');
});

// ---------- Force override ----------

// A Force override as the page sends it: the warning confirmed, with the
// unit the page showed.
const force = (db, fields = {}) => takeoverRequest(db, { ...fields, forceOverride: true });

test('a Force override takes a Contact reservation, and the holder is told it was forced', async () => {
  const db = new FakeFirestore();
  contactsOn(db, ['4']);
  seedBooking(db, 'c4', { purpose: 'contact', ownerUid: 'device-h', start: '11:00', end: '14:00', assignments: { room: 'room-4' } });
  await assert.rejects(actions.submitReservation(db, contact(db), 'device-a'), hasCode('already-exists'), 'priority alone cannot take Contact');
  const result = await actions.submitReservation(db, force(db, { takeoverUnit: 'room-4', start: '12:00', end: '13:00' }), 'device-a');
  assert.deepEqual(result, { id: result.id, unit: 'room-4', takeover: true });
  assert.equal(db.read('bookings', result.id).forced, true);
  const holder = db.read('bookings', 'c4');
  assert.equal(holder.end, '12:00', 'began earlier, so it is shortened');
  assert.equal(holder.priorityNotice.forced, true);
  assert.deepEqual(memberView(db.all('bookings'), [SATURDAY], 'device-h').mine[0].notice,
    { kind: 'shortened', fromUnit: 'room-4', toUnit: 'room-4', fromEnd: '14:00', toEnd: '12:00', byPurpose: 'contact', forced: true });
});

test('a Force override takes the lowest priority first and never a hold or a reservation under way', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'hold', { purpose: 'blocked', ownerUid: null, assignments: { room: 'room-1' } });
  seedBooking(db, 'c2', { purpose: 'contact', assignments: { room: 'room-2' } });
  seedBooking(db, 'n3', { purpose: 'new-member', assignments: { room: 'room-3' } });
  seedBooking(db, 'c4', { purpose: 'contact', assignments: { room: 'room-4' } });
  const first = await actions.submitReservation(db, force(db, { purpose: 'other', reservedFor: 'Study' }), 'device-a');
  assert.equal(first.unit, 'room-3', 'Other may force a New Member, lowest priority first');
  assert.equal(db.read('bookings', 'n3').status, 'overridden');
  await assert.rejects(actions.submitReservation(db, force(db, { takeoverUnit: 'room-1', requestedUnit: 'room-1' }), 'device-b'), hasCode('already-exists'), 'a hold is never taken');
  setClock(local(SATURDAY, '11:00'));
  await assert.rejects(actions.submitReservation(db, force(db, { takeoverUnit: 'room-2', start: '11:00', end: '12:00' }), 'device-b'), hasCode('already-exists'));
  assert.equal(db.read('bookings', 'c2').end, '12:00', 'a reservation that began this very minute is not taken');
  setClock(local(SATURDAY, '11:10'));
  const later = await actions.submitReservation(db, force(db, { takeoverUnit: 'room-2', start: '11:30', end: '12:00' }), 'device-b');
  assert.equal(later.unit, 'room-2');
  assert.equal(db.read('bookings', 'c2').end, '11:30', 'once under way it is shortened');
});

test('a Force override may take the unit the member chose even while another is free', async () => {
  const db = new FakeFirestore();
  seedBooking(db, 'c1', { purpose: 'contact', assignments: { room: 'room-1' } });
  const result = await actions.submitReservation(db, force(db, { requestedUnit: 'room-1', takeoverUnit: 'room-1' }), 'device-a');
  assert.equal(result.unit, 'room-1');
  assert.equal(db.read('bookings', 'c1').status, 'approved', 'moved, not replaced');
  assert.equal(db.read('bookings', 'c1').assignments.room, 'room-2');
  const plain = await actions.submitReservation(db, force(db, { takeoverUnit: 'room-1' }), 'device-b');
  assert.deepEqual([plain.unit, plain.takeover], ['room-3', false], 'without a chosen unit a free one is used');
});
