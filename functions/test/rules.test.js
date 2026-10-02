'use strict';

// Rules that need no database. Every name here is fictional, and no test
// depends on today's real date or on the special days in config.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const schedule = require('../lib/schedule');
const bookings = require('../lib/bookings');
const { publicName } = require('../lib/names');
const { configProblems } = require('../lib/config-check');
const { clientConfig, memberView, lobbyView, adminRows } = require('../lib/views');
const { THURSDAY, SATURDAY, TUESDAY, local, useFixedClock } = require('./support/fixtures');

useFixedClock();

// Saturday before the morning service: Saturday and Tuesday are both open.
const SATURDAY_MORNING = local(SATURDAY, '08:00');

function approved(fields) {
  return {
    status: 'approved',
    date: SATURDAY,
    start: '11:00',
    end: '12:00',
    needs: { room: true, whiteboard: false, tv: false },
    ...fields,
    assignments: { room: null, whiteboard: null, tv: null, ...fields.assignments }
  };
}

// ---------- Dates and times ----------

test('members and Admin can book today plus the next 3 days', () => {
  assert.equal(config.BOOKING_WINDOW_DAYS, 4);
  const open = date => schedule.bookableDates(date);
  assert.deepEqual(open(local('2026-09-30', '09:00')), [SATURDAY], 'Wednesday: Saturday');
  assert.deepEqual(open(THURSDAY), [SATURDAY]);
  assert.deepEqual(open(SATURDAY_MORNING), [SATURDAY, TUESDAY], 'Saturday: Saturday and Tuesday');
  assert.deepEqual(open(local(SATURDAY, '23:59')), [SATURDAY, TUESDAY]);
  assert.deepEqual(open(local('2026-10-04', '00:00')), [TUESDAY], 'Sunday: Tuesday');
  assert.deepEqual(open(local('2026-10-05', '12:00')), [TUESDAY], 'Monday: Tuesday');
  assert.deepEqual(open(local(TUESDAY, '12:00')), [TUESDAY]);
  assert.deepEqual(open(local('2026-10-07', '00:00')), ['2026-10-10'], 'the next Wednesday: the next Saturday');
});

test('the lobby also shows today when today is not a booking day', () => {
  assert.deepEqual(schedule.lobbyDates(THURSDAY), ['2026-10-01', SATURDAY]);
  assert.deepEqual(schedule.lobbyDates(local('2026-10-04', '12:00')), ['2026-10-04', TUESDAY]);
});

test('a special day is bookable from its opening day through the day itself', () => {
  const day = { date: '2026-10-12', opens: '2026-10-05', services: [{ start: '10:00', end: '11:00', label: 'Morning service' }] };
  config.SPECIAL_DAYS.push(day);
  assert.equal(schedule.bookableDates(THURSDAY).includes('2026-10-12'), false);
  assert.equal(schedule.bookableDates(local('2026-10-05', '00:00')).includes('2026-10-12'), true, 'a week ahead, outside the window');
  assert.equal(schedule.bookableDates(local('2026-10-12', '22:00')).includes('2026-10-12'), true);
  assert.equal(schedule.bookableDates(local('2026-10-13', '09:00')).includes('2026-10-12'), false);
  assert.deepEqual(schedule.servicesOn('2026-10-12'), day.services);
  assert.deepEqual(schedule.lobbyDates(local('2026-10-12', '09:00')), ['2026-10-12', '2026-10-13']);
});

test('a special day on a regular booking day obeys its own opening day and services', () => {
  // The next Saturday would normally open on Wednesday, October 7.
  config.SPECIAL_DAYS.push({ date: '2026-10-10', opens: '2026-10-09', services: [] });
  assert.deepEqual(schedule.bookableDates(local('2026-10-07', '12:00')), []);
  assert.equal(schedule.timeError('2026-10-10', '10:00', '11:00', local('2026-10-07', '12:00')), 'That day is not open for reservations.');
  assert.deepEqual(schedule.bookableDates(local('2026-10-09', '00:00')), ['2026-10-10']);
  assert.equal(schedule.timeError('2026-10-10', '10:00', '11:00', local('2026-10-09', '00:00')), null, 'no morning service that day');

  // Opening earlier than usual works too.
  config.SPECIAL_DAYS.push({ date: SATURDAY, opens: '2026-09-26', services: [] });
  assert.deepEqual(schedule.bookableDates(local('2026-09-28', '12:00')), ['2026-09-29', SATURDAY]);
  assert.equal(schedule.timeError(SATURDAY, '10:00', '11:00', THURSDAY), null);
  config.SPECIAL_DAYS.length = 0;
  assert.equal(schedule.timeError(SATURDAY, '10:00', '11:00', THURSDAY), 'That time overlaps a service.');
});

test('reservation times stay on the grid, inside hours and clear of services', () => {
  const error = (date, start, end) => schedule.timeError(date, start, end, SATURDAY_MORNING);
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
  assert.equal(error('2026-10-05', '12:00', '13:00'), 'That day is not open for reservations.');
  assert.equal(error('2026-10-10', '12:00', '13:00'), 'That day is not open for reservations.');
  assert.equal(schedule.timeError(TUESDAY, '12:00', '13:00', THURSDAY), 'That day is not open for reservations.', 'Tuesday opens on Saturday');
});

