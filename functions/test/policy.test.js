'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  availableUnitForType,
  canonicalAssignments,
  conflictingBooking,
  earlyEndError,
  migrationResourceUpdate,
  normalizeBookingIds,
  overrideShortenedEnd,
  overrideTarget,
  reclaimableUnitsForType,
  normalizeLegacyResourceMaps,
  priorityForPurpose,
  shouldAutoApproveMemberBooking,
  sortBookingsByPriority,
  shorterAvailableEnd,
  upcomingTuesdayAndSaturday,
  validateBookingTime,
  validateDirectBooking,
  validateReservedFor
} = require('../lib/policy');

test('returns only the upcoming Tuesday and Saturday, including today', () => {
  // Friday, July 17, 2026 in Los Angeles.
  assert.deepEqual(
    upcomingTuesdayAndSaturday(new Date('2026-07-17T19:00:00Z')),
    ['2026-07-18', '2026-07-21']
  );
  // Tuesday itself remains eligible.
  assert.deepEqual(
    upcomingTuesdayAndSaturday(new Date('2026-07-21T19:00:00Z')),
    ['2026-07-21', '2026-07-25']
  );
});

test('accepts the 10:00 PM and 10:30 PM starts, ending at 11:00 PM', () => {
  const now = new Date('2026-07-17T19:00:00Z');
  assert.equal(validateBookingTime('2026-07-18', '22:00', '22:30', now), null);
  assert.equal(validateBookingTime('2026-07-18', '22:30', '23:00', now), null);
  assert.match(validateBookingTime('2026-07-18', '23:00', '23:30', now), /23:00/);
});

// Service times changed on 12 September 2026: Saturday holds 10:00-11:00,
// 2:30-3:30 and 7:30-8:30; Tuesday only the evening one.
test('rejects service overlaps but accepts ranges ending or starting at a service boundary', () => {
  const now = new Date('2026-07-17T19:00:00Z');
  assert.match(validateBookingTime('2026-07-18', '10:00', '10:30', now), /service/);
  assert.match(validateBookingTime('2026-07-18', '10:30', '11:30', now), /service/);
  assert.match(validateBookingTime('2026-07-18', '14:30', '15:30', now), /service/);
  assert.match(validateBookingTime('2026-07-18', '14:00', '15:00', now), /service/);
  assert.match(validateBookingTime('2026-07-18', '19:30', '21:30', now), /service/);
  assert.match(validateBookingTime('2026-07-21', '19:30', '20:30', now), /service/);
  assert.match(validateBookingTime('2026-07-21', '19:00', '20:00', now), /service/);
  // Saturday's first bookable start is now 11:00, right after the morning service.
  assert.equal(validateBookingTime('2026-07-18', '11:00', '11:30', now), null);
  assert.equal(validateBookingTime('2026-07-18', '14:00', '14:30', now), null);
  assert.equal(validateBookingTime('2026-07-18', '15:30', '16:00', now), null);
  assert.equal(validateBookingTime('2026-07-18', '20:30', '23:00', now), null);
  // Tuesday keeps its whole morning and afternoon.
  assert.equal(validateBookingTime('2026-07-21', '10:00', '10:30', now), null);
  assert.equal(validateBookingTime('2026-07-21', '14:30', '15:30', now), null);
  assert.equal(validateBookingTime('2026-07-21', '19:00', '19:30', now), null);
  assert.equal(validateBookingTime('2026-07-21', '20:30', '23:00', now), null);
});

test('confirms every booking day immediately, with no approval queue', () => {
  // A Tuesday reserved days ahead is instant.
  assert.equal(shouldAutoApproveMemberBooking('2026-07-21', new Date('2026-07-17T19:00:00Z')), true);

  // Saturday no longer waits for an approver, either in advance...
  assert.equal(shouldAutoApproveMemberBooking('2026-07-18', new Date('2026-07-17T19:00:00Z')), true);
  // ...or before the old 10:00 AM Los Angeles boundary on the day itself.
  assert.equal(shouldAutoApproveMemberBooking('2026-07-18', new Date('2026-07-18T16:59:00Z')), true);
  assert.equal(shouldAutoApproveMemberBooking('2026-07-18', new Date('2026-07-18T00:30:00Z')), true);

  // Days that are not booking days remain ineligible.
  assert.equal(shouldAutoApproveMemberBooking('2026-07-17', new Date('2026-07-17T19:00:00Z')), false);
  assert.equal(shouldAutoApproveMemberBooking('not-a-date', new Date('2026-07-17T19:00:00Z')), false);
});

