'use strict';

// Cloud Functions for LV Zion Study Rooms. Each endpoint checks who is calling,
// then hands off to lib/: config.js (the rules), schedule.js (dates and times),
// bookings.js (booking rules), actions.js (database changes), views.js (what
// each page may see) and guard.js (sign-in, limits, Admin PIN).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { HttpsError, onCall, onRequest } = require('firebase-functions/v2/https');
const config = require('./lib/config');
const { configProblems } = require('./lib/config-check');
const { bookableDates, lobbyDates } = require('./lib/schedule');
const { parseMemberRequest, parseAdminBooking } = require('./lib/bookings');
const { memberView, lobbyView, adminRows, clientConfig, daysView } = require('./lib/views');
const actions = require('./lib/actions');
const guard = require('./lib/guard');

// A mistake in config.js stops the deploy here instead of reaching members.
const problems = configProblems(config);
if (problems.length) throw new Error(`Fix functions/lib/config.js: ${problems.join(' ')}`);

initializeApp();
const db = getFirestore();
const ADMIN_PIN = defineSecret('STUDY_ROOM_ADMIN_PIN');
const REGION = 'us-west1';
const member = handler => onCall({ region: REGION }, handler);
const admin = handler => onCall({ region: REGION, secrets: [ADMIN_PIN] }, handler);

// Rule checks throw plain Errors; members see their message.
function checked(parse) {
  try {
    return parse();
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message);
  }
}

// ---------- Member app ----------

exports.memberSchedule = member(async request => {
  const uid = guard.requireUser(request);
  const now = new Date();
  const dates = bookableDates(now);
  return memberView(await actions.scheduleRecordsFor(db, dates, uid), dates, uid, now);
});

exports.memberSubmitBooking = member(async request => {
  const uid = guard.requireUser(request);
  await guard.limitReservationRequests(db, request);
  const reservation = checked(() => parseMemberRequest(request.data));
  return actions.submitReservation(db, reservation, uid);
});

exports.memberCancelBooking = member(async request => {
  const uid = guard.requireUser(request);
  await actions.cancelReservation(db, request.data?.bookingId, uid);
  return { ok: true };
});

// Ending early only frees time, so it needs no request limit.
exports.memberEndBookingEarly = member(async request => {
  const uid = guard.requireUser(request);
  return actions.endEarly(db, request.data?.bookingId, request.data?.end, uid, uid);
});

// ---------- Lobby TV (public, read-only) ----------

const LOBBY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

exports.publicLobbySchedule = onRequest({ region: REGION }, async (request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  if (!LOBBY_METHODS.includes(request.method)) {
    response.set('Allow', LOBBY_METHODS.join(', '));
    response.status(405).send('');
    return;
  }
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  const now = new Date();
  const dates = lobbyDates(now);
  const view = lobbyView(await actions.scheduleRecordsFor(db, dates), dates, now);
  response.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  response.set('X-Content-Type-Options', 'nosniff');
  response.json(view);
});

// ---------- Admin ----------

exports.adminStartSession = admin(request => guard.startAdminSession(db, request, ADMIN_PIN.value()));

exports.adminEndSession = admin(async request => {
  const session = await guard.requireAdmin(db, request, ADMIN_PIN.value());
  await session.ref.delete();
  return { ok: true };
});

// Admin sees every record on the open days, in any status, with its private
// note. Reading does not keep Admin unlocked.
exports.adminSchedule = admin(async request => {
  await guard.requireAdmin(db, request, ADMIN_PIN.value());
  const now = new Date();
  const dates = bookableDates(now);
  const records = await actions.allRecordsFor(db, dates);
  const notes = await actions.notesFor(db, records.map(record => record.id));
  return { config: clientConfig(), days: daysView(dates), bookings: adminRows(records, notes, now) };
});

async function bookingAction(data, uid) {
  switch (data.action) {
    case 'add':
      return actions.adminAdd(db, checked(() => parseAdminBooking(data.booking)), uid);
    case 'cancel':
      await actions.adminCancel(db, data.bookingId, uid);
      return { ok: true };
    case 'restore':
      await actions.adminRestore(db, data.bookingId, data.assignments, uid);
      return { ok: true };
    case 'end-early':
      return actions.endEarly(db, data.bookingId, data.end, null, uid);
    case 'remove-old':
      return actions.removeOldRecords(db);
    default:
      throw new HttpsError('invalid-argument', 'Unknown Admin action.');
  }
}

// Every Admin change keeps Admin unlocked for another session's length, and
// says how long that is.
exports.adminBookingAction = admin(async request => {
  const { uid, expiresInMs } = await guard.requireAdmin(db, request, ADMIN_PIN.value(), { extend: true });
  return { ...await bookingAction(request.data || {}, uid), expiresInMs };
});

// Private notes are visible only on the Admin page.
exports.adminNoteAction = admin(async request => {
  const data = request.data || {};
  const { uid, expiresInMs } = await guard.requireAdmin(db, request, ADMIN_PIN.value(), { extend: data.action === 'save' });
  if (data.action === 'read') return { notes: await actions.readNotes(db, data.bookingIds) };
  if (data.action === 'save') {
    await actions.saveNote(db, data.bookingId, data.note, uid);
    return { ok: true, expiresInMs };
  }
  throw new HttpsError('invalid-argument', 'Unknown note action.');
});
