// What a lobby TV room card says (public/tv/status.js), checked without a
// browser. Every name is fictional.

import test from 'node:test';
import assert from 'node:assert/strict';
import { roomStatus, roomStatusSorted, nextOpenMinute } from '../public/tv/status.js';
import { DEMO_CONFIG as config } from '../public/shared/demo.js';

const SATURDAY = {
  date: '2026-10-03',
  scheduled: true,
  services: [
    { start: '10:00', end: '11:00', label: 'Morning service' },
    { start: '14:30', end: '15:30', label: 'Afternoon service' },
    { start: '19:30', end: '20:30', label: 'Evening service' }
  ]
};
const TUESDAY = { date: '2026-10-06', scheduled: true, services: [{ start: '19:30', end: '20:30', label: 'Evening service' }] };
const at = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const booking = (start, end, name) => ({ date: SATURDAY.date, start, end, room: 'room-1', name });
const status = (day, bookings, time) => roomStatus(config, day, bookings, time === null ? null : at(time));

test('before opening and during a service, the card says when the room opens', () => {
  assert.deepEqual(status(SATURDAY, [], '09:30'), { state: 'Opens at 11:00 AM', detail: '', kind: 'closed' });
  assert.deepEqual(status(SATURDAY, [booking('11:00', '12:30', 'B John')], '09:30'),
    { state: 'Opens at 11:00 AM', detail: 'Next: B John, 11:00 AM to 12:30 PM', kind: 'closed' });
  assert.equal(status(SATURDAY, [], '10:15').state, 'Opens at 11:00 AM');
  assert.equal(status(SATURDAY, [], '14:45').state, 'Opens at 3:30 PM');
  assert.equal(status(TUESDAY, [], '19:45').state, 'Opens at 8:30 PM');
  assert.equal(status(TUESDAY, [], '08:00').state, 'Opens at 10:00 AM');
});

test('a free room is free until the next reservation, service or closing', () => {
  assert.deepEqual(status(SATURDAY, [], '12:10'), { state: 'Free until 2:30 PM', detail: 'Afternoon service at 2:30 PM', kind: 'free' });
  assert.deepEqual(status(SATURDAY, [booking('13:00', '14:00', 'S Grace')], '12:10'),
    { state: 'Free until 1:00 PM', detail: 'Next: S Grace, 1:00 PM to 2:00 PM', kind: 'free' });
  assert.deepEqual(status(SATURDAY, [booking('16:00', '17:00', 'S Grace')], '12:10'),
    { state: 'Free until 2:30 PM', detail: 'Afternoon service at 2:30 PM. Next: S Grace, 4:00 PM to 5:00 PM', kind: 'free' });
  assert.deepEqual(status(SATURDAY, [], '21:00'), { state: 'Open now', detail: 'Open until 11:00 PM', kind: 'free' });
  assert.deepEqual(status(TUESDAY, [], '20:45'), { state: 'Open now', detail: 'Open until 11:00 PM', kind: 'free' });
  assert.equal(status(TUESDAY, [], '12:00').state, 'Free until 7:30 PM');
});

test('a room in use says who has it and who is next', () => {
  const bookings = [booking('13:00', '14:00', 'S Grace'), booking('11:00', '12:30', 'B John')];
  assert.deepEqual(status(SATURDAY, bookings, '11:30'),
    { state: 'In use', detail: 'B John until 12:30 PM. Next: S Grace, 1:00 PM to 2:00 PM', kind: 'busy' });
  assert.deepEqual(status(SATURDAY, bookings, '13:59'), { state: 'In use', detail: 'S Grace until 2:00 PM', kind: 'busy' });
  assert.equal(status(SATURDAY, bookings, '12:30').state, 'Free until 1:00 PM', 'a reservation ending now has ended');
});

test('pre-sorted room bookings produce the same status without sorting on every render', () => {
  const bookings = [booking('13:00', '14:00', 'S Grace'), booking('11:00', '12:30', 'B John')];
  const sorted = bookings.slice().sort((a, b) => at(a.start) - at(b.start));
  assert.deepEqual(roomStatusSorted(config, SATURDAY, sorted, at('11:30')),
    roomStatus(config, SATURDAY, bookings, at('11:30')));
  assert.deepEqual(roomStatusSorted(config, SATURDAY, sorted, null),
    roomStatus(config, SATURDAY, bookings, null));
});

test('after closing, or when only a service is left, the room is closed for today', () => {
  assert.deepEqual(status(SATURDAY, [], '23:00'), { state: 'Closed for today', detail: '', kind: 'closed' });
  const lateService = { date: '2026-12-24', scheduled: true, services: [{ start: '22:00', end: '23:00', label: 'Late service' }] };
  assert.equal(status(lateService, [], '22:15').state, 'Closed for today');
  assert.equal(nextOpenMinute(config, lateService, at('22:15')), null);
  assert.equal(nextOpenMinute(config, SATURDAY, at('09:00')), at('11:00'));
  assert.equal(nextOpenMinute(config, SATURDAY, at('12:00')), at('12:00'));
});

test('another day sums up its reservations, and is never "open all day" around services', () => {
  assert.deepEqual(status(SATURDAY, [], null), { state: 'Open except during services', detail: '', kind: 'later' });
  assert.deepEqual(status({ date: '2026-12-25', scheduled: true, services: [] }, [], null), { state: 'Open all day', detail: '', kind: 'later' });
  assert.deepEqual(status(SATURDAY, [booking('16:00', '17:00', 'S Grace'), booking('11:00', '12:30', 'B John')], null),
    { state: '2 reservations', detail: 'First: B John, 11:00 AM to 12:30 PM', kind: 'later' });
});
