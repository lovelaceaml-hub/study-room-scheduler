'use strict';

// Needs the Firestore emulator: `firebase emulators:exec --only firestore "npm run test:rules"`.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { after, before, beforeEach } = require('node:test');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

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

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'bookings/existing'), { date: '2026-10-03', name: 'Test Member', ownerUid: 'member', status: 'approved' });
    await setDoc(doc(db, 'privateBookingNotes/existing'), { note: 'Private' });
  });
});

after(async () => environment?.cleanup());

for (const [label, context] of [['signed-out', () => environment.unauthenticatedContext()], ['signed-in', () => environment.authenticatedContext('member')]]) {
  test(`${label} browsers cannot read or change anything`, async () => {
    const db = context().firestore();
    for (const document of ['bookings/existing', 'privateBookingNotes/existing', 'adminSessions/any', 'adminRateLimits/any', 'app/settings']) {
      await assertFails(getDoc(doc(db, document)));
      await assertFails(setDoc(doc(db, document), { changed: true }));
    }
    await assertFails(updateDoc(doc(db, 'bookings/existing'), { status: 'cancelled' }));
    await assertFails(deleteDoc(doc(db, 'bookings/existing')));
  });
}
