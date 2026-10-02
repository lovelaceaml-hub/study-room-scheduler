'use strict';

// Sign-in, request limits, the Admin PIN and Admin sessions, against an
// in-memory Firestore on a mocked clock. Every PIN here is fictional.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mock } = require('node:test');
const { Timestamp } = require('firebase-admin/firestore');
const { FakeFirestore } = require('./support/fake-firestore');
const guard = require('../lib/guard');
const { THURSDAY, useFixedClock, call, settle, hasCode } = require('./support/fixtures');

useFixedClock();

const PIN = '2468';
const MINUTE = 60 * 1000;
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const LOCKED = { code: 'resource-exhausted', message: 'Too many PIN attempts. Wait 15 minutes and try again.' };
const WRONG = { code: 'permission-denied', message: 'That PIN is not correct.' };

const signIn = (db, pin, address = '203.0.113.5', uid = 'device-a') => guard.startAdminSession(db, call(uid, { pin }, address), PIN);
const total = db => db.read('adminRateLimits', 'global-pin-failures');
const addressCounter = (db, address) => db.read('adminRateLimits', sha256(`address:${address}`).slice(0, 40));

test('calls without a signed-in device are refused', async () => {
  assert.throws(() => guard.requireUser(call(null)), hasCode('unauthenticated'));
  const db = new FakeFirestore();
  await assert.rejects(guard.limitReservationRequests(db, call(null)), hasCode('unauthenticated'));
  await assert.rejects(guard.startAdminSession(db, call(null, { pin: PIN }), PIN), hasCode('unauthenticated'));
  await assert.rejects(guard.requireAdmin(db, call(null, { sessionToken: 'x'.repeat(43) }), PIN), hasCode('unauthenticated'));
});

// ---------- Request limits ----------

test('reservation requests are limited per device, and more loosely per network', async () => {
  const db = new FakeFirestore();
  for (let count = 1; count <= 8; count += 1) await guard.limitReservationRequests(db, call('device-a'));
  await assert.rejects(guard.limitReservationRequests(db, call('device-a')), /from this device/);
  await assert.rejects(guard.limitReservationRequests(db, call('device-a', {}, '203.0.113.6')), /from this device/);
  // Other devices on the same Wi-Fi can still book, up to the network limit
  // (60, of which device-a used 9).
  for (let device = 1; device <= 51; device += 1) await guard.limitReservationRequests(db, call(`device-${device}`));
  await assert.rejects(guard.limitReservationRequests(db, call('device-z')), /from this network/);
  await guard.limitReservationRequests(db, call('device-z', {}, '203.0.113.99'));
});

test('a request window starts afresh after 15 minutes, and a block lasts 15 minutes', async () => {
  const db = new FakeFirestore();
  for (let count = 1; count <= 8; count += 1) await guard.limitReservationRequests(db, call('device-a'));
  mock.timers.tick(15 * MINUTE);
  for (let count = 1; count <= 8; count += 1) await guard.limitReservationRequests(db, call('device-a'));
  await assert.rejects(guard.limitReservationRequests(db, call('device-a')), /from this device/);
  mock.timers.tick(15 * MINUTE - 1);
  await assert.rejects(guard.limitReservationRequests(db, call('device-a')), /from this device/);
  mock.timers.tick(1);
  await guard.limitReservationRequests(db, call('device-a'));
});

