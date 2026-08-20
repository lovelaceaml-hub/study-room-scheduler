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

// ——— Write kill switch (Rooms unification Section 8, ships DISABLED) ———
// These cases run against the REAL rules file with the REAL client SDK, which
// is exactly what a stale cached copy of the old app uses. The rules do not
// care what JavaScript the browser runs, so passing here proves a cached old
// client cannot write once the switch is on.

async function seedOwnedBooking(id, ownerUid) {
  const date = nextEligibleDate();
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'bookings', id), {
      ...booking(date, ownerUid), createdAt: Timestamp.now(), updatedAt: Timestamp.now()
    });
  });
}

async function setFreeze(value) {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'app', 'writeFreeze'), value);
  });
}

test('kill switch ships disabled: owner cancellation still works with no freeze document', async () => {
  await seedOwnedBooking('freeze-absent', 'member-a');
  const ownerDb = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(updateDoc(doc(ownerDb, 'bookings', 'freeze-absent'), {
    status: 'cancelled', updatedAt: serverTimestamp()
  }));
});

test('kill switch disabled state: frozen:false and junk values keep writes working', async () => {
  await seedOwnedBooking('freeze-false', 'member-a');
  await setFreeze({ frozen: false, reason: 'not yet' });
  const ownerDb = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(updateDoc(doc(ownerDb, 'bookings', 'freeze-false'), {
    status: 'cancelled', updatedAt: serverTimestamp()
  }));

  await seedOwnedBooking('freeze-junk', 'member-b');
  await setFreeze({ frozen: 'true' });
  const otherDb = environment.authenticatedContext('member-b').firestore();
  await assertSucceeds(updateDoc(doc(otherDb, 'bookings', 'freeze-junk'), {
    status: 'cancelled', updatedAt: serverTimestamp()
  }));
});

test('kill switch ON: even the owner cannot cancel — the one direct client write is refused', async () => {
  await seedOwnedBooking('freeze-on', 'member-a');
  await setFreeze({ frozen: true, reason: 'Cutover rehearsal' });
  const ownerDb = environment.authenticatedContext('member-a').firestore();
  await assertFails(updateDoc(doc(ownerDb, 'bookings', 'freeze-on'), {
    status: 'cancelled', updatedAt: serverTimestamp()
  }));
});

test('kill switch ON: direct creation stays refused for stale clients', async () => {
  await setFreeze({ frozen: true });
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertFails(setDoc(doc(memberDb, 'bookings', 'stale-create'), booking(nextEligibleDate(), 'member-a')));
});

test('clients may read the freeze document but can never write it', async () => {
  await setFreeze({ frozen: true, reason: 'Cutover rehearsal' });
  const memberDb = environment.authenticatedContext('member-a').firestore();
  await assertSucceeds(getDoc(doc(memberDb, 'app', 'writeFreeze')));
  await assertFails(setDoc(doc(memberDb, 'app', 'writeFreeze'), { frozen: false }));
  const publicDb = environment.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(publicDb, 'app', 'writeFreeze'), { frozen: false }));
});
