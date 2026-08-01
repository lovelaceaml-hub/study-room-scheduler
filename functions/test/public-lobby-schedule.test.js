'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicLobbyBooking, publicName } = require('../lib/public-lobby-schedule');

test('reduces a public room booking to the lobby-safe fields only', () => {
  const booking = publicLobbyBooking({
    id: 'private-firestore-id',
    ownerUid: 'private-owner',
    name: 'Sister Maria Rivera',
    date: '2026-08-04',
    start: '10:00',
    end: '11:30',
    status: 'approved',
    needs: { room: true, whiteboard: true },
    assignments: { room: 'room-2', whiteboard: 'wb-1' },
    purpose: 'contact',
    note: 'Private detail',
    createdAt: { seconds: 1 },
  });

  assert.deepEqual(booking, {
    date: '2026-08-04',
    start: '10:00',
    end: '11:30',
    room: 'room-2',
    name: 'Maria R.',
  });
});

test('rejects every non-public-room booking and safely abbreviates names', () => {
  assert.equal(publicLobbyBooking({ status: 'pending', needs: { room: true } }), null);
  assert.equal(publicLobbyBooking({ status: 'approved', needs: { tv: true }, assignments: { tv: 'tv-1' } }), null);
  assert.equal(publicLobbyBooking({ status: 'approved', needs: { room: true }, assignments: { room: 'room-baptism' } }), null);
  assert.equal(publicName('B. Anthony Lovelace'), 'Anthony L.');
  assert.equal(publicName(''), 'Reserved');
});
