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
  normalizeLegacyResourceMaps,
  priorityForPurpose,
  shouldAutoApproveMemberBooking,
  sortBookingsByPriority,
  shorterAvailableEnd,
  upcomingTuesdayAndSaturday,
  validateBookingTime,
  validateDirectBooking
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

test('rejects service overlaps but accepts ranges ending or starting at a service boundary', () => {
  const now = new Date('2026-07-17T19:00:00Z');
  assert.match(validateBookingTime('2026-07-18', '14:30', '15:30', now), /service/);
  assert.match(validateBookingTime('2026-07-18', '19:30', '21:30', now), /service/);
  assert.match(validateBookingTime('2026-07-21', '19:30', '20:30', now), /service/);
  assert.equal(validateBookingTime('2026-07-18', '14:30', '15:00', now), null);
  assert.equal(validateBookingTime('2026-07-18', '16:00', '16:30', now), null);
  assert.equal(validateBookingTime('2026-07-21', '19:30', '20:00', now), null);
  assert.equal(validateBookingTime('2026-07-21', '21:00', '23:00', now), null);
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
  const booking = { date: '2026-07-18', start: '10:00', end: '12:30' };

  // A valid earlier ending that keeps at least one 30-minute block.
  assert.equal(earlyEndError(booking, '12:00', now), null);
  assert.equal(earlyEndError(booking, '10:30', now), null);

  // The same ending, a later one, the start itself, and anything before the
  // start are all refused; cancelling is the way to give up the whole booking.
  assert.match(earlyEndError(booking, '12:30', now), /earlier ending/);
  assert.match(earlyEndError(booking, '13:00', now), /earlier ending/);
  assert.match(earlyEndError(booking, '10:00', now), /at least 30 minutes/);
  assert.match(earlyEndError(booking, '09:30', now), /at least 30 minutes/);

  // Malformed and off-grid times are refused.
  assert.match(earlyEndError(booking, '11:15', now), /30-minute boundaries/);
  assert.match(earlyEndError(booking, 'noon', now), /HH:MM/);
  assert.match(earlyEndError(null, '11:00', now), /cannot be shortened/);

  // A shortened Saturday booking still may not end inside a service.
  assert.match(
    earlyEndError({ date: '2026-07-18', start: '14:00', end: '16:30' }, '15:30', now),
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

test('rejects days other than the upcoming Tuesday and Saturday', () => {
  const now = new Date('2026-07-17T19:00:00Z');
  assert.match(validateBookingTime('2026-07-19', '10:00', '10:30', now), /Tuesday or Saturday/);
  assert.match(validateBookingTime('2026-07-25', '10:00', '10:30', now), /upcoming/);
  assert.match(validateBookingTime('2026-02-31', '10:00', '10:30', now), /Tuesday or Saturday/);
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
    date: '2026-07-18', start: '10:00', end: '10:30', name: 'A Member',
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