test('IPv6 addresses count by their /64 network', async () => {
  assert.equal(guard.networkOf('203.0.113.5'), '203.0.113.5');
  assert.equal(guard.networkOf('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(guard.networkOf('2001:DB8:0001:0002:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(guard.networkOf('2001:db8:1:2::9'), '2001:db8:1:2::/64');
  assert.equal(guard.networkOf('2001:db8::9'), '2001:db8:0:0::/64');
  assert.equal(guard.networkOf('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(guard.networkOf('::1'), '0:0:0:0::/64');
  const db = new FakeFirestore();
  for (let index = 0; index < 60; index += 1) {
    await guard.limitReservationRequests(db, call(`fresh-${index}`, {}, `2001:db8:1:2::${index.toString(16)}`));
  }
  await assert.rejects(guard.limitReservationRequests(db, call('fresh-60', {}, '2001:db8:1:2:ffff::1')), /from this network/);
  await guard.limitReservationRequests(db, call('fresh-61', {}, '2001:db8:1:3::1'));
});

test('without forwarding headers the connection address is used', async () => {
  const db = new FakeFirestore();
  const direct = uid => ({ auth: { uid }, data: {}, rawRequest: { headers: {}, ip: '192.0.2.4' } });
  for (let index = 0; index < 60; index += 1) await guard.limitReservationRequests(db, direct(`d${index}`));
  await assert.rejects(guard.limitReservationRequests(db, direct('d60')), /from this network/);
  await guard.limitReservationRequests(db, { auth: { uid: 'e' }, data: {}, rawRequest: {} });
});

// ---------- The Admin PIN ----------

test('the Admin PIN opens a session tied to the device and the PIN', async () => {
  const db = new FakeFirestore();
  await assert.rejects(signIn(db, '0000'), WRONG);
  const started = await signIn(db, PIN);
  assert.deepEqual(Object.keys(started), ['sessionToken', 'expiresAt', 'expiresInMs']);
  assert.equal(started.expiresInMs, 20 * MINUTE);
  assert.equal(started.expiresAt, THURSDAY.getTime() + 20 * MINUTE);
  const { sessionToken } = started;
  const session = await guard.requireAdmin(db, call('device-a', { sessionToken }), PIN);
  assert.deepEqual([session.uid, session.expiresInMs], ['device-a', 20 * MINUTE]);
  await assert.rejects(guard.requireAdmin(db, call('device-b', { sessionToken }), PIN),
    { code: 'permission-denied', message: 'Your Admin session ended. Enter the PIN again.' });
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken }), PIN), hasCode('permission-denied'),
    'another device using the token ends the session');
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken: 'short' }), PIN), { code: 'permission-denied', message: 'Admin is locked.' });
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken: 'x'.repeat(257) }), PIN), { code: 'permission-denied', message: 'Admin is locked.' });
  await assert.rejects(guard.requireAdmin(db, call('device-a', {}), PIN), { code: 'permission-denied', message: 'Admin is locked.' });
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken: 'x'.repeat(43) }), PIN), hasCode('permission-denied'));
});

test('a changed PIN ends the session', async () => {
  const db = new FakeFirestore();
  const { sessionToken } = await signIn(db, PIN);
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken }), '1357'), hasCode('permission-denied'));
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken }), PIN), hasCode('permission-denied'), 'and it stays ended');
});

test('a stored session does not reveal the PIN', async () => {
  const db = new FakeFirestore();
  const first = await signIn(db, PIN);
  const second = await signIn(db, PIN);
  const one = db.read('adminSessions', sha256(first.sessionToken));
  const two = db.read('adminSessions', sha256(second.sessionToken));
  assert.equal(one.pinFingerprint, sha256(`${first.sessionToken}:${PIN}`));
  assert.notEqual(one.pinFingerprint, two.pinFingerprint, 'the same PIN gives a different value per session');
  // Sessions from before this change (fingerprint of the PIN alone) are ended.
  db.seed('adminSessions', sha256('y'.repeat(43)), { uid: 'device-a', expiresAt: Timestamp.fromMillis(Date.now() + MINUTE), pinFingerprint: sha256(`study-room-pin:${PIN}`).slice(0, 24) });
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken: 'y'.repeat(43) }), PIN), hasCode('permission-denied'));
});

test('an empty or very short PIN means Admin is not set up', async () => {
  const db = new FakeFirestore();
  const notSetUp = { code: 'failed-precondition', message: 'Admin is not set up.' };
  for (const pin of ['', '123', undefined]) {
    await assert.rejects(guard.startAdminSession(db, call('device-a', { pin: pin ?? '' }), pin), notSetUp, JSON.stringify(pin));
    await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken: 'x'.repeat(43) }), pin), notSetUp);
  }
  assert.equal(db.all('adminRateLimits').length, 0, 'nothing is counted');
  await signIn(db, PIN);
});