test('nothing that has already started can be reserved, to the minute', () => {
  const at = time => local(SATURDAY, time);
  assert.equal(schedule.hasPassed(SATURDAY, '11:00', at('11:10')), true, 'at 11:10, 11:00 has started');
  assert.equal(schedule.hasPassed(SATURDAY, '11:30', at('11:10')), false, 'at 11:10, 11:30 is the earliest start');
  assert.equal(schedule.hasPassed(SATURDAY, '11:00', at('11:00:00')), false, 'at exactly 11:00, 11:00 is still open');
  assert.equal(schedule.hasPassed(SATURDAY, '11:00', at('11:00:59')), false);
  assert.equal(schedule.hasPassed(SATURDAY, '11:00', at('11:01')), true);
  assert.equal(schedule.hasPassed(SATURDAY, '22:30', local('2026-10-04', '00:10')), true, 'a past date');
  assert.equal(schedule.hasPassed(TUESDAY, '10:00', at('22:00')), false, 'a later date');
  assert.throws(() => bookings.parseMemberRequest({
    date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'other', name: 'Jordan', reservedFor: 'Study'
  }, at('11:10')), /already passed/);
  assert.doesNotThrow(() => bookings.parseMemberRequest({
    date: SATURDAY, start: '11:30', end: '12:00', resourceType: 'room', purpose: 'other', name: 'Jordan', reservedFor: 'Study'
  }, at('11:10')));
});

test('a reservation has ended once its end time arrives', () => {
  assert.equal(schedule.hasEnded(SATURDAY, '12:00', local(SATURDAY, '11:59')), false);
  assert.equal(schedule.hasEnded(SATURDAY, '12:00', local(SATURDAY, '12:00')), true);
  assert.equal(schedule.hasEnded(SATURDAY, '23:00', local('2026-10-04', '00:00')), true);
  assert.equal(schedule.hasEnded(TUESDAY, '11:00', SATURDAY_MORNING), false);
});

test('ending early keeps at least one slot, stays on the grid, and never picks a passed end', () => {
  assert.deepEqual(schedule.earlierEnds('11:00', '12:30'), ['11:30', '12:00']);
  assert.deepEqual(schedule.earlierEnds('11:00', '11:30'), []);
  assert.deepEqual(schedule.earlierEnds('bad', '11:30'), []);
  const booking = { date: SATURDAY, start: '11:00', end: '12:30' };
  const at = time => local(SATURDAY, time);
  assert.deepEqual(schedule.earlyEnds(booking, THURSDAY), ['11:30', '12:00']);
  assert.deepEqual(schedule.earlyEnds(booking, at('11:10')), ['11:30', '12:00'], 'at 11:10 the earliest new end is 11:30');
  assert.deepEqual(schedule.earlyEnds(booking, at('11:30')), ['11:30', '12:00']);
  assert.deepEqual(schedule.earlyEnds(booking, at('11:31')), ['12:00']);
  assert.deepEqual(schedule.earlyEnds(booking, at('12:10')), []);
  assert.deepEqual(schedule.earlyEnds(null, THURSDAY), []);
  assert.equal(schedule.earlyEndError(booking, '12:00', THURSDAY), null);
  assert.match(schedule.earlyEndError(booking, '11:00', THURSDAY), /earlier end time/);
  assert.match(schedule.earlyEndError(booking, '12:30', THURSDAY), /earlier end time/);
  assert.match(schedule.earlyEndError(booking, '11:45', THURSDAY), /earlier end time/);
  assert.match(schedule.earlyEndError(null, '11:30', THURSDAY), /earlier end time/);
  assert.equal(schedule.earlyEndError(booking, '11:30', at('11:40')), 'Choose an end time from now on.');
});

// ---------- Names ----------

test('shared screens show a title initial and first name', () => {
  assert.equal(publicName('Brother John Smith'), 'B John');
  assert.equal(publicName('sister. Grace Park'), 'S Grace');
  assert.equal(publicName('Jordan'), 'Jordan');
  assert.equal(publicName('E Kim'), 'E Kim');
});

test('Bro. and Sis. are titles like Brother and Sister', () => {
  assert.equal(publicName('Bro. John Smith'), 'B John');
  assert.equal(publicName('bro John Smith'), 'B John');
  assert.equal(publicName('Sis. Grace Park'), 'S Grace');
  assert.equal(publicName('SIS Grace'), 'S Grace');
  assert.equal(publicName('Bro. John Smith', ['Bro. John Smith', 'Sis. John Lee']), 'B John S');
});

test('a name that is only a title shows that word, never "Reserved"', () => {
  assert.equal(publicName('Brother'), 'Brother');
  assert.equal(publicName('  Bro.  '), 'Bro.');
  assert.equal(publicName('Sis'), 'Sis');
  assert.equal(publicName('Sister,'), 'Sister');
  assert.equal(publicName('   '), 'Reserved', 'only a blank name, which can no longer be saved');
});

