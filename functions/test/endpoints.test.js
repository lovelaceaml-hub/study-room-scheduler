'use strict';

// The deployed Cloud Functions, called the way Firebase calls them, against an
// in-memory Firestore. Nothing here can reach Google: getFirestore is replaced
// before index.js loads (initializeApp itself makes no requests), and
// FIRESTORE_EMULATOR_HOST points at a closed local port in case anything slips
// through. The PIN is fictional.

process.env.GCLOUD_PROJECT = 'demo-study-rooms';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.STUDY_ROOM_ADMIN_PIN = '2468';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mock, beforeEach } = require('node:test');
const firestore = require('firebase-admin/firestore');
const config = require('../lib/config');
const { FakeFirestore } = require('./support/fake-firestore');
const { THURSDAY, SATURDAY, useFixedClock, setClock, local, seedBooking, call, settle, hasCode } = require('./support/fixtures');

const db = new FakeFirestore();
firestore.getFirestore = () => db;
const functions = require('../index.js');

useFixedClock();
beforeEach(() => {
  db.clear();
  process.env.STUDY_ROOM_ADMIN_PIN = '2468';
});

const PIN = '2468';
const MINUTE = 60 * 1000;
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const run = (name, uid, data = {}, address) => functions[name].run(call(uid, data, address));
const signIn = async (uid = 'admin-device') => (await run('adminStartSession', uid, { pin: PIN })).sessionToken;
const sessionOf = token => db.read('adminSessions', sha256(token));

const member = {
  date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'other', name: 'Brother Sam Sample', reservedFor: 'Study'
};

// A plain request and response, as the HTTP function gets them.
async function fetchLobby(method = 'GET') {
  const response = { statusCode: 200, headers: {}, body: undefined };
  response.set = (key, value) => { response.headers[key] = value; return response; };
  response.status = code => { response.statusCode = code; return response; };
  response.send = body => { response.body = body; return response; };
  response.json = body => { response.body = body; return response; };
  await functions.publicLobbySchedule({ method, headers: {}, url: '/' }, response);
  return response;
}

// Deploying drops any function not listed here, so a change to this list is a
// change to what is live.
test('the endpoints are exactly these', () => {
  assert.deepEqual(Object.keys(functions).sort(), [
    'adminBookingAction', 'adminEndSession', 'adminNoteAction', 'adminSchedule', 'adminStartSession',
    'memberCancelBooking', 'memberEndBookingEarly', 'memberSchedule', 'memberSubmitBooking', 'publicLobbySchedule'
  ]);
});

test('a mistake in config.js stops the functions from loading', () => {
  const path = require.resolve('../index.js');
  config.SPECIAL_DAYS.push({ date: '2026-10-5', opens: '2026-10-01', services: [] });
  delete require.cache[path];
  assert.throws(() => require(path), /Fix functions\/lib\/config.js: SPECIAL_DAYS 2026-10-5/);
});

// ---------- Members ----------

test('member endpoints refuse signed-out calls', async () => {
  for (const name of ['memberSchedule', 'memberSubmitBooking', 'memberCancelBooking', 'memberEndBookingEarly']) {
    await assert.rejects(run(name, null, { ...member, bookingId: 'a', end: '11:30' }), hasCode('unauthenticated'), name);
  }
  assert.equal(db.all('bookings').length, 0);
});

test('the member schedule has every active reservation, plus only this device\'s others', async () => {
  seedBooking(db, 'theirs', { ownerUid: 'device-b', assignments: { room: 'room-1' } });
  seedBooking(db, 'their-cancel', { ownerUid: 'device-b', status: 'cancelled', start: '12:00', end: '13:00', assignments: { room: 'room-2' } });
  seedBooking(db, 'my-cancel', { ownerUid: 'device-a', status: 'cancelled', start: '13:00', end: '14:00', assignments: { room: 'room-2' } });
  seedBooking(db, 'mine', { ownerUid: 'device-a', start: '16:00', end: '17:00', assignments: { room: 'room-3' } });
  seedBooking(db, 'tuesday', { ownerUid: 'device-a', date: '2026-10-06', assignments: { room: 'room-3' } });
  const view = await run('memberSchedule', 'device-a');
  assert.equal(view.version, 2);
  assert.deepEqual(view.days.map(day => day.date), [SATURDAY]);
  assert.deepEqual(view.bookings.map(row => [row.id, row.mine]), [['mine', true], ['theirs', false]]);
  assert.deepEqual(view.mine.map(row => [row.id, row.status]), [['mine', 'approved'], ['my-cancel', 'cancelled']]);
  assert.equal(JSON.stringify(view).includes('device-b'), false);
});

