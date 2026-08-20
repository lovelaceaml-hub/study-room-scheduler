'use strict';

// Server-side proof that the write kill switch refuses reservation writes at
// the Cloud Function layer (Rooms unification Section 8, rehearsal only).
//
// Runs against the Firestore emulator with the REAL functions/index.js write
// paths — the same code deployed to production — via the _testInternals seam.
// Creation is the critical path: `bookings` rules already deny direct client
// creation, so the only way any client (fresh or stale-cached) can create a
// reservation is memberSubmitBooking, and this suite proves that path is
// refused while `app/writeFreeze` says `frozen: true` and works again the
// moment the freeze lifts (rollback proof for the switch itself).

const assert = require('node:assert/strict');
const test = require('node:test');
const { before, beforeEach } = require('node:test');
const { upcomingTuesdayAndSaturday } = require('../lib/policy');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('freeze-writes.test.js requires FIRESTORE_EMULATOR_HOST (run through emulators:exec).');
}
// This suite owns a DIFFERENT emulator project than firestore-rules.test.js
// so the two can never see each other's data (a shared namespace made the
// rules suite observe this suite's freeze document mid-test). FIREBASE_CONFIG
// must be overridden too: initializeApp() prefers it over GCLOUD_PROJECT, and
// emulators:exec injects it with the --project id.
process.env.GCLOUD_PROJECT = 'demo-study-room-freeze';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-study-room-freeze' });

const { getFirestore } = require('firebase-admin/firestore');
const { _testInternals } = require('../index');

const db = getFirestore();

function memberInput() {
  return {
    date: upcomingTuesdayAndSaturday(new Date())[0],
    start: '10:00',
    end: '10:30',
    resourceType: 'room',
    name: 'Fixture Member',
    purpose: 'meeting',
    purposeOther: ''
  };
}

async function clearCollections() {
  for (const name of ['bookings', 'app', 'privateBookingNotes']) {
    const snapshot = await db.collection(name).get();
    await Promise.all(snapshot.docs.map(document => document.ref.delete()));
  }
}

before(async () => clearCollections());
beforeEach(async () => clearCollections());

test('with the switch absent (shipped state) a member reservation is created', async () => {
  const result = await _testInternals.memberSubmitBooking(memberInput(), 'uid-fixture-1');
  assert.ok(result.bookingId);
  const stored = await db.collection('bookings').doc(result.bookingId).get();
  assert.equal(stored.exists, true);
  assert.equal(stored.data().ownerUid, 'uid-fixture-1');
});

test('with the switch ON, memberSubmitBooking is refused and nothing is written', async () => {
  await db.collection('app').doc('writeFreeze').set({ frozen: true, reason: 'Cutover rehearsal' });
  await assert.rejects(
    () => _testInternals.memberSubmitBooking(memberInput(), 'uid-fixture-2'),
    error => error.code === 'functions/failed-precondition' || error.httpErrorCode?.status === 400
      || /read-only/.test(String(error.message))
  );
  const bookings = await db.collection('bookings').get();
  assert.equal(bookings.size, 0);
});

test('with the switch ON, ending a reservation early is refused too', async () => {
  const created = await _testInternals.memberSubmitBooking(memberInput(), 'uid-fixture-3');
  await db.collection('app').doc('writeFreeze').set({ frozen: true });
  await assert.rejects(
    () => _testInternals.endBookingEarly(created.bookingId, '10:00', 'uid-fixture-3', 'uid-fixture-3'),
    /read-only|failed-precondition/i
  );
});

test('with the switch ON, admin cleanup deletes nothing — the freeze read shares the delete transaction', async () => {
  const created = await _testInternals.memberSubmitBooking(memberInput(), 'uid-fixture-5');
  // Age the booking past the 56-day cleanup cutoff so cleanup would delete it.
  await db.collection('bookings').doc(created.bookingId).update({ date: '2020-01-04' });
  await db.collection('app').doc('writeFreeze').set({ frozen: true });
  await assert.rejects(
    () => _testInternals.cleanupOldBookings('uid-admin'),
    /read-only|failed-precondition/i
  );
  const survivor = await db.collection('bookings').doc(created.bookingId).get();
  assert.equal(survivor.exists, true);
});

test('lifting the freeze restores writes immediately (switch rollback proof)', async () => {
  await db.collection('app').doc('writeFreeze').set({ frozen: true });
  await assert.rejects(() => _testInternals.memberSubmitBooking(memberInput(), 'uid-fixture-4'));
  await db.collection('app').doc('writeFreeze').set({ frozen: false, reason: '' });
  const result = await _testInternals.memberSubmitBooking(memberInput(), 'uid-fixture-4');
  assert.ok(result.bookingId);
});