test('ending early shortens a reservation but never removes it entirely', () => {
  const now = new Date('2026-07-17T19:00:00Z');
  const booking = { date: '2026-07-18', start: '11:00', end: '13:30' };

  // A valid earlier ending that keeps at least one 30-minute block.
  assert.equal(earlyEndError(booking, '13:00', now), null);
  assert.equal(earlyEndError(booking, '11:30', now), null);

  // The same ending, a later one, the start itself, and anything before the
  // start are all refused; cancelling is the way to give up the whole booking.
  assert.match(earlyEndError(booking, '13:30', now), /earlier ending/);
  assert.match(earlyEndError(booking, '14:00', now), /earlier ending/);
  assert.match(earlyEndError(booking, '11:00', now), /at least 30 minutes/);
  assert.match(earlyEndError(booking, '10:30', now), /at least 30 minutes/);

  // Malformed and off-grid times are refused.
  assert.match(earlyEndError(booking, '12:15', now), /30-minute boundaries/);
  assert.match(earlyEndError(booking, 'noon', now), /HH:MM/);
  assert.match(earlyEndError(null, '11:00', now), /cannot be shortened/);

  // A shortened Saturday booking still may not end inside a service.
  assert.match(
    earlyEndError({ date: '2026-07-18', start: '13:30', end: '16:30' }, '15:00', now),
    /service/
  );
});

test('orders Saturday recommendations by purpose priority, then request time', () => {
  const bookings = [
    { id: 'other', purpose: 'other', createdAt: 1 },
    { id: 'group', purpose: 'group', createdAt: 30 },
    { id: 'contact-late', purpose: 'contact', createdAt: 20 },
    { id: 'contact-early', purpose: 'contact', createdAt: 10 },
    { id: 'new', purpose: 'new-member', createdAt: 5 }
  ];
  assert.deepEqual(sortBookingsByPriority(bookings).map(item => item.id), ['contact-early', 'contact-late', 'new', 'group', 'other']);
  assert.equal(priorityForPurpose('contact'), 0);
  assert.equal(priorityForPurpose('other'), 3);
});

test('rejects days other than the upcoming Tuesday, Saturday and September 21', () => {
  const now = new Date('2026-07-17T19:00:00Z');
  // The refusal now names all three eligible kinds of day, not only the weekly pair.
  assert.match(validateBookingTime('2026-07-19', '10:00', '10:30', now), /Tuesday, Saturday, or the September 21 special schedule/);
  assert.match(validateBookingTime('2026-07-25', '10:00', '10:30', now), /available scheduling day/);
  assert.match(validateBookingTime('2026-02-31', '10:00', '10:30', now), /Tuesday, Saturday, or the September 21 special schedule/);
});

test('accepts only Rooms 1-4 and rejects the Baptism Room', () => {
  assert.deepEqual(
    canonicalAssignments({ room: true, whiteboard: false, tv: false }, { room: 'room-4' }),
    { room: 'room-4', whiteboard: null, tv: null }
  );
  assert.throws(
    () => canonicalAssignments({ room: true }, { room: 'room-baptism' }),
    /valid room/
  );
});

test('detects overlapping approved assignments but ignores different units', () => {
  const candidate = {
    id: 'new', date: '2026-07-18', start: '10:00', end: '11:00',
    assignments: { room: 'room-1', whiteboard: null, tv: null }
  };
  const existing = [{
    id: 'old', status: 'approved', name: 'Existing', date: '2026-07-18', start: '10:30', end: '11:30',
    assignments: { room: 'room-1', whiteboard: null, tv: null }
  }];
  assert.equal(conflictingBooking(candidate, existing).id, 'old');
  candidate.assignments.room = 'room-2';
  assert.equal(conflictingBooking(candidate, existing), null);
});

test('rejects a full Saturday range and finds the longest shorter ending', () => {
  const candidate = { date: '2026-07-18', start: '10:00', end: '11:30' };
  const approved = [
    { status: 'approved', date: candidate.date, start: '10:00', end: '13:30', assignments: { room: 'room-4' } },
    ...[1, 2, 3].map(number => ({
      status: 'approved', date: candidate.date, start: '11:00', end: '11:30', assignments: { room: `room-${number}` }
    }))
  ];
  assert.equal(availableUnitForType('room', candidate, approved), null);
  assert.equal(shorterAvailableEnd('room', candidate, approved), '11:00');
  assert.equal(availableUnitForType('whiteboard', candidate, approved), 'wb-1');
});

test('sanitizes a valid direct Admin booking', () => {
  const booking = validateDirectBooking({
    date: '2026-07-18', start: '11:00', end: '11:30', name: 'A Member',
    needs: { room: true, whiteboard: false, tv: true },
    assignments: { room: 'room-2', tv: 'tv-1' },
    preferredRoom: 'room-2', purpose: 'meeting', purposeOther: '', certainty: 'confirmed'
  }, new Date('2026-07-17T19:00:00Z'));
  assert.equal(booking.schemaVersion, 3);
  assert.equal(booking.status, 'approved');
  assert.deepEqual(booking.assignments, { room: 'room-2', whiteboard: null, tv: 'tv-1' });
});