test('a member books, ends early and cancels through the endpoints', async () => {
  const booked = await run('memberSubmitBooking', 'device-a', { ...member, end: '12:30', requestId: 'endpoint-0123456789' });
  assert.deepEqual(booked, { id: 'r-endpoint-0123456789', unit: 'room-1', takeover: false });
  assert.deepEqual(await run('memberSubmitBooking', 'device-a', { ...member, end: '12:30', requestId: 'endpoint-0123456789' }), { ...booked, repeated: true });
  assert.deepEqual(await run('memberEndBookingEarly', 'device-a', { bookingId: booked.id, end: '12:00' }), { end: '12:00' });
  assert.deepEqual(await run('memberCancelBooking', 'device-a', { bookingId: booked.id }), { ok: true });
  assert.equal(db.read('bookings', booked.id).cancelledBy, 'member');
  await assert.rejects(run('memberSubmitBooking', 'device-a', { ...member, name: ' ' }), { code: 'invalid-argument', message: 'Your name is required.' });
  await assert.rejects(run('memberSubmitBooking', 'device-a', { ...member, takeoverUnit: 'wb-1' }), { code: 'invalid-argument', message: 'Choose a valid unit.' });
  await assert.rejects(run('memberSubmitBooking', 'device-a', { ...member, allowTakeover: true }),
    { code: 'invalid-argument', message: 'This page is out of date. Reload the page and try again.' });
});

test('a retry whose first answer was lost gets that answer, even after the start time or the request limit', async () => {
  setClock(local(SATURDAY, '10:59:30'));
  const first = await run('memberSubmitBooking', 'device-a', { ...member, requestId: 'lost-answer-0123456789' });
  setClock(local(SATURDAY, '11:01:05'));
  assert.deepEqual(await run('memberSubmitBooking', 'device-a', { ...member, requestId: 'lost-answer-0123456789' }), { ...first, repeated: true });
  await assert.rejects(run('memberSubmitBooking', 'device-a', { ...member, requestId: 'a-new-request-0123456789' }),
    { code: 'invalid-argument', message: 'That start time has already passed. Choose a later time.' });
  for (let attempt = 0; attempt < 9; attempt += 1) await settle(run('memberSubmitBooking', 'device-a', { ...member, start: '22:00', end: '22:30' }));
  assert.deepEqual(await run('memberSubmitBooking', 'device-a', { ...member, requestId: 'lost-answer-0123456789' }), { ...first, repeated: true });
  await assert.rejects(run('memberSubmitBooking', 'device-b', { ...member, start: '16:00', end: '17:00', requestId: 'lost-answer-0123456789' }),
    { code: 'permission-denied', message: 'Reload the page and try again.' }, 'another device cannot reuse the id');
});

test('the 9th reservation request from one device in 15 minutes is refused', async () => {
  const starts = ['11:00', '12:00', '13:00', '16:00', '17:00', '18:00', '21:00', '22:00'];
  const results = [];
  for (const start of starts) {
    results.push(await settle(run('memberSubmitBooking', 'device-a', { ...member, start, end: `${Number(start.slice(0, 2)) + 1}:00` })));
  }
  assert.equal(results.filter(result => result.ok).length, 4);
  assert.equal(results.filter(result => result.code === 'resource-exhausted' && /4 reservations/.test(result.message)).length, 4);
  await assert.rejects(run('memberSubmitBooking', 'device-a', { ...member, start: '15:30', end: '16:00' }),
    { code: 'resource-exhausted', message: 'Too many reservation requests from this device. Wait a few minutes and try again.' });
});

// ---------- Lobby TV ----------

test('the lobby gets public rows only, with CORS and caching', async () => {
  seedBooking(db, 'room', { name: 'Sister Grace Park', assignments: { room: 'room-1' } });
  seedBooking(db, 'hold', { name: 'Private Person', purpose: 'blocked', reservedFor: 'Secret reason', ownerUid: null, assignments: { room: 'room-2' } });
  seedBooking(db, 'gone', { name: 'Cancelled Person', status: 'cancelled', assignments: { room: 'room-3' } });
  seedBooking(db, 'board', { name: 'Board Person', needs: { whiteboard: true }, assignments: { whiteboard: 'wb-1' } });
  const response = await fetchLobby();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.body), ['version', 'generatedAt', 'config', 'days', 'bookings']);
  assert.equal(response.body.generatedAt, THURSDAY.toISOString());
  assert.deepEqual(response.body.days.map(day => day.date), ['2026-10-01', SATURDAY]);
  assert.deepEqual(response.body.bookings, [
    { date: SATURDAY, start: '11:00', end: '12:00', room: 'room-2', name: 'Reserved' },
    { date: SATURDAY, start: '11:00', end: '12:00', room: 'room-1', name: 'S Grace' }
  ]);
  const text = JSON.stringify(response.body);
  for (const secret of ['Secret reason', 'Private Person', 'Cancelled', 'Board Person', 'owner-', 'Park']) assert.equal(text.includes(secret), false, secret);
  assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(response.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal((await fetchLobby('HEAD')).statusCode, 200);
});