test('a last-name initial is added only when two people share a first name', () => {
  const others = ['Brother John Smith', 'Sister John Lee', 'Grace Park'];
  assert.equal(publicName('Brother John Smith', others), 'B John S');
  assert.equal(publicName('Sister John Lee', others), 'S John L');
  assert.equal(publicName('Grace Park', others), 'Grace');
  assert.equal(publicName('John S.', ['John S.', 'John Smith']), 'John S', 'an initial and a surname that start alike still differ');
});

// ---------- Typed text ----------

test('typed text is cleaned: one space between words, no control or bidi characters, NFC', () => {
  const name = value => bookings.text(value, config.NAME_MAX, 'Name', true);
  assert.equal(name('  Jordan \n\t Lee  '), 'Jordan Lee');
  assert.equal(name('Jor\u0000dan\u0007'), 'Jordan');
  assert.equal(name('\u202EJordan\u202C \u2066Lee\u2069'), 'Jordan Lee');
  assert.equal(name('Jose\u0301'), 'Jos\u00E9');
  assert.equal(name('Jose\u0301').length, 4);
  assert.equal(name('Ana\u00A0\u2003Ruiz'), 'Ana Ruiz');
  assert.equal(name('Ana \u200D\u200C Ruiz'), 'Ana \u200D\u200C Ruiz', 'joiners stay');
  assert.throws(() => name('\u202E\u0000 '), /Name is required/);
  assert.throws(() => name(['Jordan']), /Name is required/);
  assert.equal(bookings.text(undefined, 10, 'Detail', false), '');
});

test('lengths count UTF-16 units, as a browser maxlength does', () => {
  const name = value => bookings.text(value, config.NAME_MAX, 'Name', true);
  assert.equal(name(`Jo${'\u{1F600}'.repeat(59)}`).length, 120, '61 characters, 120 units');
  assert.throws(() => name(`Jo${'\u{1F600}'.repeat(59)}a`), /120 characters or fewer/);
});

test('private notes keep their line breaks', () => {
  const note = value => bookings.text(value, config.NOTE_MAX, 'Note', false, true);
  assert.equal(note(' Keys at the desk\r\nCall first\rThanks\t\u0000 '), 'Keys at the desk\nCall first\nThanks');
  assert.equal(note('\u202Eabc'), 'abc');
  assert.equal(note(42), '');
});

// ---------- Requests ----------

const memberBase = { date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'other', name: 'Jordan', reservedFor: 'Study' };
const parseMember = changes => () => bookings.parseMemberRequest({ ...memberBase, ...changes }, THURSDAY);

test('a member request is checked and cleaned', () => {
  const request = bookings.parseMemberRequest({
    date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'contact',
    name: '  Jordan   Example ', reservedFor: ' Sample Contact ', requestedUnit: 'room-2',
    requestId: 'abcdefghij-_123456', allowTakeover: true, takeoverUnit: 'room-2'
  }, THURSDAY);
  assert.deepEqual(request, {
    date: SATURDAY, start: '11:00', end: '12:00', type: 'room', requestedUnit: 'room-2', purpose: 'contact',
    allowTakeover: true, takeoverUnit: 'room-2', requestId: 'abcdefghij-_123456', name: 'Jordan Example', reservedFor: 'Sample Contact'
  });
  const older = bookings.parseMemberRequest(memberBase, THURSDAY);
  assert.equal(older.requestId, null, 'older pages send no request id');
  assert.equal(older.takeoverUnit, null);
  assert.equal(older.allowTakeover, false);
  assert.equal(bookings.parseMemberRequest({ ...memberBase, allowTakeover: 'true' }, THURSDAY).allowTakeover, false);
});

test('a member request names the field that is wrong', () => {
  assert.throws(parseMember({ name: ' ' }), /Your name is required/);
  assert.throws(parseMember({ reservedFor: '' }), /Purpose is required/);
  assert.throws(parseMember({ purpose: 'contact', reservedFor: '' }), /Contact name is required/);
  assert.throws(parseMember({ reservedFor: 'x'.repeat(241) }), /Purpose must be 240 characters or fewer/);
  assert.doesNotThrow(parseMember({ reservedFor: 'x'.repeat(240) }));
  assert.throws(parseMember({ purpose: 'meeting' }), /Choose what the reservation is for/);
  assert.throws(parseMember({ purpose: 'constructor' }), /Choose what the reservation is for/);
  assert.throws(parseMember({ purpose: 'blocked' }), /Choose what the reservation is for/);
  assert.equal(bookings.purposeOf({ purpose: '__proto__' }), 'other');
  assert.throws(parseMember({ resourceType: 'podium' }), /Choose a study room, whiteboard or TV/);
  assert.throws(parseMember({ requestedUnit: 'wb-1' }), /Choose a valid unit/);
  assert.throws(parseMember({ takeoverUnit: 'tv-1' }), /Choose a valid unit/);
  assert.throws(parseMember({ allowTakeover: true }), /This page is out of date\. Reload the page/, 'a page from before takeoverUnit');
  assert.throws(parseMember({ allowTakeover: true, requestedUnit: 'room-2' }), /This page is out of date/);
  assert.throws(parseMember({ start: '14:00', end: '15:00' }), /overlaps a service/);
  assert.throws(parseMember({ date: ['2026-10-03'] }), /not open/);
  assert.throws(() => bookings.parseMemberRequest(null, THURSDAY), /HH:MM/);
});

