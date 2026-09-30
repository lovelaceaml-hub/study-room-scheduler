'use strict';

// Rules that need no database. Every name here is fictional.

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const schedule = require('../lib/schedule');
const bookings = require('../lib/bookings');
const { publicName } = require('../lib/names');
const { memberView, lobbyView } = require('../lib/views');

// Thursday, October 1, 2026, 9:00 AM in Las Vegas.
const THURSDAY = new Date('2026-10-01T16:00:00Z');
const SATURDAY = '2026-10-03';
const TUESDAY = '2026-10-06';

function approved(fields) {
  return {
    status: 'approved',
    date: SATURDAY,
    needs: { room: true, whiteboard: false, tv: false },
    ...fields,
    assignments: { room: null, whiteboard: null, tv: null, ...fields.assignments }
  };
}

function withSpecialDay(day, run) {
  config.SPECIAL_DAYS.push(day);
  try { run(); } finally { config.SPECIAL_DAYS.pop(); }
}

// ---------- Dates and times ----------

test('members can book the Tuesday and Saturday in the next seven days', () => {
  assert.deepEqual(schedule.bookableDates(THURSDAY), [SATURDAY, TUESDAY]);
  // Saturday itself, just before midnight local time (07:30 UTC Sunday).
  assert.deepEqual(schedule.bookableDates(new Date('2026-10-04T06:30:00Z')), [SATURDAY, TUESDAY]);
  assert.deepEqual(schedule.bookableDates(new Date('2026-10-04T07:30:00Z')), [TUESDAY, '2026-10-10']);
});

test('the lobby also shows today when today is not a booking day', () => {
  assert.deepEqual(schedule.lobbyDates(THURSDAY), ['2026-10-01', SATURDAY, TUESDAY]);
});

test('a special day is bookable from its opening day through the day itself', () => {
  const day = { date: '2026-10-12', opens: '2026-10-05', services: [{ start: '10:00', end: '11:00', label: 'Morning service' }] };
  withSpecialDay(day, () => {
    assert.equal(schedule.bookableDates(THURSDAY).includes('2026-10-12'), false);
    assert.equal(schedule.bookableDates(new Date('2026-10-05T16:00:00Z')).includes('2026-10-12'), true);
    assert.equal(schedule.bookableDates(new Date('2026-10-13T16:00:00Z')).includes('2026-10-12'), false);
    assert.deepEqual(schedule.servicesOn('2026-10-12'), day.services);
  });
});

test('a special day on a regular weekday replaces that day\'s services', () => {
  withSpecialDay({ date: SATURDAY, opens: '2026-09-26', services: [] }, () => {
    assert.equal(schedule.timeError(SATURDAY, '10:00', '11:00', THURSDAY), null);
  });
  assert.equal(schedule.timeError(SATURDAY, '10:00', '11:00', THURSDAY), 'That time overlaps a service.');
});

test('reservation times stay on the grid, inside hours and clear of services', () => {
  const error = (date, start, end) => schedule.timeError(date, start, end, THURSDAY);
  assert.equal(error(SATURDAY, '22:30', '23:00'), null);
  assert.equal(error(SATURDAY, '11:00', '14:30'), null, 'ending as a service starts is fine');
  assert.equal(error(SATURDAY, '15:30', '16:00'), null, 'starting as a service ends is fine');
  assert.equal(error(SATURDAY, '14:00', '15:00'), 'That time overlaps a service.');
  assert.equal(error(TUESDAY, '10:00', '11:00'), null, 'Tuesday has no morning service');
  assert.equal(error(TUESDAY, '19:00', '20:00'), 'That time overlaps a service.');
  assert.equal(error(SATURDAY, '11:15', '12:00'), 'Times must be on the 30-minute grid.');
  assert.equal(error(SATURDAY, '22:30', '24:00'), 'Times must use HH:MM format.');
  assert.equal(error(SATURDAY, '22:30', '23:30'), 'Reservations must be between 10:00 AM and 11:00 PM.');
  assert.equal(error(SATURDAY, '09:30', '10:30'), 'Reservations must be between 10:00 AM and 11:00 PM.');
  assert.equal(error(SATURDAY, '12:00', '12:00'), 'Reservations must be between 10:00 AM and 11:00 PM.');
  assert.equal(error('2026-10-02', '12:00', '13:00'), 'That day is not open for reservations.');
  assert.equal(error('2026-10-10', '12:00', '13:00'), 'That day is not open for reservations.');
});