test('the lobby answers OPTIONS with 204 and other methods with 405', async () => {
  const options = await fetchLobby('OPTIONS');
  assert.deepEqual([options.statusCode, options.headers['Access-Control-Allow-Methods']], [204, 'GET, HEAD, OPTIONS']);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const refused = await fetchLobby(method);
    assert.deepEqual([refused.statusCode, refused.headers.Allow, refused.body], [405, 'GET, HEAD, OPTIONS', ''], method);
  }
});

// ---------- Admin ----------

test('Admin sign-in returns how long the session lasts, and refuses when no PIN is set up', async () => {
  const started = await run('adminStartSession', 'admin-device', { pin: PIN });
  assert.equal(started.expiresInMs, 20 * MINUTE);
  assert.equal(started.expiresAt, THURSDAY.getTime() + 20 * MINUTE);
  await assert.rejects(run('adminStartSession', 'admin-device', { pin: '0000' }), { code: 'permission-denied', message: 'That PIN is not correct.' });
  process.env.STUDY_ROOM_ADMIN_PIN = '';
  await assert.rejects(run('adminStartSession', 'admin-device', { pin: '' }), { code: 'failed-precondition', message: 'Admin is not set up.' });
  await assert.rejects(run('adminSchedule', 'admin-device', { sessionToken: started.sessionToken }), { code: 'failed-precondition', message: 'Admin is not set up.' });
});

const ADMIN_CALLS = [
  ['adminSchedule', {}],
  ['adminEndSession', {}],
  ['adminBookingAction', { action: 'add', booking: { date: SATURDAY, start: '11:00', end: '12:00', name: 'Hold', purpose: 'blocked', assignments: { room: 'room-4' } } }],
  ['adminBookingAction', { action: 'cancel', bookingId: 'target' }],
  ['adminBookingAction', { action: 'restore', bookingId: 'gone', assignments: { room: 'room-3' } }],
  ['adminBookingAction', { action: 'end-early', bookingId: 'target', end: '11:30' }],
  ['adminBookingAction', { action: 'remove-old' }],
  ['adminBookingAction', { action: 'unknown' }],
  ['adminNoteAction', { action: 'read', bookingIds: ['target'] }],
  ['adminNoteAction', { action: 'save', bookingId: 'target', note: 'Changed' }]
];

test('every Admin endpoint and action refuses a call without a valid session', async () => {
  for (const [name, data] of ADMIN_CALLS) {
    db.clear();
    seedBooking(db, 'target', { assignments: { room: 'room-1' } });
    seedBooking(db, 'gone', { status: 'cancelled', assignments: { room: 'room-3' } });
    seedBooking(db, 'old', { date: '2026-01-03' });
    db.seed('privateBookingNotes', 'target', { note: 'Private' });
    const before = JSON.stringify([...db.store]);
    const label = `${name} ${data.action || ''}`;
    await assert.rejects(run(name, null, data), hasCode('unauthenticated'), label);
    await assert.rejects(run(name, 'admin-device', data), { code: 'permission-denied', message: 'Admin is locked.' }, label);
    await assert.rejects(run(name, 'admin-device', { ...data, sessionToken: 'short' }), { code: 'permission-denied', message: 'Admin is locked.' }, label);
    await assert.rejects(run(name, 'admin-device', { ...data, sessionToken: 'x'.repeat(43) }), hasCode('permission-denied'), label);
    const theirs = await signIn('other-device');
    await assert.rejects(run(name, 'admin-device', { ...data, sessionToken: theirs }), hasCode('permission-denied'), `${label}: another device's session`);
    const expired = await signIn();
    mock.timers.tick(20 * MINUTE);
    await assert.rejects(run(name, 'admin-device', { ...data, sessionToken: expired }), hasCode('permission-denied'), `${label}: expired`);
    mock.timers.setTime(THURSDAY.getTime());
    const after = [...db.store].filter(([path]) => !path.startsWith('adminSessions/') && !path.startsWith('adminRateLimits/'));
    const unchanged = JSON.parse(before).filter(([path]) => !path.startsWith('adminSessions/') && !path.startsWith('adminRateLimits/'));
    assert.equal(JSON.stringify(after), JSON.stringify(unchanged), `${label} changed nothing`);
  }
});