test('a request id must be 16 to 64 letters, digits, - or _', () => {
  assert.doesNotThrow(parseMember({ requestId: 'a'.repeat(16) }));
  assert.doesNotThrow(parseMember({ requestId: 'a'.repeat(64) }));
  for (const requestId of ['a'.repeat(15), 'a'.repeat(65), 'a/b'.repeat(6), 12345678901234567, '']) {
    assert.throws(parseMember({ requestId }), /Reload the page/, String(requestId));
  }
});

test('names and details have length limits', () => {
  assert.doesNotThrow(parseMember({ name: 'n'.repeat(120) }));
  assert.throws(parseMember({ name: 'n'.repeat(121) }), /Your name must be 120 characters or fewer/);
  assert.doesNotThrow(parseMember({ purpose: 'contact', reservedFor: 'c'.repeat(120) }));
  assert.throws(parseMember({ purpose: 'contact', reservedFor: 'c'.repeat(121) }), /Contact name must be 120 characters or fewer/);
  assert.throws(parseMember({ purpose: 'new-member', reservedFor: 'm'.repeat(121) }), /Member name must be 120 characters or fewer/);
});

const adminBase = { date: SATURDAY, start: '11:00', end: '12:00', name: 'Hold for cleaning', purpose: 'blocked', assignments: { room: 'room-2', tv: 'tv-1' } };
const parseAdmin = (changes, now = THURSDAY) => () => bookings.parseAdminBooking({ ...adminBase, ...changes }, now);

test('an Admin booking gets its needs from the units chosen', () => {
  const booking = parseAdmin({ note: ' Deep clean ' })();
  assert.deepEqual(booking.needs, { room: true, whiteboard: false, tv: true });
  assert.deepEqual(booking.assignments, { room: 'room-2', whiteboard: null, tv: 'tv-1' });
  assert.equal(booking.note, 'Deep clean');
  assert.throws(parseAdmin({ assignments: {} }), /at least one/);
  assert.throws(parseAdmin({ assignments: { room: 'room-9' } }), /valid study room/);
  assert.throws(parseAdmin({ assignments: { tv: 'room-1' } }), /valid TV/);
  assert.throws(parseAdmin({ purpose: 'meeting' }), /Choose what the reservation is for/);
});

test('Admin limits: hold reason 240, notes 1000, names 120', () => {
  assert.equal(config.HOLD_REASON_MAX, 240);
  assert.doesNotThrow(parseAdmin({ reservedFor: 'r'.repeat(240) }));
  assert.throws(parseAdmin({ reservedFor: 'r'.repeat(241) }), /Reason must be 240 characters or fewer/);
  assert.doesNotThrow(parseAdmin({ note: 'n'.repeat(1000) }));
  assert.throws(parseAdmin({ note: 'n'.repeat(1001) }), /Note must be 1000 characters or fewer/);
  assert.throws(parseAdmin({ name: 'n'.repeat(121) }), /Name must be 120 characters or fewer/);
  assert.equal(parseAdmin({ purpose: 'contact', reservedFor: '' })().reservedFor, '', 'Admin may leave the detail empty');
  assert.throws(parseAdmin({ purpose: 'contact', reservedFor: 'c'.repeat(121) }), /Contact name must be 120/);
});

test('Admin adds under the same date rules as members', () => {
  assert.throws(parseAdmin({}, local(SATURDAY, '11:10')), /already passed/);
  assert.throws(parseAdmin({ date: TUESDAY }), /not open/, 'outside the window');
  assert.throws(parseAdmin({ date: '2026-10-05' }, SATURDAY_MORNING), /not open/, 'not a booking day');
  assert.doesNotThrow(parseAdmin({ date: TUESDAY }, SATURDAY_MORNING));
});

// ---------- Booking rules ----------

test('a unit is held when its assignment is a real unit of that type', () => {
  assert.deepEqual([bookings.unitName('wb-4'), bookings.unitName('room-9')], ['Board 4', '']);
  const booking = { assignments: { room: 'room-1', whiteboard: 'room-2', tv: 'tv-9' } };
  assert.equal(bookings.heldUnit(booking, 'room'), 'room-1');
  assert.equal(bookings.heldUnit(booking, 'whiteboard'), null);
  assert.equal(bookings.heldUnit({}, 'tv'), null);
  assert.deepEqual(bookings.heldAssignments(booking), { room: 'room-1', whiteboard: null, tv: null });
  assert.deepEqual(bookings.typesHeld(booking), ['room']);
  assert.deepEqual(bookings.neededTypes(booking), ['room'], 'an older record without needs');
  assert.deepEqual(bookings.neededTypes({ ...booking, needs: { room: true, tv: true } }), ['room', 'tv']);
  assert.deepEqual(bookings.missingTypes({ ...booking, needs: { room: true, tv: true } }), ['tv']);
});

