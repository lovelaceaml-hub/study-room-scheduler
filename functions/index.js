'use strict';

// Cloud Functions for LV Zion Study Rooms. Each endpoint checks who is calling,
// then hands off to lib/: config.js (the rules), schedule.js (dates and times),
// bookings.js (booking rules), actions.js (database changes), views.js (what
// each page may see) and guard.js (sign-in, limits, Admin PIN).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { HttpsError, onCall, onRequest } = require('firebase-functions/v2/https');
const { bookableDates, lobbyDates } = require('./lib/schedule');
const { parseMemberRequest, parseAdminBooking } = require('./lib/bookings');
const { memberView, lobbyView, clientConfig, daysView } = require('./lib/views');
const actions = require('./lib/actions');
const guard = require('./lib/guard');

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
  const dates = bookableDates();
  return memberView(await actions.recordsFor(db, dates), dates, uid);
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

exports.publicLobbySchedule = onRequest({ region: REGION }, async (request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  const dates = lobbyDates();
  const view = lobbyView(await actions.recordsFor(db, dates), dates);
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

// Admin sees full records, including cancelled and released ones.
exports.adminSchedule = admin(async request => {
  await guard.requireAdmin(db, request, ADMIN_PIN.value());
  const dates = bookableDates();
  return {
    config: clientConfig(),
    days: daysView(dates),
    bookings: await actions.recordsFor(db, dates)
  };
});

exports.adminBookingAction = admin(async request => {
  const { uid } = await guard.requireAdmin(db, request, ADMIN_PIN.value());
  const data = request.data || {};
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
});

// Private notes are visible only on the Admin page.
exports.adminNoteAction = admin(async request => {
  const { uid } = await guard.requireAdmin(db, request, ADMIN_PIN.value());
  const data = request.data || {};
  if (data.action === 'read') return { notes: await actions.readNotes(db, data.bookingIds) };
  if (data.action === 'save') {
    await actions.saveNote(db, data.bookingId, data.note, uid);
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown note action.');
});