test('normalizes harmless legacy podium keys before approval', () => {
  assert.deepEqual(normalizeLegacyResourceMaps(
    { room: true, whiteboard: false, tv: false, podium: false },
    { room: 'room-2', whiteboard: null, tv: null, podium: null }
  ), {
    needs: { room: true, whiteboard: false, tv: false },
    assignments: { room: 'room-2', whiteboard: null, tv: null }
  });
  assert.throws(() => normalizeLegacyResourceMaps(
    { room: true, whiteboard: false, tv: false, podium: true },
    { room: null, whiteboard: null, tv: null, podium: null }
  ), /podium/);
});

test('migration strips podium data and returns Baptism Room bookings to pending', () => {
  assert.deepEqual(migrationResourceUpdate({
    status: 'approved',
    needs: { room: true, whiteboard: true, tv: false, podium: true },
    assignments: { room: 'room-baptism', whiteboard: 'wb-2', tv: null, podium: 'pod-2' }
  }), {
    needs: { room: true, whiteboard: true, tv: false },
    assignments: { room: null, whiteboard: null, tv: null },
    preferredRoom: null,
    status: 'pending',
    retiredBaptismRoom: true
  });

  const normalized = migrationResourceUpdate({
    status: 'approved',
    needs: { room: true, whiteboard: false, tv: false, podium: false },
    assignments: { room: 'room-3', whiteboard: null, tv: null, podium: null },
    preferredRoom: 'room-baptism'
  });
  assert.deepEqual(normalized.assignments, { room: 'room-3', whiteboard: null, tv: null });
  assert.equal(normalized.preferredRoom, null);
});

test('bulk note IDs are bounded, validated, and deduplicated', () => {
  assert.deepEqual(normalizeBookingIds(['one', 'two', 'one']), ['one', 'two']);
  assert.throws(() => normalizeBookingIds([]), /between 1 and 50/);
  assert.throws(() => normalizeBookingIds(Array.from({ length: 51 }, (_, index) => `id-${index}`)), /between 1 and 50/);
  assert.throws(() => normalizeBookingIds(['bad/path']), /invalid/);
});

test('ranks Contact above New Member above Other', () => {
  assert.ok(priorityForPurpose('contact') < priorityForPurpose('new-member'));
  assert.ok(priorityForPurpose('new-member') < priorityForPurpose('other'));
  // Retired purposes still rank between New Member and Other, and are never
  // override targets.
  assert.ok(priorityForPurpose('meeting') < priorityForPurpose('other'));
  assert.equal(sortBookingsByPriority([
    { purpose: 'other', name: 'C', createdAt: 3 },
    { purpose: 'contact', name: 'A', createdAt: 2 },
    { purpose: 'new-member', name: 'B', createdAt: 1 }
  ]).map(booking => booking.name).join(''), 'ABC');
});

test('an override may take only lower-priority member reservations', () => {
  const candidate = { date: '2026-07-21', start: '11:00', end: '11:30' };
  const holder = (unit, purpose, extra = {}) => ({
    id: `${unit}-${purpose}`, status: 'approved', date: candidate.date,
    start: '11:00', end: '11:30', purpose, assignments: { room: unit }, createdAt: 1, ...extra
  });

  // A free unit means no override: the caller should simply book it.
  assert.equal(overrideTarget('room', candidate, [holder('room-1', 'other')]), null);

  // Contact can take rooms held by New Member or Other.
  const contactTargets = [holder('room-1', 'new-member'), holder('room-2', 'other'), holder('room-3', 'contact'), holder('room-4', 'blocked')];
  assert.deepEqual(reclaimableUnitsForType('room', { ...candidate, purpose: 'contact' }, contactTargets).map(entry => entry.unitId), ['room-1', 'room-2']);
  assert.equal(overrideTarget('room', { ...candidate, purpose: 'contact' }, contactTargets).unitId, 'room-1');

  // New Member can take a room held by Other, but not one held by Contact.
  const newMemberTargets = ['room-1', 'room-2', 'room-3', 'room-4'].map(unit => holder(unit, unit === 'room-1' ? 'other' : 'contact'));
  assert.equal(overrideTarget('room', { ...candidate, purpose: 'new-member' }, newMemberTargets).unitId, 'room-1');
  assert.equal(overrideTarget('room', { ...candidate, purpose: 'new-member' }, newMemberTargets.map(item => ({ ...item, purpose: 'contact' }))), null);

  // A Contact or New Member in the way protects that room; the Other room stays takeable.
  const mixed = [holder('room-1', 'contact'), holder('room-2', 'new-member'), holder('room-3', 'meeting'), holder('room-4', 'other')];
  assert.deepEqual(reclaimableUnitsForType('room', { ...candidate, purpose: 'contact' }, mixed).map(entry => entry.unitId), ['room-2', 'room-4']);
  assert.equal(overrideTarget('room', { ...candidate, purpose: 'contact' }, mixed).unitId, 'room-2');

  // Nothing takeable when no room in the way is lower priority.
  const noneTakeable = ['room-1', 'room-2', 'room-3', 'room-4'].map(unit => holder(unit, 'contact'));
  assert.equal(overrideTarget('room', candidate, noneTakeable), null);

  // The least disruptive unit comes first: one reservation to displace, not two.
  const uneven = [
    holder('room-1', 'other'), { ...holder('room-1', 'other'), id: 'room-1-late', start: '11:00', end: '11:30' },
    holder('room-2', 'other'), holder('room-3', 'contact'), holder('room-4', 'contact')
  ];
  assert.equal(overrideTarget('room', { ...candidate, purpose: 'contact' }, uneven).unitId, 'room-2');
});