test('the first unit free for the whole time is used, and a requested unit is never swapped', () => {
  const taken = [approved({ start: '11:00', end: '12:00', assignments: { room: 'room-1' } })];
  const candidate = { date: SATURDAY, start: '11:30', end: '12:30' };
  assert.equal(bookings.freeUnit('room', candidate, taken), 'room-2');
  assert.equal(bookings.freeUnit('room', candidate, taken, 'room-1'), null);
  assert.equal(bookings.freeUnit('room', { ...candidate, start: '12:00' }, taken, 'room-1'), 'room-1');
  const cancelled = [{ ...taken[0], status: 'cancelled' }];
  assert.equal(bookings.freeUnit('room', candidate, cancelled, 'room-1'), 'room-1');
  const older = [{ status: 'approved', date: SATURDAY, start: '11:00', end: '12:00', assignments: { room: 'room-1' } }];
  assert.equal(bookings.freeUnit('room', candidate, older, 'room-1'), null, 'an older record without needs still holds its unit');
});

function fullDay(purposes) {
  return purposes.map((purpose, index) => approved({
    id: `holder-${index + 1}`, start: '11:00', end: '12:00', purpose, name: `Holder ${index + 1}`,
    assignments: { room: `room-${index + 1}` }
  }));
}

const priority = purpose => ({ date: SATURDAY, start: '11:00', end: '12:00', purpose });

test('Contact may take New Member or Other; New Member may take Other; Other and holds are never taken', () => {
  const day = fullDay(['contact', 'blocked', 'new-member', 'other']);
  assert.equal(bookings.takeoverTarget('room', priority('contact'), day).unitId, 'room-4', 'lowest priority first');
  assert.equal(bookings.takeoverTarget('room', priority('new-member'), day).unitId, 'room-4');
  assert.equal(bookings.takeoverTarget('room', priority('other'), day), null);
  assert.equal(bookings.takeoverTarget('room', priority('contact'), fullDay(['contact', 'contact', 'blocked', 'blocked'])), null);
  assert.equal(bookings.takeoverTarget('room', priority('contact'), day, 'room-3').unitId, 'room-3');
  assert.equal(bookings.takeoverTarget('room', priority('contact'), day, 'room-1'), null, 'Contact never takes Contact');
  assert.equal(bookings.takeoverTarget('room', priority('contact'), day, 'room-2'), null, 'a hold is never taken');
  const mixed = [...fullDay(['contact', 'contact', 'contact', 'other']),
    approved({ id: 'hold', start: '11:30', end: '12:00', purpose: 'blocked', assignments: { room: 'room-4' } })];
  assert.equal(bookings.takeoverTarget('room', priority('contact'), mixed), null, 'nor a unit a hold shares');
});

test('no takeover while any unit of that kind is free, even for a chosen unit', () => {
  const day = fullDay(['other']);
  assert.equal(bookings.freeUnit('room', priority('contact'), day, 'room-1'), null);
  assert.equal(bookings.takeoverTarget('room', priority('contact'), day, 'room-1'), null);
});

test('a takeover picks the least important holders first, then the fewest, then unit order', () => {
  const day = [
    approved({ id: 'nm', purpose: 'new-member', assignments: { room: 'room-1' } }),
    approved({ id: 'o1', purpose: 'other', start: '11:00', end: '11:30', assignments: { room: 'room-2' } }),
    approved({ id: 'o2', purpose: 'other', start: '11:30', end: '12:00', assignments: { room: 'room-2' } }),
    ...fullDay(['contact', 'contact', 'contact', 'contact']).slice(2)
  ];
  const target = bookings.takeoverTarget('room', priority('contact'), day);
  assert.equal(target.unitId, 'room-2', 'two Other reservations before one New Member');
  assert.deepEqual(target.holders.map(holder => holder.id), ['o1', 'o2']);

  const fewest = [
    approved({ id: 'nm1', purpose: 'new-member', assignments: { room: 'room-1' } }),
    approved({ id: 'o1', purpose: 'other', start: '11:00', end: '11:30', assignments: { room: 'room-1' } }),
    approved({ id: 'nm2', purpose: 'new-member', assignments: { room: 'room-2' } }),
    ...fullDay(['contact', 'contact', 'contact', 'contact']).slice(2)
  ];
  assert.equal(bookings.takeoverTarget('room', priority('contact'), fewest).unitId, 'room-2');
  assert.deepEqual(bookings.takeoverTarget('room', priority('contact'), fewest, 'room-1').holders.map(holder => holder.id), ['nm1', 'o1'],
    'holders most important first');
  assert.equal(bookings.takeoverTarget('room', priority('contact'), fullDay(['other', 'other', 'other', 'other'])).unitId, 'room-1');
});

test('a reservation already under way is shortened; a later one is moved', () => {
  const candidate = { start: '12:00' };
  assert.equal(bookings.shortenedEnd({ start: '11:00' }, candidate), '12:00');
  assert.equal(bookings.shortenedEnd({ start: '12:00' }, candidate), null);
  assert.equal(bookings.shortenedEnd({ start: '12:30' }, candidate), null);
});

test('a priority reservation can never move or release one already under way', () => {
  // Every minute of a Saturday, every start a member may choose then, and every
  // holder that began before that minute: the holder is always shortened.
  let checked = 0;
  for (let minute = 10 * 60; minute < 23 * 60; minute += 7) {
    const now = local(SATURDAY, schedule.toTime(minute));
    for (let start = 600; start < 1380; start += 30) {
      if (schedule.hasPassed(SATURDAY, schedule.toTime(start), now)) continue;
      for (let begun = 600; begun < 1380; begun += 30) {
        if (!schedule.hasPassed(SATURDAY, schedule.toTime(begun), now)) continue;
        checked += 1;
        assert.equal(bookings.shortenedEnd({ start: schedule.toTime(begun) }, { start: schedule.toTime(start) }), schedule.toTime(start));
      }
    }
  }
  assert.ok(checked > 1000);
});