test('a correct PIN after 4 or 5 wrong ones still works; the 6th attempt is the last one compared', async () => {
  let db = new FakeFirestore();
  for (let count = 1; count <= 4; count += 1) await assert.rejects(signIn(db, '0000'), WRONG);
  await signIn(db, PIN);
  assert.equal(addressCounter(db, '203.0.113.5'), undefined, 'a correct PIN clears its address');
  assert.equal(total(db).attempts, 4, 'and is not counted in the total');

  db = new FakeFirestore();
  for (let count = 1; count <= 5; count += 1) await assert.rejects(signIn(db, '0000'), WRONG);
  await signIn(db, PIN);

  db = new FakeFirestore();
  for (let count = 1; count <= 5; count += 1) await assert.rejects(signIn(db, '0000'), WRONG);
  await assert.rejects(signIn(db, '0000'), LOCKED, 'the 6th wrong PIN locks this address');
  await assert.rejects(signIn(db, PIN), LOCKED, 'the 7th is not compared, even when right');
  assert.equal(addressCounter(db, '203.0.113.5').attempts, 6);
  assert.equal(total(db).attempts, 6);
  await signIn(db, PIN, '203.0.113.7');
});

test('21 wrong PINs across addresses lock every new sign-in', async () => {
  const db = new FakeFirestore();
  for (let address = 1; address <= 5; address += 1) {
    for (let count = 1; count <= 4; count += 1) await assert.rejects(signIn(db, '0000', `198.51.100.${address}`), WRONG);
  }
  await assert.rejects(signIn(db, '0000', '198.51.100.6'), LOCKED);
  await assert.rejects(signIn(db, PIN, '192.0.2.77'), LOCKED);
  assert.equal(total(db).attempts, 21);
});

test('a correct PIN that reaches the total limit still works, and gives back the block it set', async () => {
  const db = new FakeFirestore();
  for (let address = 1; address <= 5; address += 1) {
    for (let count = 1; count <= 4; count += 1) await assert.rejects(signIn(db, '0000', `198.51.100.${address}`), WRONG);
  }
  await signIn(db, PIN, '192.0.2.77');
  assert.deepEqual([total(db).attempts, total(db).blockedUntil], [20, null]);
  await assert.rejects(signIn(db, '0000', '198.51.100.6'), LOCKED, 'the next wrong PIN still locks');
});

test('any number of correct sign-ins never leaves Admin locked', async () => {
  const db = new FakeFirestore();
  for (let count = 1; count <= 25; count += 1) await signIn(db, PIN, `192.0.2.${count}`, `admin-${count}`);
  assert.equal(total(db).attempts, 0);
  // At once, the attempts are counted before any is compared, so a few may
  // be turned away, but each correct one gives its count back.
  const results = await Promise.all(Array.from({ length: 25 }, (_, index) => settle(signIn(db, PIN, `192.0.2.${100 + index}`, `admin-${index}`))));
  assert.ok(results.filter(result => result.ok).length >= 21);
  assert.deepEqual([total(db).attempts, total(db).blockedUntil], [0, null]);
  await signIn(db, PIN);
});

test('a burst of parallel guesses from one address gets no further than one at a time', async () => {
  const db = new FakeFirestore();
  const guesses = Array.from({ length: 60 }, (_, index) => String(1000 + index));
  guesses.push(PIN);
  const results = await Promise.all(guesses.map(pin => settle(signIn(db, pin))));
  assert.equal(results.filter(result => result.ok).length, 0, 'no session');
  assert.equal(results.filter(result => result.message === WRONG.message).length, 5);
  assert.equal(results.filter(result => result.code === 'resource-exhausted').length, 56);
  assert.equal(addressCounter(db, '203.0.113.5').attempts, 6, 'at most 6 compared');
  assert.equal(total(db).attempts, 6);
});