test('a start time is in the past once its slot has gone by', () => {
  const saturdayAt = time => new Date(`${SATURDAY}T${time}:00-07:00`);
  assert.equal(schedule.hasPassed(SATURDAY, '14:00', saturdayAt('14:20')), false, 'the slot under way can be booked');
  assert.equal(schedule.hasPassed(SATURDAY, '13:30', saturdayAt('14:20')), true);
  assert.equal(schedule.hasPassed(TUESDAY, '10:00', saturdayAt('22:00')), false);
  assert.throws(() => bookings.parseMemberRequest({
    date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'other', name: 'Jordan', reservedFor: 'Study'
  }, saturdayAt('13:10')), /already passed/);
});

test('ending early keeps at least one slot and stays on the grid', () => {
  assert.deepEqual(schedule.earlierEnds('11:00', '12:30'), ['11:30', '12:00']);
  assert.deepEqual(schedule.earlierEnds('11:00', '11:30'), []);
  const booking = { date: SATURDAY, start: '11:00', end: '12:30' };
  assert.equal(schedule.earlyEndError(booking, '12:00', THURSDAY), null);
  assert.match(schedule.earlyEndError(booking, '11:00', THURSDAY), /earlier end time/);
  assert.match(schedule.earlyEndError(booking, '12:30', THURSDAY), /earlier end time/);
  assert.match(schedule.earlyEndError(booking, '11:45', THURSDAY), /earlier end time/);
});

// ---------- Names ----------

test('shared screens show a title initial and first name', () => {
  assert.equal(publicName('Brother John Smith'), 'B John');
  assert.equal(publicName('sister. Grace Park'), 'S Grace');
  assert.equal(publicName('Jordan'), 'Jordan');
  assert.equal(publicName('   '), 'Reserved');
});

test('a last-name initial is added only when two people share a first name', () => {
  const others = ['Brother John Smith', 'Sister John Lee', 'Grace Park'];
  assert.equal(publicName('Brother John Smith', others), 'B John S');
  assert.equal(publicName('Sister John Lee', others), 'S John L');
  assert.equal(publicName('Grace Park', others), 'Grace');
});

// ---------- Booking rules ----------

test('a member request is checked and cleaned', () => {
  const request = bookings.parseMemberRequest({
    date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'contact',
    name: '  Jordan Example ', reservedFor: ' Sample Contact ', requestedUnit: 'room-2'
  }, THURSDAY);
  assert.deepEqual(request, {
    date: SATURDAY, start: '11:00', end: '12:00', type: 'room', requestedUnit: 'room-2',
    purpose: 'contact', allowTakeover: false, name: 'Jordan Example', reservedFor: 'Sample Contact'
  });
});

test('a member request names the field that is wrong', () => {
  const base = { date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'other', name: 'Jordan', reservedFor: 'Study' };
  const parse = changes => () => bookings.parseMemberRequest({ ...base, ...changes }, THURSDAY);
  assert.throws(parse({ name: ' ' }), /Your name is required/);
  assert.throws(parse({ reservedFor: '' }), /Purpose is required/);
  assert.throws(parse({ purpose: 'contact', reservedFor: '' }), /Contact name is required/);
  assert.throws(parse({ reservedFor: 'x'.repeat(241) }), /Purpose must be 240 characters or fewer/);
  assert.doesNotThrow(parse({ reservedFor: 'x'.repeat(240) }));
  assert.throws(parse({ purpose: 'meeting' }), /Choose what the reservation is for/);
  assert.throws(parse({ purpose: 'constructor' }), /Choose what the reservation is for/);
  assert.equal(bookings.purposeOf({ purpose: '__proto__' }), 'other');
  assert.throws(parse({ resourceType: 'podium' }), /Choose a study room, whiteboard or TV/);
  assert.throws(parse({ requestedUnit: 'wb-1' }), /Choose a valid unit/);
  assert.throws(parse({ start: '14:00', end: '15:00' }), /overlaps a service/);
});

