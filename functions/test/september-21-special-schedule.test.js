'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldAutoApproveMemberBooking,
  upcomingTuesdayAndSaturday,
  validateBookingTime
} = require('../lib/policy');

const now = new Date('2026-09-13T20:00:00Z');

test('September 21 appears as a one-off eligible booking date', () => {
  assert.deepEqual(
    upcomingTuesdayAndSaturday(now),
    ['2026-09-15', '2026-09-19', '2026-09-21']
  );
  assert.equal(shouldAutoApproveMemberBooking('2026-09-21', now), true);
});

test('September 21 follows Saturday morning and afternoon services without evening service', () => {
  assert.match(validateBookingTime('2026-09-21', '10:00', '10:30', now), /service/);
  assert.match(validateBookingTime('2026-09-21', '14:30', '15:30', now), /service/);
  assert.equal(validateBookingTime('2026-09-21', '11:00', '14:30', now), null);
  assert.equal(validateBookingTime('2026-09-21', '15:30', '20:30', now), null);
  assert.equal(validateBookingTime('2026-09-21', '19:30', '20:30', now), null);
  assert.equal(validateBookingTime('2026-09-21', '20:30', '23:00', now), null);
});

test('the September 21 exception is hidden outside its intended booking window', () => {
  assert.equal(upcomingTuesdayAndSaturday(new Date('2026-09-12T20:00:00Z')).includes('2026-09-21'), false);
  assert.equal(upcomingTuesdayAndSaturday(new Date('2026-09-22T20:00:00Z')).includes('2026-09-21'), false);
});