test('Admin sees every reservation in any status, with notes, and reading does not extend the session', async () => {
  seedBooking(db, 'live', { assignments: { room: 'room-1' }, createdAt: firestore.Timestamp.fromMillis(1000) });
  seedBooking(db, 'gone', { status: 'cancelled', cancelledBy: 'admin', assignments: { room: 'room-2' } });
  seedBooking(db, 'replaced', { status: 'overridden', assignments: {} });
  db.seed('privateBookingNotes', 'live', { note: 'Keys at the desk' });
  const token = await signIn();
  mock.timers.tick(5 * MINUTE);
  const view = await run('adminSchedule', 'admin-device', { sessionToken: token });
  assert.deepEqual(Object.keys(view), ['config', 'days', 'bookings']);
  assert.deepEqual(view.bookings.map(row => [row.id, row.status, row.note, row.byAdmin, row.restorable]), [
    ['gone', 'cancelled', '', true, true], ['live', 'approved', 'Keys at the desk', false, false], ['replaced', 'overridden', '', false, true]
  ]);
  assert.equal(view.bookings[1].createdAt, 1000);
  for (const row of view.bookings) assert.equal('ownerUid' in row || 'updatedBy' in row, false);
  assert.equal(sessionOf(token).expiresAt.toMillis(), THURSDAY.getTime() + 20 * MINUTE);
});

test('every Admin change keeps Admin unlocked for another 20 minutes and says so', async () => {
  seedBooking(db, 'target', { start: '11:00', end: '13:00', assignments: { room: 'room-1' } });
  seedBooking(db, 'old', { date: '2026-01-03' });
  const token = await signIn();
  const admin = (name, data) => run(name, 'admin-device', { ...data, sessionToken: token });
  const expect = async (name, data, result) => {
    mock.timers.tick(10 * MINUTE);
    assert.deepEqual(await admin(name, data), { ...result, expiresInMs: 20 * MINUTE }, `${name} ${data.action}`);
    assert.equal(sessionOf(token).expiresAt.toMillis(), Date.now() + 20 * MINUTE);
  };
  await expect('adminBookingAction', { action: 'end-early', bookingId: 'target', end: '12:00' }, { end: '12:00' });
  await expect('adminNoteAction', { action: 'save', bookingId: 'target', note: 'Changed' }, { ok: true });
  await expect('adminBookingAction', { action: 'cancel', bookingId: 'target' }, { ok: true });
  await expect('adminBookingAction', { action: 'restore', bookingId: 'target', assignments: { room: 'room-2' } }, { ok: true });
  await expect('adminBookingAction', { action: 'remove-old' }, { removed: 1, more: false });
  mock.timers.tick(10 * MINUTE);
  const added = await admin('adminBookingAction', { action: 'add', booking: { date: SATURDAY, start: '16:00', end: '17:00', name: 'Hold', purpose: 'blocked', assignments: { room: 'room-4' } } });
  assert.deepEqual(Object.keys(added), ['id', 'expiresInMs']);
  assert.deepEqual(await admin('adminNoteAction', { action: 'read', bookingIds: ['target'] }), { notes: { target: 'Changed' } });
  assert.equal(db.read('bookings', 'target').cancelledBy, undefined);

  // Reading for 20 minutes without a change locks Admin.
  mock.timers.tick(19 * MINUTE);
  await admin('adminSchedule', {});
  mock.timers.tick(MINUTE);
  await assert.rejects(admin('adminSchedule', {}), { code: 'permission-denied', message: 'Your Admin session ended. Enter the PIN again.' });
});

test('Admin input errors name the problem', async () => {
  const token = await signIn();
  const admin = data => run('adminBookingAction', 'admin-device', { ...data, sessionToken: token });
  await assert.rejects(admin({ action: 'unknown' }), { code: 'invalid-argument', message: 'Unknown Admin action.' });
  await assert.rejects(admin({ action: 'add', booking: { date: SATURDAY, start: '11:00', end: '12:00', name: '', purpose: 'blocked', assignments: { room: 'room-1' } } }),
    { code: 'invalid-argument', message: 'Name is required.' });
  await assert.rejects(admin({ action: 'cancel', bookingId: 'missing' }), hasCode('not-found'));
  await assert.rejects(run('adminNoteAction', 'admin-device', { action: 'delete', sessionToken: token }), { code: 'invalid-argument', message: 'Unknown note action.' });
  await assert.rejects(run('adminBookingAction', 'admin-device', { sessionToken: token }), { code: 'invalid-argument', message: 'Unknown Admin action.' });
});

test('signing out ends the session', async () => {
  const token = await signIn();
  assert.deepEqual(await run('adminEndSession', 'admin-device', { sessionToken: token }), { ok: true });
  assert.equal(sessionOf(token), undefined);
  await assert.rejects(run('adminSchedule', 'admin-device', { sessionToken: token }), hasCode('permission-denied'));
});