test('the first unit free for the whole time is used, and a requested unit is never swapped', () => {
  const taken = [approved({ start: '11:00', end: '12:00', assignments: { room: 'room-1' } })];
  const candidate = { date: SATURDAY, start: '11:30', end: '12:30' };
  assert.equal(bookings.freeUnit('room', candidate, taken), 'room-2');
  assert.equal(bookings.freeUnit('room', candidate, taken, 'room-1'), null);
  assert.equal(bookings.freeUnit('room', { ...candidate, start: '12:00' }, taken, 'room-1'), 'room-1');
  const cancelled = [{ ...taken[0], status: 'cancelled' }];
  assert.equal(bookings.freeUnit('room', candidate, cancelled, 'room-1'), 'room-1');
});

function fullDay(purposes) {
  return purposes.map((purpose, index) => approved({
    id: `holder-${index + 1}`, start: '11:00', end: '12:00', purpose, name: `Holder ${index + 1}`,
    assignments: { room: `room-${index + 1}` }
  }));
}

test('Contact may take New Member or Other; New Member may take Other; Other takes nothing', () => {
  const candidate = purpose => ({ date: SATURDAY, start: '11:00', end: '12:00', purpose });
  const day = fullDay(['contact', 'blocked', 'new-member', 'other']);
  assert.equal(bookings.takeoverTarget('room', candidate('contact'), day).unitId, 'room-3');
  assert.equal(bookings.takeoverTarget('room', candidate('new-member'), day).unitId, 'room-4');
  assert.equal(bookings.takeoverTarget('room', candidate('other'), day), null);
  assert.equal(bookings.takeoverTarget('room', candidate('contact'), fullDay(['contact', 'contact', 'blocked', 'blocked'])), null);
  assert.equal(bookings.takeoverTarget('room', candidate('contact'), day, 'room-4').unitId, 'room-4');
  assert.equal(bookings.takeoverTarget('room', candidate('contact'), day, 'room-1'), null);
});

test('no takeover while any unit of that kind is free, even for a chosen unit', () => {
  const day = fullDay(['other']);
  const candidate = { date: SATURDAY, start: '11:00', end: '12:00', purpose: 'contact' };
  assert.equal(bookings.freeUnit('room', candidate, day, 'room-1'), null);
  assert.equal(bookings.takeoverTarget('room', candidate, day, 'room-1'), null);
});

test('a takeover picks the unit with the fewest reservations to disturb', () => {
  const day = [
    ...fullDay(['other', 'other', 'contact', 'contact']),
    approved({ id: 'second', start: '11:30', end: '12:00', purpose: 'other', assignments: { room: 'room-1' } })
  ];
  day[0].end = '11:30';
  const target = bookings.takeoverTarget('room', { date: SATURDAY, start: '11:00', end: '12:00', purpose: 'contact' }, day);
  assert.equal(target.unitId, 'room-2');
  assert.deepEqual(target.holders.map(holder => holder.id), ['holder-2']);
});

test('a reservation already under way is shortened; a later one is moved', () => {
  const candidate = { start: '12:00' };
  assert.equal(bookings.shortenedEnd({ start: '11:00' }, candidate), '12:00');
  assert.equal(bookings.shortenedEnd({ start: '12:00' }, candidate), null);
  assert.equal(bookings.shortenedEnd({ start: '12:30' }, candidate), null);
});

test('an Admin booking gets its needs from the units chosen', () => {
  const booking = bookings.parseAdminBooking({
    date: SATURDAY, start: '11:00', end: '12:00', name: 'Hold for cleaning', purpose: 'blocked',
    assignments: { room: 'room-2', tv: 'tv-1' }, note: ' Deep clean '
  }, THURSDAY);
  assert.deepEqual(booking.needs, { room: true, whiteboard: false, tv: true });
  assert.deepEqual(booking.assignments, { room: 'room-2', whiteboard: null, tv: 'tv-1' });
  assert.equal(booking.note, 'Deep clean');
  assert.throws(() => bookings.parseAdminBooking({ ...booking, assignments: {} }, THURSDAY), /at least one/);
  assert.throws(() => bookings.parseAdminBooking({ ...booking, assignments: { room: 'room-9' } }, THURSDAY), /valid study room/);
});