test('requested units are honored and conflicts never substitute another unit', () => {
  const candidate = {date:'2026-09-12',start:'11:00',end:'12:00'};
  for (const [type,prefix] of [['room','room-'],['whiteboard','wb-'],['tv','tv-']]) {
    assert.equal(availableUnitForType(type,candidate,[],prefix+'2'),prefix+'2');
    const occupied=[{...candidate,status:'approved',assignments:{[type]:prefix+'2'}}];
    assert.equal(availableUnitForType(type,candidate,occupied,prefix+'2'),null);
    assert.equal(availableUnitForType(type,candidate,occupied),prefix+'1');
    assert.equal(availableUnitForType(type,{...candidate,start:'12:00',end:'12:30'},occupied,prefix+'2'),prefix+'2');
    assert.equal(availableUnitForType(type,candidate,[],prefix+'99'),null);
    assert.equal(availableUnitForType(type,candidate,[],'invalid-unit'),null);
  }
});

test('requested units remain exact during a priority override', () => {
  const candidate = { date: '2026-09-12', start: '11:00', end: '12:00', purpose: 'contact' };
  const approved = [
    { id: 'contact-1', date: candidate.date, start: candidate.start, end: candidate.end, purpose: 'contact', status: 'approved', assignments: { room: 'room-1' } },
    { id: 'other-1', date: candidate.date, start: candidate.start, end: candidate.end, purpose: 'other', status: 'approved', assignments: { room: 'room-2' } },
    { id: 'other-2', date: candidate.date, start: candidate.start, end: candidate.end, purpose: 'other', status: 'approved', assignments: { room: 'room-3' } },
    { id: 'other-3', date: candidate.date, start: candidate.start, end: candidate.end, purpose: 'other', status: 'approved', assignments: { room: 'room-4' } }
  ];
  assert.equal(overrideTarget('room', candidate, approved, null).unitId, 'room-2');
  assert.equal(overrideTarget('room', candidate, approved, 'room-3').unitId, 'room-3');
  assert.equal(overrideTarget('room', candidate, approved, 'room-1'), null);
});

test('validates purpose-specific reserved-for values', () => {
  assert.equal(validateReservedFor('contact', ' Sister Wren '), 'Sister Wren');
  assert.equal(validateReservedFor('new-member', 'New member name'), 'New member name');
  assert.equal(validateReservedFor('other', 'Bible study'), 'Bible study');
  assert.throws(() => validateReservedFor('contact', '   '), /Contact name is required/);
  assert.throws(() => validateReservedFor('new-member', 'x'.repeat(121)), /too long/);
  assert.throws(() => validateReservedFor('other', 'x'.repeat(241)), /too long/);
  assert.equal(validateReservedFor('contact', '', { required: false }), '');
});

test('a reservation already under way is shortened, not released, by a priority override', () => {
  const candidate = { date: '2026-09-26', start: '12:30', end: '13:30', purpose: 'contact' };
  const holder = (start, end) => ({ id: `${start}-${end}`, status: 'approved', date: candidate.date, start, end, purpose: 'other', assignments: { room: 'room-1' } });
  // Started earlier and ran through the priority time: ends at 12:30.
  assert.equal(overrideShortenedEnd(holder('12:00', '14:00'), candidate), '12:30');
  assert.equal(overrideShortenedEnd(holder('11:00', '13:00'), candidate), '12:30');
  // Starts at or after the priority time: nothing to keep, so move or release.
  assert.equal(overrideShortenedEnd(holder('12:30', '13:30'), candidate), null);
  assert.equal(overrideShortenedEnd(holder('13:00', '14:00'), candidate), null);
  // The shortened reservation no longer overlaps the priority claim.
  const shortened = { ...holder('12:00', '14:00'), end: overrideShortenedEnd(holder('12:00', '14:00'), candidate) };
  assert.equal(availableUnitForType('room', candidate, [shortened], 'room-1'), 'room-1');
});