test('an overlapping booking on the same unit is a conflict', () => {
  const day = [approved({ id: 'a', name: 'Avery', start: '11:00', end: '12:00', assignments: { room: 'room-1' } })];
  const candidate = { date: SATURDAY, start: '11:30', end: '12:30', assignments: { room: 'room-1', whiteboard: null, tv: null } };
  assert.equal(bookings.conflictWith(candidate, day).name, 'Avery');
  assert.equal(bookings.conflictWith(candidate, day, 'a'), null);
  assert.equal(bookings.conflictWith({ ...candidate, assignments: { room: 'room-2' } }, day), null);
  assert.equal(bookings.conflictWith({ ...candidate, start: '12:00' }, day), null);
});

// ---------- What pages see ----------

test('every page gets the rules it needs from the server', () => {
  assert.deepEqual(clientConfig(), {
    timeZone: 'America/Los_Angeles', open: '10:00', close: '23:00', slotMinutes: 30, windowDays: 4,
    resources: config.RESOURCES, purposes: config.PURPOSES, hold: 'blocked', nameMax: 120, noteMax: 1000,
    holdReasonMax: 240, keepDays: 56, sessionMinutes: 20, maxActivePerDay: 4
  });
  assert.deepEqual(Object.keys(clientConfig().purposes), ['contact', 'new-member', 'other'], 'most important first');
});

const records = [
  approved({ id: 'mine', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'contact', reservedFor: 'Sample Contact', start: '11:00', end: '12:30', assignments: { room: 'room-1' } }),
  approved({ id: 'theirs', ownerUid: 'device-b', name: 'Sister John Lee', purpose: 'meeting', purposeOther: 'Older record', start: '11:00', end: '12:00', assignments: { room: 'room-2' } }),
  approved({ id: 'hold', ownerUid: null, name: 'Private hold', purpose: 'blocked', reservedFor: 'Staff only', start: '12:00', end: '13:00', assignments: { room: 'room-3' } }),
  approved({ id: 'board', ownerUid: 'device-b', name: 'Avery Example', purpose: 'other', reservedFor: 'Study', start: '16:00', end: '17:00', needs: { whiteboard: true }, assignments: { whiteboard: 'wb-4' } }),
  { ...approved({ id: 'gone', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'other', reservedFor: 'Review', start: '17:00', end: '18:00', assignments: { room: 'room-1' } }),
    status: 'cancelled', cancelledBy: 'admin', priorityNotice: { kind: 'moved', fromUnit: 'room-2', toUnit: 'room-1' } },
  { ...approved({ id: 'released', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'other', reservedFor: 'Review', start: '18:00', end: '19:00', assignments: {} }),
    status: 'overridden', priorityNotice: { kind: 'released', type: 'room', fromUnit: 'room-2', toUnit: null, byPurpose: 'contact', byBookingId: 'x' } },
  approved({ id: 'early', ownerUid: 'device-a', name: 'Brother John Smith', purpose: 'other', reservedFor: 'Prayer', start: '10:00', end: '10:30', needs: null, assignments: { tv: 'tv-2' } })
];

test('the member schedule shows public names and marks this device\'s reservations', () => {
  const view = memberView(records, [SATURDAY], 'device-a', THURSDAY);
  assert.equal(view.version, 2);
  assert.deepEqual(view.days, [{ date: SATURDAY, scheduled: true, services: schedule.servicesOn(SATURDAY) }]);
  assert.deepEqual(view.bookings.map(row => [row.id, row.type, row.unit, row.name, row.purpose, row.reservedFor, row.mine]), [
    ['mine', 'room', 'room-1', 'B John S', 'contact', 'Sample Contact', true],
    ['theirs', 'room', 'room-2', 'S John L', 'other', 'Older record', false],
    ['hold', 'room', 'room-3', 'Reserved', 'blocked', '', false],
    ['board', 'whiteboard', 'wb-4', 'Avery', 'other', 'Study', false],
    ['early', 'tv', 'tv-2', 'B John S', 'other', 'Prayer', true]
  ]);
  for (const row of view.bookings) {
    assert.deepEqual(Object.keys(row), ['id', 'date', 'type', 'unit', 'start', 'end', 'name', 'purpose', 'reservedFor', 'mine']);
    assert.equal(row.name.includes('Smith') || row.name.includes('Private'), false);
  }
  assert.deepEqual(memberView(records, [TUESDAY], 'device-a', THURSDAY).bookings, [], 'only the dates asked for');
});