test('an overlapping booking on the same unit is a conflict', () => {
  const day = [approved({ id: 'a', name: 'Avery', start: '11:00', end: '12:00', assignments: { room: 'room-1' } })];
  const candidate = { date: SATURDAY, start: '11:30', end: '12:30', assignments: { room: 'room-1', whiteboard: null, tv: null } };
  assert.equal(bookings.conflictWith(candidate, day).name, 'Avery');
  assert.equal(bookings.conflictWith(candidate, day, 'a'), null);
  assert.equal(bookings.conflictWith({ ...candidate, assignments: { room: 'room-2' } }, day), null);
});

// ---------- What pages see ----------

const records = [
  approved({ id: 'mine', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'contact', reservedFor: 'Sample Contact', start: '11:00', end: '12:30', assignments: { room: 'room-1' } }),
  approved({ id: 'theirs', ownerUid: 'device-b', name: 'Sister John Lee', purpose: 'meeting', purposeOther: 'Older record', start: '11:00', end: '12:00', assignments: { room: 'room-2' } }),
  approved({ id: 'hold', ownerUid: null, name: 'Private hold', purpose: 'blocked', reservedFor: 'Staff only', start: '12:00', end: '13:00', assignments: { room: 'room-3' } }),
  approved({ id: 'board', ownerUid: 'device-b', name: 'Avery Example', purpose: 'other', reservedFor: 'Study', start: '16:00', end: '17:00', needs: { whiteboard: true }, assignments: { whiteboard: 'wb-4' } }),
  { ...approved({ id: 'gone', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'other', reservedFor: 'Review', start: '17:00', end: '18:00', assignments: { room: 'room-1' } }), status: 'cancelled' },
  { ...approved({ id: 'released', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'other', reservedFor: 'Review', start: '18:00', end: '19:00', assignments: {} }),
    status: 'overridden', priorityNotice: { kind: 'released', type: 'room', fromUnit: 'room-2', toUnit: null, byPurpose: 'contact', byBookingId: 'x' } }
];

test('the member schedule shows public names and marks this device\'s reservations', () => {
  const view = memberView(records, [SATURDAY], 'device-a');
  assert.deepEqual(view.days, [{ date: SATURDAY, scheduled: true, services: schedule.servicesOn(SATURDAY) }]);
  assert.deepEqual(view.bookings.map(row => [row.id, row.unit, row.name, row.purpose, row.reservedFor, row.mine]), [
    ['mine', 'room-1', 'B John S', 'contact', 'Sample Contact', true],
    ['theirs', 'room-2', 'S John L', 'other', 'Older record', false],
    ['hold', 'room-3', 'Reserved', 'blocked', '', false],
    ['board', 'wb-4', 'Avery', 'other', 'Study', false]
  ]);
  for (const row of view.bookings) {
    assert.equal('ownerUid' in row, false);
    assert.equal(row.name.includes('Smith') || row.name.includes('Private'), false);
  }
});

test('My reservations lists every status, with actions only on active ones', () => {
  const mine = memberView(records, [SATURDAY], 'device-a').mine;
  assert.deepEqual(mine.map(row => [row.id, row.status, row.unit, row.canCancel, row.canEndEarly]), [
    ['mine', 'approved', 'room-1', true, true],
    ['gone', 'cancelled', 'room-1', false, false],
    ['released', 'overridden', null, false, false]
  ]);
  assert.equal(mine[0].name, 'Brother John Smith', 'the owner sees the full name they typed');
  assert.deepEqual(mine[2].notice, { kind: 'released', fromUnit: 'room-2', toUnit: null, toEnd: null, byPurpose: 'contact' });
  assert.deepEqual(memberView(records, [SATURDAY], '').mine, []);
});

test('the lobby gets study rooms only, with public names and no private fields', () => {
  const view = lobbyView(records, [SATURDAY], THURSDAY);
  assert.deepEqual(view.bookings, [
    { date: SATURDAY, start: '11:00', end: '12:30', room: 'room-1', name: 'B John S' },
    { date: SATURDAY, start: '11:00', end: '12:00', room: 'room-2', name: 'S John L' },
    { date: SATURDAY, start: '12:00', end: '13:00', room: 'room-3', name: 'Reserved' }
  ]);
  assert.equal(view.generatedAt, THURSDAY.toISOString());
  assert.deepEqual(lobbyView([], ['2026-10-01'], THURSDAY).days, [{ date: '2026-10-01', scheduled: false, services: [] }]);
});
