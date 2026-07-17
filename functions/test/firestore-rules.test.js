'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { after, before, beforeEach } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} = require('firebase/firestore');
const { upcomingTuesdayAndSaturday } = require('../lib/policy');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-study-room-security',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080)
    }
  });
});

beforeEach(async () => environment.clearFirestore());
after(async () => environment?.cleanup());

function nextEligibleDate() {
  return upcomingTuesdayAndSaturday(new Date())[0];
}

function booking(date, ownerUid) {
  return {
    schemaVersion: 3,
    date,
    bookingDate: Timestamp.fromDate(new Date(`${date}T12:00:00Z`)),
    start: '10:00',
    end: '10:30',
    name: 'Test Member',
    needs: { room: true, whiteboard: false, tv: false },
    preferredRoom: null,
    purpose: 'meeting',
    purposeOther: '',
    certainty: 'confirmed',
    status: 'pending',
    assignments: { room: null, whiteboard: null, tv: null },
    ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

test('the public can read schedules but cannot read private notes', async () => {
  const publicDb = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(publicDb, 'bookings', 'any')));
  await assertFails(getDoc(doc(publicDb, 'privateBookingNotes', 'any')));
});

test('clients can no longer create bookings directly — only the backend can', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  const valid = booking(nextEligibleDate(), 'member-a');
  // Even a perfectly-formed request is refused: creation goes through the
  // memberSubmitBooking Cloud Function, which rate-limits and validates.
  await assertFails(setDoc(doc(memberDb, 'bookings', 'valid'), valid));
  await assertFails(setDoc(doc(memberDb, 'bookings', 'wrong-owner'), { ...valid, ownerUid: 'member-b' }));
  await assertFails(setDoc(doc(memberDb, 'bookings', 'approved'), {
    ...valid, status: 'approved', assignments: { room: 'room-1', whiteboard: null, tv: null }
  }));
});

test('owner may cancel without changing details; other member may not', async () => {
  const date = nextEligibleDate();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'bookings', 'owned'), {
      ...booking(date, 'member-a'), createdAt: Timestamp.now(), updatedAt: Timestamp.now()
    });
  });
  const ownerDb = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(updateDoc(doc(ownerDb, 'bookings', 'owned'), { status: 'cancelled', updatedAt: serverTimestamp() }));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'bookings', 'owned'), { status: 'pending' });
  });
  const otherDb = environment.authenticatedContext('member-b').firestore();
  await assertFails(updateDoc(doc(otherDb, 'bookings', 'owned'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(ownerDb, 'bookings', 'owned'), {
    status: 'cancelled', name: 'Changed', updatedAt: serverTimestamp()
  }));
});

test('clients cannot change settings or delete bookings', async () => {
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertFails(setDoc(doc(memberDb, 'app', 'settings'), { pinHash: 'unsafe' }));
  await assertFails(setDoc(doc(memberDb, 'privateBookingNotes', 'x'), { note: 'unsafe' }));
});