test('a burst from many addresses compares at most 21 PINs in a window', async () => {
  const db = new FakeFirestore();
  const guesses = Array.from({ length: 100 }, (_, index) => signIn(db, String(5000 + index), `198.51.100.${index}`));
  guesses.push(signIn(db, PIN, '192.0.2.1'));
  const results = await Promise.all(guesses.map(settle));
  assert.equal(results.at(-1).code, 'resource-exhausted');
  assert.equal(results.filter(result => result.message === WRONG.message).length, 20);
  assert.equal(total(db).attempts, 21);
});

test('a PIN lock lasts 15 minutes from the attempt that set it', async () => {
  const db = new FakeFirestore();
  for (let count = 1; count <= 5; count += 1) {
    await assert.rejects(signIn(db, '0000'), WRONG);
    mock.timers.tick(MINUTE);
  }
  await assert.rejects(signIn(db, '0000'), LOCKED);
  mock.timers.tick(15 * MINUTE - 1);
  await assert.rejects(signIn(db, PIN), LOCKED);
  mock.timers.tick(1);
  await signIn(db, PIN);
});

// ---------- Admin sessions ----------

test('a session lasts 20 minutes with no change, and every change extends it', async () => {
  const db = new FakeFirestore();
  const { sessionToken } = await signIn(db, PIN);
  const request = call('device-a', { sessionToken });
  mock.timers.tick(19 * MINUTE);
  assert.equal((await guard.requireAdmin(db, request, PIN)).expiresInMs, MINUTE, 'reading does not extend it');
  mock.timers.tick(2 * MINUTE);
  await assert.rejects(guard.requireAdmin(db, request, PIN), hasCode('permission-denied'));
  assert.equal(db.read('adminSessions', sha256(sessionToken)), undefined, 'an ended session is deleted');

  const second = call('device-a', { sessionToken: (await signIn(db, PIN)).sessionToken });
  mock.timers.tick(15 * MINUTE);
  assert.equal((await guard.requireAdmin(db, second, PIN, { extend: true })).expiresInMs, 20 * MINUTE);
  mock.timers.tick(19 * MINUTE);
  assert.equal((await guard.requireAdmin(db, second, PIN)).expiresInMs, MINUTE);
  mock.timers.tick(MINUTE);
  await assert.rejects(guard.requireAdmin(db, second, PIN, { extend: true }), hasCode('permission-denied'));
});

test('extending a session that ended a moment ago is refused', async () => {
  const db = new FakeFirestore();
  const { sessionToken } = await signIn(db, PIN);
  const ref = db.collection('adminSessions').doc(sha256(sessionToken));
  const get = ref.get.bind(ref);
  const collection = db.collection.bind(db);
  // The session is read, then deleted (signed out elsewhere) before the update.
  db.collection = name => {
    const query = collection(name);
    if (name !== 'adminSessions') return query;
    return { doc: () => ({ get: async () => { const snapshot = await get(); await ref.delete(); return snapshot; }, update: data => ref.update(data), delete: () => ref.delete() }) };
  };
  await assert.rejects(guard.requireAdmin(db, call('device-a', { sessionToken }), PIN, { extend: true }),
    { code: 'permission-denied', message: 'Your Admin session ended. Enter the PIN again.' });
});

test('expired sessions and finished counters are removed, a bounded number at a time', async () => {
  const db = new FakeFirestore();
  for (let index = 0; index < 205; index += 1) {
    db.seed('adminSessions', `s${index}`, { expiresAt: Timestamp.fromMillis(Date.now() - 1) });
  }
  db.seed('adminSessions', 'live', { expiresAt: Timestamp.fromMillis(Date.now() + MINUTE) });
  await assert.rejects(signIn(db, '0000'), WRONG);
  mock.timers.tick(15 * MINUTE);
  assert.deepEqual(await guard.removeExpired(db, new Date()), { sessions: 200, limits: 0 }, 'a counter is kept for a full window');
  mock.timers.tick(1);
  assert.deepEqual(await guard.removeExpired(db), { sessions: 6, limits: 2 }, 'the live session expired meanwhile');
  assert.deepEqual(await guard.removeExpired(db), { sessions: 0, limits: 0 });
  assert.equal(db.all('adminSessions').length, 0);
});