test('My reservations says what the device can still do with each one', () => {
  const mine = at => memberView(records, [SATURDAY], 'device-a', at).mine;
  const before = mine(THURSDAY);
  assert.deepEqual(before.map(row => [row.id, row.status, row.unit, row.ended, row.canCancel, row.canEndEarly, row.earlyEnds, row.byAdmin]), [
    ['mine', 'approved', 'room-1', false, true, true, ['11:30', '12:00'], false],
    ['gone', 'cancelled', 'room-1', false, false, false, [], true],
    ['released', 'overridden', null, false, false, false, [], false],
    ['early', 'approved', 'tv-2', false, true, false, [], false]
  ]);
  assert.equal(before[0].name, 'Brother John Smith', 'the owner sees the full name they typed');
  assert.equal(before[1].notice, null, 'no notice once cancelled');
  assert.deepEqual(before[2].notice, { kind: 'released', fromUnit: 'room-2', toUnit: null, fromEnd: null, toEnd: null, byPurpose: 'contact' });
  assert.equal(before[3].type, 'tv', 'an older record without needs');

  const during = mine(local(SATURDAY, '11:40'));
  assert.deepEqual(during[0].earlyEnds, ['12:00']);
  assert.deepEqual([during[3].ended, during[3].canCancel], [true, false], 'ended at 10:30');
  const after = mine(local(SATURDAY, '12:30'));
  assert.deepEqual([after[0].ended, after[0].canCancel, after[0].canEndEarly], [true, false, false]);
  assert.deepEqual(memberView(records, [SATURDAY], '', THURSDAY).mine, []);
});

test('a member cancel is not shown as an Admin cancel, and older records are read sensibly', () => {
  const cancelled = fields => memberView([{ ...approved({ id: 'c', ownerUid: 'device-a', name: 'Jordan', assignments: { room: 'room-1' } }), status: 'cancelled', ...fields }], [SATURDAY], 'device-a', THURSDAY).mine[0].byAdmin;
  assert.equal(cancelled({ cancelledBy: 'member', updatedBy: 'device-a' }), false);
  assert.equal(cancelled({ cancelledBy: 'admin' }), true);
  assert.equal(cancelled({}), false, 'older member cancels set no updatedBy');
  assert.equal(cancelled({ updatedBy: 'admin-device' }), false, 'an older record is not guessed at: Admin may have changed it before the member cancelled');
});

test('short names are worked out per date, the same way for the app and the TV', () => {
  const day = [
    approved({ id: 'r', name: 'Brother John Smith', assignments: { room: 'room-1' } }),
    approved({ id: 'w', name: 'Sister John Lee', needs: { whiteboard: true }, assignments: { whiteboard: 'wb-1' } }),
    approved({ id: 't', date: TUESDAY, name: 'Brother John Park', assignments: { room: 'room-1' } }),
    { ...approved({ id: 'x', name: 'John Cancelled', assignments: { room: 'room-2' } }), status: 'cancelled' },
    approved({ id: 'h', name: 'John Hold', purpose: 'blocked', assignments: { room: 'room-3' } })
  ];
  const app = memberView(day, [SATURDAY, TUESDAY], 'device-z', THURSDAY).bookings.map(row => [row.id, row.name]);
  const tv = lobbyView(day, [SATURDAY, TUESDAY], THURSDAY).bookings.map(row => row.name);
  assert.deepEqual(app, [['r', 'B John S'], ['w', 'S John L'], ['t', 'B John'], ['h', 'Reserved']]);
  assert.deepEqual(tv, ['B John S', 'B John', 'Reserved'], 'a whiteboard on the same date counts; Tuesday and cancelled ones do not');
});

test('the lobby gets study rooms only, with public names and no private fields', () => {
  const older = { id: 'older', status: 'approved', date: SATURDAY, start: '16:00', end: '17:00', name: 'Elder Older Record', purpose: 'meeting', assignments: { room: 'room-4' } };
  assert.deepEqual(lobbyView([older], [SATURDAY], THURSDAY).bookings, [{ date: SATURDAY, start: '16:00', end: '17:00', room: 'room-4', name: 'E Older' }],
    'an older record without needs is shown');
  const view = lobbyView(records, [SATURDAY], THURSDAY);
  assert.deepEqual(Object.keys(view), ['version', 'generatedAt', 'config', 'days', 'bookings']);
  assert.equal(view.version, 1);
  assert.deepEqual(view.bookings, [
    { date: SATURDAY, start: '11:00', end: '12:30', room: 'room-1', name: 'B John S' },
    { date: SATURDAY, start: '11:00', end: '12:00', room: 'room-2', name: 'S John L' },
    { date: SATURDAY, start: '12:00', end: '13:00', room: 'room-3', name: 'Reserved' }
  ]);
  assert.equal(view.generatedAt, THURSDAY.toISOString());
  assert.deepEqual(lobbyView([], ['2026-10-01'], THURSDAY).days, [{ date: '2026-10-01', scheduled: false, services: [] }]);
});

