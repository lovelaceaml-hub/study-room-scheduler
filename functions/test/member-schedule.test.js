'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectMemberSchedule } = require('../lib/member-schedule');

test('member schedule exposes public reservation details and owner-only actions without raw identity', () => {
  const result = projectMemberSchedule([
    {
      id: 'contact-booking', ownerUid: 'owner-1', name: 'Brother Anthony Lovelace',
      date: '2026-09-12', start: '11:00', end: '13:00', status: 'approved',
      purpose: 'contact', reservedFor: 'Joey', needs: { room: true }, assignments: { room: 'room-1' }
    },
    {
      id: 'other-booking', ownerUid: 'owner-2', name: 'Sister Anthony Rivera',
      date: '2026-09-12', start: '14:00', end: '15:00', status: 'approved',
      purpose: 'other', purposeOther: 'Mommies Education', needs: { room: true }, assignments: { room: 'room-2' }
    }
  ], ['2026-09-12'], 'owner-1');

  assert.equal(result.bookings.length, 2);
  assert.equal(result.bookings[0].name, 'B Anthony L');
  assert.equal(result.bookings[0].reservedFor, 'Joey');
  assert.equal(result.bookings[0].ownerDetail.authorized, true);
  assert.equal(result.bookings[0].ownerDetail.canCancel, true);
  assert.equal(result.bookings[1].name, 'S Anthony R');
  assert.equal(result.bookings[1].reservedFor, 'Mommies Education');
  assert.equal(Object.hasOwn(result.bookings[0], 'ownerUid'), false);
  assert.equal(Object.hasOwn(result.bookings[0], 'nameRaw'), false);
  assert.equal(result.myBookings.length, 1);
  assert.equal(result.myBookings[0].name, 'B Anthony L');
  assert.equal(result.myBookings[0].reservedFor, 'Joey');
});

test('member schedule does not expose pending or unassigned private records', () => {
  const result = projectMemberSchedule([
    {
      id: 'pending', ownerUid: 'owner-1', name: 'Pastor Person',
      date: '2026-09-12', start: '11:00', end: '12:00', status: 'pending',
      purpose: 'contact', reservedFor: 'Private contact', needs: { room: true }, assignments: { room: null }
    }
  ], ['2026-09-12'], 'owner-1');
  assert.deepEqual(result.bookings, []);
  assert.equal(result.myBookings.length, 1);
  assert.equal(result.myBookings[0].status, 'pending');
  assert.equal(result.myBookings[0].name, 'P Person');
  assert.equal(result.myBookings[0].reservedFor, 'Private contact');
});