test('Admin rows carry everything Admin needs and nothing else', () => {
  const extra = [
    { ...approved({ id: 'kept-tv', ownerUid: null, name: 'Admin Example', needs: { room: true, tv: true }, assignments: { room: null, tv: 'tv-1' } }),
      priorityNotice: { kind: 'released', fromUnit: 'room-1', byPurpose: 'contact' }, createdAt: { toMillis: () => 1234 } },
    { ...approved({ id: 'nothing', name: 'Old Record', needs: null, assignments: {} }), status: 'overridden', createdAt: 99 }
  ];
  const rows = adminRows([...records, ...extra], { hold: 'Keys at the desk', mine: 42 }, THURSDAY);
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.deepEqual(Object.keys(byId.mine), ['id', 'date', 'start', 'end', 'name', 'purpose', 'reservedFor', 'needs', 'assignments', 'status',
    'byMember', 'endedEarlyFrom', 'notice', 'byAdmin', 'note', 'restorable', 'missing', 'createdAt', 'ended', 'earlyEnds']);
  assert.equal(byId.mine.name, 'Brother John Smith', 'Admin sees full names');
  assert.equal(byId.mine.note, '', 'a note that is not text is left out');
  assert.equal(byId.hold.reservedFor, 'Staff only', 'Admin sees why a unit is held');
  assert.equal(byId.hold.note, 'Keys at the desk');
  assert.deepEqual([byId.hold.byMember, byId.mine.byMember], [false, true]);
  assert.deepEqual([byId.mine.restorable, byId.gone.restorable, byId.released.restorable], [false, true, true]);
  assert.deepEqual([byId.gone.byAdmin, byId.gone.notice], [true, null]);
  assert.deepEqual(byId.released.missing, ['room']);
  assert.deepEqual(byId['kept-tv'], {
    id: 'kept-tv', date: SATURDAY, start: '11:00', end: '12:00', name: 'Admin Example', purpose: 'other', reservedFor: '',
    needs: { room: true, whiteboard: false, tv: true }, assignments: { room: null, whiteboard: null, tv: 'tv-1' }, status: 'approved',
    byMember: false, endedEarlyFrom: null, notice: { kind: 'released', fromUnit: 'room-1', toUnit: null, fromEnd: null, toEnd: null, byPurpose: 'contact' },
    byAdmin: false, note: '', restorable: true, missing: ['room'], createdAt: 1234, ended: false, earlyEnds: ['11:30']
  });
  assert.deepEqual([byId.nothing.restorable, byId.nothing.createdAt, byId.mine.createdAt], [false, 99, null], 'nothing to restore');
  assert.deepEqual(adminRows([], undefined, THURSDAY), []);
});

// ---------- The rules themselves ----------

test('config.js passes its own check', () => {
  assert.deepEqual(configProblems(config), []);
});

test('the config check catches each kind of mistake', () => {
  const broken = changes => configProblems({ ...config, ...changes });
  const service = (start, end) => [{ start, end, label: 'Service' }];
  assert.match(broken({ OPEN: '10:15' })[0], /OPEN and CLOSE/);
  assert.match(broken({ OPEN: '23:00', CLOSE: '10:00' })[0], /OPEN and CLOSE/);
  assert.match(broken({ BOOKING_WINDOW_DAYS: 0 })[0], /BOOKING_WINDOW_DAYS/);
  assert.match(broken({ WEEKLY_DAYS: { 7: [] } })[0], /not a weekday/);
  assert.match(broken({ WEEKLY_DAYS: { 2: service('19:45', '20:30') } })[0], /on the grid/);
  assert.match(broken({ WEEKLY_DAYS: { 2: service('20:30', '19:30') } })[0], /start before end/);
  assert.match(broken({ WEEKLY_DAYS: { 2: service('09:00', '10:00') } })[0], /inside opening hours/);
  assert.match(broken({ WEEKLY_DAYS: { 2: null } })[0], /must be a list/);
  assert.match(broken({ SPECIAL_DAYS: [{ date: '2026-10-5', opens: '2026-10-01', services: [] }] })[0], /real dates/);
  assert.match(broken({ SPECIAL_DAYS: [{ date: '2026-02-30', opens: '2026-02-01', services: [] }] })[0], /real dates/);
  assert.match(broken({ SPECIAL_DAYS: [{ date: '2026-10-05', opens: '2026-10-08', services: [] }] })[0], /on or before/);
  assert.match(broken({ SPECIAL_DAYS: [{ date: '2026-10-05', opens: '2026-10-01' }] })[0], /must be a list/);
  const day = { date: '2026-10-05', opens: '2026-10-01', services: [] };
  assert.match(broken({ SPECIAL_DAYS: [day, day] })[0], /listed twice/);
  const room = { ...config.RESOURCES.room, units: [{ id: 'room-1', name: 'A' }, { id: 'room-1', name: 'B' }] };
  assert.match(broken({ RESOURCES: { ...config.RESOURCES, room } })[0], /every unit id must be different/);
  const slash = { ...config.RESOURCES.room, units: [{ id: 'room/1', name: 'A' }] };
  assert.match(broken({ RESOURCES: { ...config.RESOURCES, room: slash } })[0], /letters, digits/);
  assert.match(broken({ PURPOSES: { ...config.PURPOSES, blocked: { ...config.PURPOSES.other } } })[0], /Admin hold/);
  assert.match(broken({ PURPOSES: { ...config.PURPOSES, other: { ...config.PURPOSES.other, canTake: ['contact'] } } })[0], /only take lower purposes/);
  assert.match(broken({ PURPOSES: { ...config.PURPOSES, contact: { ...config.PURPOSES.contact, canTake: ['contact'] } } })[0], /only take lower purposes/);
  assert.match(broken({ PURPOSES: { ...config.PURPOSES, other: { ...config.PURPOSES.other, detailMax: 0 } } })[0], /detailMax/);
});
