'use strict';

/* =====================================================================
   LV Zion Study Rooms — v2
   Sibling of worship-duty-app / new-song-app / morning-prayer-app /
   exhibition-tours (same architecture): vanilla JS, Firestore real-time
   sync with a full localStorage fallback, one screen of embedded CSS,
   no build step.

   Members request a study room or a piece of shared equipment
   (whiteboard or TV) for the upcoming Tuesday or Saturday; a committee
   approver assigns the actual room/unit and approves or declines. A
   derived (never stored) waiting line forms when a resource type is
   full. Admin is PIN-gated through short-lived, server-validated sessions.
   ===================================================================== */

/* ================= constants ================= */

const DATA_KEY = 'srs-data-v2';
const ADMIN_KEY = 'srs-admin-session';
const MY_BOOKINGS_KEY = 'srs-my-bookings';   // localStorage array of this device's own booking ids
const NAME_KEY = 'srs-name';                 // localStorage: last name typed in the reservation popup

const PURPOSES = [
  { id: 'contact', label: 'Contact' },
  { id: 'new-member', label: 'New Member' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'other', label: 'Other' }
];
/* Admin-only addition, used solely on the "Add a booking" form (e.g. to
   hold a room for another use). Never offered to
   members in the reservation popup. Renders as a neutral "Reserved" chip. */
const ADMIN_PURPOSES = PURPOSES.concat([{ id: 'blocked', label: 'Room unavailable / reserved' }]);

/* The things a member can ask for, in the order they appear everywhere
   (checkboxes, admin assignment rows, etc). A podium is NOT listed: each
   whiteboard has its matching podium built in, so it comes automatically
   with the whiteboard and never needs to be requested separately. */
const NEED_TYPES = [
  { id: 'room', label: 'Study room', plural: 'Study Rooms' },
  { id: 'whiteboard', label: 'Whiteboard', plural: 'Whiteboards' },
  { id: 'tv', label: 'TV', plural: 'TVs' }
];

const ROOMS = [
  { id: 'room-1', label: 'Study Room 1', num: 1, hasEquipment: true },
  { id: 'room-2', label: 'Study Room 2', num: 2, hasEquipment: true },
  { id: 'room-3', label: 'Study Room 3', num: 3, hasEquipment: true },
  { id: 'room-4', label: 'Study Room 4', num: 4, hasEquipment: true }
];
const WHITEBOARDS = [
  { id: 'wb-1', label: 'Whiteboard 1 · Large', num: 1 },
  { id: 'wb-2', label: 'Whiteboard 2 · Large', num: 2 },
  { id: 'wb-3', label: 'Whiteboard 3 · Large', num: 3 },
  { id: 'wb-4', label: 'Whiteboard 4 · Vertical', num: 4 },
  { id: 'wb-5', label: 'Whiteboard 5 · Vertical', num: 5 }
];
const TVS = [1, 2, 3].map(n => ({ id: 'tv-' + n, label: 'TV ' + n, num: n }));

const UNITS_BY_TYPE = { room: ROOMS, whiteboard: WHITEBOARDS, tv: TVS };
const CAPACITY = { room: ROOMS.length, whiteboard: WHITEBOARDS.length, tv: TVS.length };

/* Preferred-room pill choices in the member popup: null = "No preference". */
const PREFERRED_ROOM_CHOICES = [null, 'room-1', 'room-2', 'room-3', 'room-4'];

const TABS = [
  { id: 'schedule', label: 'Reservations' },
  { id: 'mine', label: 'My reservations' },
  { id: 'admin', label: 'Admin' }
];

/* ================= state ================= */

let state = {
  bookings: {}    // id -> booking (see spec shape); may contain stale/invalid docs, always filter via bookingsList()
};
let ui = {
  tab: 'schedule',
  selectedDate: null,   // shared by Reservations and Admin
  memberType: 'room',   // resource highlighted by the Reservations picker
  adminType: 'room',    // resource displayed in the matching Admin calendar
  memberSelection: null, // { date, type, start, end, windowIdx }
  pinError: '',
  submitting: false,
  signup: null,         // reservation-popup draft, created from a calendar cell
  signupBaseline: null, // serialized initial popup state, used for discard warnings
  returnFocusKey: null, // calendar-cell key to restore focus after the popup closes
  adminAssign: {},       // bookingId -> { room, whiteboard, tv } draft unit picks (pending or re-approve)
  adminReapproveId: null, // id of a declined/cancelled booking currently showing the assignment UI
  adminForm: null,       // Admin "Add a booking" form draft, created lazily by ensureAdminFormDraft()
  adminNotes: {},
  adminNotesDate: null,
  adminNotesLoading: false
};

let fb = null; // Firebase modules, authenticated user, Firestore, and callable functions

/* ================= tiny helpers ================= */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function timestampMillis(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

/* ================= date/time helpers ================= */

function pad(n) { return (n < 10 ? '0' : '') + n; }
function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayISO() { return toISO(new Date()); }
function dateObj(iso) { return new Date(iso + 'T12:00:00'); }
function addDaysISO(iso, n) {
  const d = dateObj(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function fmtDate(iso) {
  return dateObj(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtHeaderDate(iso) {
  return dateObj(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}
/* 'HH:MM' (24h) -> '2:00 PM' */
function fmtTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(hhmm || '');
  let h = +m[1];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m[2] + ' ' + ap;
}
/* Compact time for tight spaces: '2:00 PM' -> '2', '2:30 PM' -> '2:30' */
function fmtTimeTight(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(hhmm || '');
  let h = +m[1] % 12 || 12;
  return m[2] === '00' ? String(h) : h + ':' + m[2];
}
function minsOfDay(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return (+m[1]) * 60 + (+m[2]);
}
function hhmmOfMins(mins) {
  return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
}
/* Upcoming Saturday: today if today is Saturday, else the next one. */
function upcomingSaturdayISO() {
  const d = dateObj(todayISO());
  const offset = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  return toISO(d);
}
/* Upcoming Tuesday: today if today is Tuesday, else the next one. */
function upcomingTuesdayISO() {
  const d = dateObj(todayISO());
  const offset = (2 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  return toISO(d);
}
function upcomingBookingDates() {
  return [upcomingTuesdayISO(), upcomingSaturdayISO()].sort();
}
function selectedDate() {
  const dates = upcomingBookingDates();
  if (dates.indexOf(ui.selectedDate) === -1) ui.selectedDate = dates[0];
  return ui.selectedDate;
}
function isSaturday(date) { return dateObj(date).getDay() === 6; }
function isTuesday(date) { return dateObj(date).getDay() === 2; }
function demoMode() { return new URLSearchParams(window.location.search).get('demo') === '1'; }

/* Every schedule segment is explicit so a selected range can never cross
   a service. Saturday begins at 9:00 AM to keep its morning service visible;
   reservable slots still begin at 10:00 AM. */
function scheduleSegments(date) {
  if (isSaturday(date)) return [
    { start: '09:00', end: '10:00', label: 'Morning service', service: true },
    { start: '10:00', end: '15:00', label: 'Morning and early afternoon' },
    { start: '15:00', end: '16:00', label: 'Afternoon service', service: true },
    { start: '16:00', end: '20:00', label: 'Afternoon and evening' },
    { start: '20:00', end: '21:00', label: 'Evening service', service: true },
    { start: '21:00', end: '22:00', label: 'Late evening' }
  ];
  return [
    { start: '10:00', end: '20:00', label: 'Daytime and evening' },
    { start: '20:00', end: '21:00', label: 'Evening service', service: true },
    { start: '21:00', end: '22:00', label: 'Late evening' }
  ];
}
function bookingWindows(date) { return scheduleSegments(date).filter(w => !w.service); }
function serviceWindows(date) { return scheduleSegments(date).filter(w => w.service); }
/* Every valid 30-min slot start inside a window. */
function slotStarts(window) {
  const startMin = minsOfDay(window.start);
  const endMin = minsOfDay(window.end);
  const starts = [];
  for (let m = startMin; m + 30 <= endMin; m += 30) starts.push(hhmmOfMins(m));
  return starts;
}
function allSlotStarts(date) {
  let out = [];
  bookingWindows(date).forEach(w => { out = out.concat(slotStarts(w)); });
  return out;
}
function windowIndexFor(date, hhmm) {
  const m = minsOfDay(hhmm);
  return bookingWindows(date).findIndex(w => m >= minsOfDay(w.start) && m < minsOfDay(w.end));
}
function isValidBookingRange(date, start, end) {
  const dates = upcomingBookingDates();
  if (dates.indexOf(date) === -1 || !start || !end) return false;
  const startMin = minsOfDay(start), endMin = minsOfDay(end);
  if (startMin >= endMin || startMin % 30 || endMin % 30) return false;
  return bookingWindows(date).some(w => startMin >= minsOfDay(w.start) && endMin <= minsOfDay(w.end));
}
/* Half-open interval overlap: [aStart,aEnd) vs [bStart,bEnd). */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return minsOfDay(aStart) < minsOfDay(bEnd) && minsOfDay(bStart) < minsOfDay(aEnd);
}

/* ================= resource/unit model ================= */

function unitsForType(type) { return UNITS_BY_TYPE[type] || []; }
function unitById(type, id) { return unitsForType(type).find(u => u.id === id) || null; }
function unitLabel(type, id) {
  const u = unitById(type, id);
  if (!u && type === 'room' && id === 'room-baptism') return 'Retired room';
  return u ? u.label : id;
}
function needLabel(type) {
  const nt = NEED_TYPES.find(n => n.id === type);
  return nt ? nt.label : type;
}

/* ================= booking model ================= */

/* v1 docs (and anything malformed) are filtered out everywhere by
   funneling all reads through here. */
function isValidBooking(b) {
  return !!b && typeof b === 'object' && !('resourceId' in b) && b.needs && typeof b.needs === 'object';
}
function bookingsList() {
  const live = Object.keys(state.bookings)
    .map(id => Object.assign({ id: id }, state.bookings[id]))
    .filter(isValidBooking);
  return demoMode() ? live.concat(demoBookings()) : live;
}
function bookingByIdSafe(id) {
  const sample = demoBookings().find(b => b.id === id);
  if (sample) return sample;
  const b = state.bookings[id];
  return isValidBooking(b) ? Object.assign({ id: id }, b) : null;
}

function demoBookings() {
  if (!demoMode()) return [];
  const date = upcomingBookingDates()[0];
  const created = Date.now() - 45 * 60 * 1000;
  return [
    { id: 'demo-room-4', date, start: '10:00', end: '13:30', name: 'Anthony', purpose: 'contact', purposeOther: '', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-4', whiteboard: null, tv: null }, createdAt: created, decidedAt: created + 1000 },
    { id: 'demo-tv-2', date, start: '14:00', end: '15:00', name: 'Maria R.', purpose: 'new-member', purposeOther: '', status: 'cancelled', needs: { room: false, whiteboard: false, tv: true }, assignments: { room: null, whiteboard: null, tv: null }, lastAssignments: { room: null, whiteboard: null, tv: 'tv-2' }, createdAt: created - 600000, updatedAt: created - 300000 },
    { id: 'demo-whiteboard-1', date, start: '16:00', end: '17:30', name: 'Daniel K.', purpose: 'meeting', purposeOther: '', status: 'pending', needs: { room: false, whiteboard: true, tv: false }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: created - 1200000 },
    { id: 'demo-room-1', date, start: '18:00', end: '19:00', name: 'Sofia M.', purpose: 'other', purposeOther: 'Family Bible study', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: created - 1800000, decidedAt: created - 1700000 }
  ];
}
function bookingsForDate(date) { return bookingsList().filter(b => b.date === date); }
function activeBookingsForDate(date) {
  return bookingsForDate(date).filter(b => b.status === 'pending' || b.status === 'approved');
}
function needsOf(b) { return b.needs || {}; }
function assignmentsOf(b) { return b.assignments || {}; }

const PURPOSE_MAP = {};
PURPOSES.concat(ADMIN_PURPOSES).forEach(p => { PURPOSE_MAP[p.id] = p.label; });
function purposeLabel(p) { return PURPOSE_MAP[p] || p || ''; }
function bookingPurposeText(b) {
  if (b.purpose === 'other' && b.purposeOther) return 'Other — ' + b.purposeOther;
  return purposeLabel(b.purpose);
}
const STATUS_LABEL = { pending: 'Pending review', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

function neededTypesOf(b) {
  const n = needsOf(b);
  return NEED_TYPES.map(nt => nt.id).filter(t => n[t]);
}
function needsSummary(b) {
  return neededTypesOf(b).map(needLabel).join(', ') || '—';
}

/* ---- server-validated Admin session; sessionStorage clears when the
   browser session ends and the backend independently expires the token. ---- */
function adminUnlocked() {
  try {
    const session = JSON.parse(sessionStorage.getItem(ADMIN_KEY) || 'null');
    return !!(session && session.token && session.expiresAt > Date.now());
  } catch (e) { return false; }
}
function adminSessionToken() {
  if (!adminUnlocked()) return '';
  try { return JSON.parse(sessionStorage.getItem(ADMIN_KEY)).token || ''; }
  catch (e) { return ''; }
}

/* ---- this device's own requests (localStorage) ---- */
function myBookingIds() {
  try { const raw = localStorage.getItem(MY_BOOKINGS_KEY); return raw ? JSON.parse(raw) : []; }
  catch (e) { return []; }
}
function addMyBookingId(id) {
  const ids = myBookingIds();
  if (ids.indexOf(id) === -1) ids.push(id);
  try { localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify(ids)); } catch (e) { /* storage full/blocked */ }
}

/* ================= occupancy / capacity engine ================= */

/* The approved booking (if any) occupying `unitId` of `type` during
   [start,end) on `date`. `excludeId` lets a booking check against
   everyone ELSE (used when re-checking its own assignment). */
function unitOccupant(type, unitId, date, start, end, excludeId) {
  return bookingsForDate(date).find(b =>
    b.id !== excludeId && b.status === 'approved' &&
    assignmentsOf(b)[type] === unitId &&
    rangesOverlap(b.start, b.end, start, end)) || null;
}
function freeUnitsForType(type, date, start, end, excludeId) {
  return unitsForType(type).filter(u => !unitOccupant(type, u.id, date, start, end, excludeId));
}

/* How many approved+assigned bookings of `type` cover this one 30-min slot. */
function typeUsageCount(type, date, slotStart) {
  const slotEnd = hhmmOfMins(minsOfDay(slotStart) + 30);
  return bookingsForDate(date).filter(b =>
    b.status === 'approved' && needsOf(b)[type] && unitById(type, assignmentsOf(b)[type]) &&
    rangesOverlap(b.start, b.end, slotStart, slotEnd)).length;
}
function isSlotFull(type, date, slotStart) { return typeUsageCount(type, date, slotStart) >= CAPACITY[type]; }
function fullSlotsForType(type, date) { return allSlotStarts(date).filter(s => isSlotFull(type, date, s)); }

/* Merge consecutive 30-min slot starts into contiguous [start,end) stretches. */
function mergeIntoStretches(starts) {
  const sorted = starts.slice().sort((a, b) => minsOfDay(a) - minsOfDay(b));
  const out = [];
  sorted.forEach(s => {
    const last = out[out.length - 1];
    if (last && minsOfDay(last.end) === minsOfDay(s)) last.end = hhmmOfMins(minsOfDay(s) + 30);
    else out.push({ start: s, end: hhmmOfMins(minsOfDay(s) + 30) });
  });
  return out;
}

/* The derived waiting line for one resource type on one date: an array
   of { start, end, entries:[{booking,position}] } for each contested
   (full) stretch. Positions are 1-based and recomputed on every render
   so cancellations self-heal the queue automatically — nothing is stored. */
function waitingLineForType(type, date) {
  const stretches = mergeIntoStretches(fullSlotsForType(type, date));
  const pending = bookingsForDate(date).filter(b => b.status === 'pending' && needsOf(b)[type]);
  return stretches.map(st => {
    const entries = pending
      .filter(b => rangesOverlap(b.start, b.end, st.start, st.end))
      .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt))
      .map((b, i) => ({ booking: b, position: i + 1 }));
    return { type: type, start: st.start, end: st.end, entries: entries };
  }).filter(st => st.entries.length);
}
function allWaitingLines(date) { return NEED_TYPES.map(nt => nt.id).reduce((acc, t) => acc.concat(waitingLineForType(t, date)), []); }

/* This booking's own line position (worst-case across everything it
   needs), or null if it isn't waiting behind a full stretch at all. */
function waitingPositionFor(booking, date) {
  let pos = null;
  neededTypesOf(booking).forEach(type => {
    waitingLineForType(type, date).forEach(st => {
      const hit = st.entries.find(e => e.booking.id === booking.id);
      if (hit) pos = pos === null ? hit.position : Math.max(pos, hit.position);
    });
  });
  return pos;
}
function ordinal(n) {
  if (n === 1) return '1st'; if (n === 2) return '2nd'; if (n === 3) return '3rd';
  return n + 'th';
}

/* ---- Sign-up blocking: full + at least 3 pending already in line ---- */
function isSlotBlockedForNeeds(neededTypes, date, slotStart, excludeId) {
  return neededTypes.some(type => {
    if (!isSlotFull(type, date, slotStart)) return false;
    const slotEnd = hhmmOfMins(minsOfDay(slotStart) + 30);
    const count = bookingsForDate(date).filter(b =>
      b.id !== excludeId && b.status === 'pending' && needsOf(b)[type] &&
      rangesOverlap(b.start, b.end, slotStart, slotEnd)).length;
    return count >= 3;
  });
}
/* Same check across a whole proposed range; returns a blocking reason
   (for the submit-time banner) or null. */
function blockingReasonForRange(neededTypes, date, start, end, excludeId) {
  const slots = allSlotStarts(date).filter(s => minsOfDay(s) >= minsOfDay(start) && minsOfDay(s) < minsOfDay(end));
  for (const type of neededTypes) {
    for (const s of slots) {
      if (!isSlotFull(type, date, s)) continue;
      const slotEnd = hhmmOfMins(minsOfDay(s) + 30);
      const count = bookingsForDate(date).filter(b =>
        b.id !== excludeId && b.status === 'pending' && needsOf(b)[type] &&
        rangesOverlap(b.start, b.end, s, slotEnd)).length;
      if (count >= 3) return { type: type, count: count };
    }
  }
  return null;
}

/* ================= admin assignment recommendation ================= */

function bookingPriority(b) {
  return ({ contact: 0, 'new-member': 1, group: 2, 'study-member': 2, meeting: 2, other: 3 }[b.purpose] ?? 3);
}

function recommendedUnit(type, booking, date) {
  const free = freeUnitsForType(type, date, booking.start, booking.end, booking.id);
  if (!free.length) return null;
  if (type === 'room') {
    if (booking.preferredRoom) {
      const pref = free.find(u => u.id === booking.preferredRoom);
      if (pref) return pref.id;
    }
    return free.slice().sort((a, b) => a.num - b.num)[0].id;
  }
  return free.slice().sort((a, b) => a.num - b.num)[0].id;
}

/* Builds the initial recommended assignment draft for a pending or
   re-approving booking. Whiteboards retain their visible podium pairing,
   but podiums are no longer separate inventory. */
function initialAssignmentFor(booking, date) {
  const need = needsOf(booking);
  const assign = { room: null, whiteboard: null, tv: null };
  if (need.room) assign.room = recommendedUnit('room', booking, date);
  if (need.tv) assign.tv = recommendedUnit('tv', booking, date);
  if (need.whiteboard) assign.whiteboard = recommendedUnit('whiteboard', booking, date);
  return assign;
}

/* "Tip: Elena is Confirmed, Daniel is Tentative" — shown when this
   booking is contending with another pending room request for what
   would be the very last free room in their shared time range. */
function certaintyHint(booking, date) {
  if (!needsOf(booking).room) return null;
  const free = freeUnitsForType('room', date, booking.start, booking.end, booking.id);
  if (free.length > 1) return null;
  const contender = bookingsForDate(date).find(b =>
    b.id !== booking.id && b.status === 'pending' && needsOf(b).room &&
    rangesOverlap(b.start, b.end, booking.start, booking.end) && b.certainty !== booking.certainty);
  if (!contender) return null;
  const confirmedOne = booking.certainty === 'confirmed' ? booking : (contender.certainty === 'confirmed' ? contender : null);
  const tentativeOne = booking.certainty === 'tentative' ? booking : (contender.certainty === 'tentative' ? contender : null);
  if (!confirmedOne || !tentativeOne) return null;
  return 'Tip: ' + confirmedOne.name + ' is Confirmed, ' + tentativeOne.name + ' is Tentative.';
}

/* ================= persistence ================= */

function loadLocal() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveLocal() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify({ bookings: state.bookings }));
  } catch (e) { /* storage full/blocked — realtime copy still lives in Firestore */ }
}

function friendlyFirebaseError(error) {
  const code = String(error && error.code || '').replace(/^functions\//, '');
  if (code === 'unauthenticated') return 'The secure connection expired. Reload the app and try again.';
  if (code === 'permission-denied') return error.message || 'That action is not allowed.';
  if (code === 'resource-exhausted') return error.message || 'Please wait a few minutes and try again.';
  if (code === 'already-exists' || code === 'failed-precondition' || code === 'invalid-argument') return error.message || 'Please review the booking and try again.';
  return 'The change could not be saved. Check the connection and try again.';
}

async function callBackend(name, data) {
  if (!fb || !fb.callables[name]) throw new Error('The secure connection is not ready yet.');
  const result = await fb.callables[name](data || {});
  return result.data;
}

async function adminCall(name, data) {
  return callBackend(name, Object.assign({ sessionToken: adminSessionToken() }, data || {}));
}

/* ================= firebase ================= */

function setSyncPill(on, label) {
  const el = document.getElementById('sync-pill');
  if (!el) return;
  el.textContent = label || (on ? 'Live' : 'local');
  el.className = 'sync-pill' + (on ? '' : ' off');
}

async function initFirebase(config) {
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const fnMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const app = appMod.initializeApp(config);

  const auth = authMod.getAuth(app);
  if (!auth.currentUser) await authMod.signInAnonymously(auth);

  const db = fsMod.getFirestore(app);
  const functions = fnMod.getFunctions(app, 'us-west1');
  fb = {
    db, auth,
    doc: fsMod.doc,
    setDoc: fsMod.setDoc,
    updateDoc: fsMod.updateDoc,
    serverTimestamp: fsMod.serverTimestamp,
    Timestamp: fsMod.Timestamp,
    collection: fsMod.collection,
    callables: {
      adminStartSession: fnMod.httpsCallable(functions, 'adminStartSession'),
      adminEndSession: fnMod.httpsCallable(functions, 'adminEndSession'),
      adminBookingAction: fnMod.httpsCallable(functions, 'adminBookingAction'),
      adminNoteAction: fnMod.httpsCallable(functions, 'adminNoteAction'),
      adminMigrateNotes: fnMod.httpsCallable(functions, 'adminMigrateNotes'),
      memberSubmitBooking: fnMod.httpsCallable(functions, 'memberSubmitBooking'),
      memberSetPrivateNote: fnMod.httpsCallable(functions, 'memberSetPrivateNote')
    }
  };
  const bookingQuery = fsMod.query(
    fsMod.collection(db, 'bookings'),
    fsMod.where('date', 'in', upcomingBookingDates())
  );
  fsMod.onSnapshot(bookingQuery, { includeMetadataChanges: true }, snap => {
    // A cache-only empty snapshot (no server contact yet) must not wipe the
    // device's saved bookings — wait for a real server answer.
    if (snap.metadata.fromCache && snap.empty) return;
    const previousStatuses = {};
    myBookingIds().forEach(id => { if (state.bookings[id]) previousStatuses[id] = state.bookings[id].status; });
    state.bookings = {};
    snap.docs.forEach(d => { state.bookings[d.id] = d.data(); });
    // Tell this device's owner (visibly and via the aria-live banner region)
    // when the approver decides one of their pending requests.
    myBookingIds().forEach(id => {
      const now = state.bookings[id] && state.bookings[id].status;
      if (previousStatuses[id] !== 'pending' || !now || now === 'pending') return;
      if (now === 'approved') addBanner('Your reservation was approved. See My reservations for details.');
      else if (now === 'declined') addBanner('Your reservation request was declined. See My reservations.', true);
    });
    saveLocal(); render();
    setSyncPill(!snap.metadata.fromCache, snap.metadata.fromCache ? 'Reconnecting' : 'Live');
  }, err => {
    addBanner('Could not connect to the shared database (' + esc(err.code || 'error') + '). Showing this device’s copy.', true);
    setSyncPill(false, 'Reconnecting');
  });
  setSyncPill(false, 'Connecting');
}

/* ================= banners ================= */

function addBanner(html, isError) {
  const box = document.getElementById('banners');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'banner' + (isError ? ' error' : '');
  div.innerHTML = html;
  box.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

/* ================= render ================= */

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // Firestore can update while someone is typing in the popup. Pull the
  // current inputs into the draft before rebuilding the calendar so those
  // live updates never erase unsaved member details.
  const activeBeforeRender = document.activeElement;
  const popupFocus = ui.signup && activeBeforeRender && activeBeforeRender.closest('.booking-dialog')
    ? { id: activeBeforeRender.id || '', act: activeBeforeRender.dataset.act || '', item: activeBeforeRender.dataset.id || '' }
    : null;
  syncSignupDraft();
  document.body.classList.toggle('modal-open', !!ui.signup);

  const date = selectedDate();

  const tabs = document.getElementById('tabs');
  if (tabs) {
    tabs.innerHTML = TABS.map(t =>
      '<button class="tab' + (ui.tab === t.id ? ' active' : '') + '" role="tab" aria-selected="' + (ui.tab === t.id ? 'true' : 'false') + '" aria-controls="app" data-act="tab" data-id="' + t.id + '">' + esc(t.label) + '</button>'
    ).join('');
  }

  if (ui.tab === 'admin') app.innerHTML = renderAdmin();
  else if (ui.tab === 'mine') app.innerHTML = renderMyReservations();
  else app.innerHTML = renderSchedule();

  if (ui.signup) {
    requestAnimationFrame(() => {
      const modal = document.querySelector('.booking-dialog');
      const active = document.activeElement;
      if (modal && (!active || !modal.contains(active))) {
        let target = popupFocus && popupFocus.id ? document.getElementById(popupFocus.id) : null;
        if (!target && popupFocus && popupFocus.act) {
          target = Array.from(modal.querySelectorAll('[data-act]')).find(node =>
            node.dataset.act === popupFocus.act && (node.dataset.id || '') === popupFocus.item);
        }
        if (!target) target = document.getElementById('su-name') || modal.querySelector('button, select, input');
        if (target) target.focus();
      }
    });
  }
}

function dateSelectorHtml() {
  return '<div class="date-selector" role="group" aria-label="Choose reservation date">' +
    upcomingBookingDates().map(date => {
      const selected = date === selectedDate();
      const dayClass = isTuesday(date) ? ' tuesday' : ' saturday';
      return '<button type="button" class="date-choice' + dayClass + (selected ? ' active' : '') + '" data-act="select-date" data-id="' + date + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
        '<span class="date-choice-day">' + (isTuesday(date) ? 'Tuesday' : 'Saturday') + '</span>' +
        '<span class="date-choice-date">' + esc(fmtHeaderDate(date)) + '</span></button>';
    }).join('') + '</div>';
}

/* ---- Reservations tab ---- */

function renderSchedule() {
  const date = selectedDate();
  let html = '<section class="member-booking">' +
    (demoMode() ? '<div class="demo-notice">Sample preview — no changes here affect the real schedule.</div>' : '') +
    myApprovalHtml(date) +
    '<div class="member-calendars"><div class="calendar-date-wrap">' + dateSelectorHtml() + '</div>' +
    memberResourceToggleHtml(ui.memberType, 'member-type') +
    '<p class="calendar-help">Tap a time to reserve 30 minutes. Tap a later time in the same calendar to make your reservation longer.</p>' +
    memberCalendarHtml(date, ui.memberType, true, 'member') +
    '</div></section>';
  if (ui.signup) html += bookingModalHtml();
  return html;
}

function memberResourceToggleHtml(type, action) {
  const currentType = type;
  const actionName = action;
  return '<div class="member-resource-toggle" role="group" aria-label="Choose reservation type">' + NEED_TYPES.map(type =>
    '<button type="button" class="member-resource' + (currentType === type.id ? ' active' : '') + '" data-act="' + esc(actionName) + '" data-id="' + esc(type.id) + '" aria-pressed="' + (currentType === type.id ? 'true' : 'false') + '">' + esc(type.label) + '</button>'
  ).join('') + '</div>';
}

function memberSlotStatus(type, date, start, unitId) {
  const end = hhmmOfMins(minsOfDay(start) + 30);
  const approved = unitOccupant(type, unitId, date, start, end, null);
  if (approved) return myBookingIds().indexOf(approved.id) !== -1 ? 'mine' : 'taken';
  const freeUnits = unitsForType(type).filter(unit => !unitOccupant(type, unit.id, date, start, end, null));
  const freePosition = freeUnits.findIndex(unit => unit.id === unitId);
  const pendingCount = bookingsForDate(date).filter(b => b.status === 'pending' && needsOf(b)[type] && rangesOverlap(b.start, b.end, start, end)).length;
  if (freePosition >= 0 && freePosition < pendingCount) return 'pending';
  const cancelled = bookingsForDate(date).some(b => b.status === 'cancelled' && needsOf(b)[type] && (assignmentsOf(b)[type] === unitId || (b.lastAssignments || {})[type] === unitId) && rangesOverlap(b.start, b.end, start, end));
  return cancelled ? 'cancelled' : 'open';
}

function resourceLabelFor(b) {
  const type = neededTypesOf(b)[0];
  const id = assignmentsOf(b)[type] || (b.lastAssignments || {})[type];
  return id ? unitLabel(type, id) : needLabel(type);
}

function activityFeedHtml(date) {
  const events = bookingsForDate(date).filter(b => ['pending', 'approved', 'cancelled'].includes(b.status)).map(b => {
    const status = b.status === 'approved' ? 'Reserved' : b.status === 'cancelled' ? 'Cancelled' : 'Requested';
    const when = b.status === 'approved' ? (b.decidedAt || b.updatedAt || b.createdAt) : (b.updatedAt || b.createdAt);
    return { b, status, when: timestampMillis(when) };
  }).sort((a, b) => b.when - a.when).slice(0, 6);
  if (!events.length) return '<section class="activity-feed"><div class="activity-title">Schedule updates</div><p>No updates yet.</p></section>';
  return '<section class="activity-feed"><div class="activity-title">Schedule updates</div><div class="activity-table"><div class="activity-row activity-head"><span>Update</span><span>Member</span><span>Purpose</span><span>Start</span><span>End</span></div>' + events.map(event =>
    '<div class="activity-row ' + esc(event.b.status) + '"><span><strong>' + esc(event.status + ' ' + resourceLabelFor(event.b)) + '</strong></span><span>' + esc(event.b.name) + '</span><span>' + esc(bookingPurposeText(event.b)) + '</span><span>' + esc(fmtTime(event.b.start)) + '</span><span>' + esc(fmtTime(event.b.end)) + '</span></div>'
  ).join('') + '</div></section>';
}

function memberCalendarHtml(date, type, selectable, context) {
  const units = unitsForType(type);
  const selected = ui.memberSelection;
  let html = '<section class="member-calendar" aria-label="' + esc(needLabel(type)) + ' schedule">' +
    '<div class="member-calendar-heading"><h2>' + esc(needLabel(type)) + ' schedule</h2><span>' + units.length + ' available</span></div>' +
    (context === 'admin' ? '<div class="calendar-date-wrap">' + dateSelectorHtml() + '</div>' + memberResourceToggleHtml(type, 'admin-type') : '') +
    '<div class="member-calendar-scroll"><div class="member-calendar-grid">';
  html += '<div class="member-calendar-row unit-header"><div class="member-time"><small>Select a time</small><span>Time</span></div><div class="member-squares" style="--capacity:' + units.length + '">' + units.map(unit => '<span>' + esc(String(unit.num)) + '</span>').join('') + '</div></div>';
  scheduleSegments(date).forEach(window => {
    if (window.service) {
      html += '<div class="member-service"><span>' + esc(window.label) + '</span><span>' + esc(fmtTime(window.start)) + '–' + esc(fmtTime(window.end)) + '</span></div>';
      return;
    }
    const windowIdx = windowIndexFor(date, window.start);
    slotStarts(window).forEach(start => {
      const selectedHere = selected && selected.date === date && selected.type === type && selected.windowIdx === windowIdx && minsOfDay(start) >= minsOfDay(selected.start) && minsOfDay(start) < minsOfDay(selected.end);
      const end = hhmmOfMins(minsOfDay(start) + 30);
      const hasOpenUnit = freeUnitsForType(type, date, start, end, null).length > 0;
      html += '<div class="member-calendar-row"><' + (selectable && hasOpenUnit ? 'button type="button" data-act="member-slot" data-date="' + esc(date) + '" data-type="' + esc(type) + '" data-win="' + windowIdx + '" data-id="' + esc(start) + '" class="member-time selectable' + (selectedHere ? ' selected' : '') + '"' : 'div class="member-time"') + '>' + esc(fmtTime(start)) + '</' + (selectable && hasOpenUnit ? 'button' : 'div') + '><div class="member-squares" style="--capacity:' + units.length + '">' + units.map(unit => {
        const status = memberSlotStatus(type, date, start, unit.id);
        const occupant = unitOccupant(type, unit.id, date, start, end, null);
        const before = occupant && unitOccupant(type, unit.id, date, hhmmOfMins(minsOfDay(start) - 30), start, null)?.id === occupant.id;
        const after = occupant && unitOccupant(type, unit.id, date, end, hhmmOfMins(minsOfDay(end) + 30), null)?.id === occupant.id;
        const segment = occupant ? (!before && after ? ' booking-start' : before && after ? ' booking-middle' : before ? ' booking-end' : ' booking-only') : '';
        const label = occupant && !before ? occupant.name + ' · ' + bookingPurposeText(occupant) : '';
        return '<div class="member-square ' + status + segment + (selectedHere ? ' selected' : '') + '" aria-label="' + esc(fmtTime(start) + ', ' + unit.label + ', ' + status) + '">' + esc(label) + '</div>';
      }).join('') + '</div></div>';
    });
  });
  html += '</div></div>';
  if (selected && selected.type === type) html += '<div class="member-selection-summary"><span><strong>' + esc(fmtTime(selected.start)) + '–' + esc(fmtTime(selected.end)) + '</strong> · ' + esc(needLabel(type)) + '</span><button type="button" class="btn primary" data-act="member-continue" data-focus-key="member-continue">Continue</button></div>';
  return html + '</section>';
}

function myApprovalHtml(date) {
  const approved = myBookingIds().map(bookingByIdSafe).filter(b => b && b.status === 'approved' && b.date === date);
  if (!approved.length) return '';
  return '<div class="approval-notice"><strong>You’re approved.</strong> ' + approved.map(b => {
    const type = neededTypesOf(b)[0];
    const unit = type && assignmentsOf(b)[type] ? unitLabel(type, assignmentsOf(b)[type]) : needLabel(type);
    return esc(unit + ' · ' + fmtTime(b.start) + '–' + fmtTime(b.end));
  }).join(' · ') + '</div>';
}

function renderMyRequests(date) {
  const items = myBookingIds()
    .map(id => bookingByIdSafe(id))
    .filter(b => b && b.date === date)
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  if (!items.length) return '';

  let html = '<div class="card"><h2>My requests</h2>';
  items.forEach(b => { html += myRequestRowHtml(b, date); });
  html += '</div>';
  return html;
}

function renderMyReservations() {
  const items = myBookingIds().map(bookingByIdSafe).filter(Boolean)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  // No date selector here on purpose: this list always shows every upcoming
  // reservation from this device, so a day filter would only mislead.
  let html = '<section class="member-booking"><div class="member-intro"><h1>My reservations</h1><p>Check the status of reservations made from this device.</p></div></section>';
  html += '<div class="card"><h2>Your requests</h2>';
  if (!items.length) html += '<p class="hint">No reservations have been made from this device yet.</p>';
  else items.forEach(b => { html += myRequestRowHtml(b, b.date); });
  return html + '</div>' + activityFeedHtml(selectedDate());
}

function myRequestStatusHtml(b, date) {
  if (b.status === 'cancelled') return '<span class="badge status-cancelled">Cancelled</span>';
  if (b.status === 'declined') return '<span class="badge status-declined">Declined</span>';
  if (b.status === 'pending') {
    const pos = waitingPositionFor(b, date);
    if (pos !== null) return '<span class="badge status-waiting">In line — ' + ordinal(pos) + '</span>';
    return '<span class="badge status-pending">Pending review</span>';
  }
  // approved
  const a = assignmentsOf(b);
  const parts = neededTypesOf(b).map(t => a[t] ? unitLabel(t, a[t]) : null).filter(Boolean);
  return '<span class="badge status-approved">Approved' + (parts.length ? ' — ' + esc(parts.join(', ')) : '') + '</span>';
}

function myRequestRowHtml(b, date) {
  const active = b.status === 'pending' || b.status === 'approved';
  return '<div class="req-row">' +
    '<div class="req-head">' + esc(needsSummary(b)) + ' ' + myRequestStatusHtml(b, date) + '</div>' +
    '<div class="req-sub">' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div>' +
    (active ? '<div class="req-actions"><a href="#" class="cancel-link" data-act="my-cancel" data-id="' + esc(b.id) + '">Plans changed? Cancel</a></div>' : '') +
    '</div>';
}

/* ================= calendar-first reservation popup ================= */

function ensureSignupDraft() {
  if (ui.signup) return;
  ui.signup = {
    name: localStorage.getItem(NAME_KEY) || '',
    needs: { room: false, whiteboard: false, tv: false },
    preferredRoom: null,
    start: null,
    end: null,
    windowIdx: null,
    purpose: 'contact',
    purposeOther: '',
    certainty: null,
    note: ''
  };
}

/* Text inputs aren't re-rendered on every keystroke (that would drop focus),
   so before any change that triggers a full render(), pull their live DOM
   values back into the draft or they'd be lost. */
function syncSignupDraft() {
  const d = ui.signup;
  if (!d) return;
  const name = document.getElementById('su-name');
  const note = document.getElementById('su-note');
  const other = document.getElementById('su-other');
  if (name) d.name = name.value;
  if (note) d.note = note.value;
  if (other) d.purposeOther = other.value;
}

function signupComparable(d) {
  if (!d) return '';
  return JSON.stringify({
    name: d.name || '', needs: d.needs, preferredRoom: d.preferredRoom || null,
    start: d.start, end: d.end, windowIdx: d.windowIdx,
    purpose: d.purpose, purposeOther: d.purposeOther || '', certainty: d.certainty,
    note: d.note || ''
  });
}

function selectMemberSlot(el) {
  const date = el.dataset.date;
  const type = el.dataset.type;
  const windowIdx = +el.dataset.win;
  if (!date || !NEED_TYPES.some(need => need.id === type) || !isValidBookingRange(date, el.dataset.id, hhmmOfMins(minsOfDay(el.dataset.id) + 30))) return;
  // Work on a copy: if the tapped range turns out to be invalid we bail out
  // below, and the saved selection must stay untouched in that case.
  const selection = ui.memberSelection && ui.memberSelection.date === date && ui.memberSelection.type === type
    ? { ...ui.memberSelection }
    : { date, type, start: null, end: null, windowIdx: null };
  tapSlot(selection, windowIdx, el.dataset.id);
  const selectedSlots = allSlotStarts(date).filter(start => minsOfDay(start) >= minsOfDay(selection.start) && minsOfDay(start) < minsOfDay(selection.end));
  const containsFullTime = selectedSlots.some(start => freeUnitsForType(type, date, start, hhmmOfMins(minsOfDay(start) + 30), null).length === 0);
  if (containsFullTime) {
    addBanner('Part of that time is already full. Please choose an available range.', true);
    return;
  }
  ui.memberSelection = selection;
  render();
}

function openMemberDetails() {
  const selected = ui.memberSelection;
  if (!selected || !isValidBookingRange(selected.date, selected.start, selected.end)) return;
  ui.selectedDate = selected.date;
  ui.returnFocusKey = 'member-continue';
  ui.signup = {
    name: localStorage.getItem(NAME_KEY) || '',
    resourceType: selected.type,
    start: selected.start,
    end: selected.end,
    purpose: 'contact',
    purposeOther: ''
  };
  ui.signupBaseline = signupComparable(ui.signup);
  render();
}

function closeBookingModal(force) {
  if (!ui.signup) return;
  syncSignupDraft();
  const dirty = signupComparable(ui.signup) !== ui.signupBaseline;
  if (!force && dirty && !confirm('Discard the information entered for this request?')) return;
  const key = ui.returnFocusKey;
  ui.signup = null;
  ui.signupBaseline = null;
  ui.returnFocusKey = null;
  render();
  requestAnimationFrame(() => {
    const target = key ? Array.from(document.querySelectorAll('[data-focus-key]')).find(node => node.dataset.focusKey === key) : null;
    if (target) target.focus();
  });
}

function currentNeedTypes(d) { return NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]); }

function needsCheckboxesHtml(d) {
  return '<div class="included-room">Study room included</div><div class="need-row equipment-row" role="group" aria-labelledby="su-needs-label">' +
    ['whiteboard', 'tv'].map(id => {
      const nt = NEED_TYPES.find(item => item.id === id);
      return '<button type="button" class="need-chip' + (d.needs[id] ? ' active' : '') + '" data-act="su-need" data-id="' + id + '" aria-pressed="' + (d.needs[id] ? 'true' : 'false') + '">' +
        (d.needs[id] ? '&#10003; ' : '') + esc(nt.label) + '</button>';
    }).join('') + '</div>';
}

function preferredRoomHtml(d) {
  if (!d.needs.room) return '';
  return '<div class="fld" id="su-pref-label">Preferred room (optional)</div><div class="need-row" role="group" aria-labelledby="su-pref-label">' +
    PREFERRED_ROOM_CHOICES.map(rid => {
      const label = rid === null ? 'No preference' : unitLabel('room', rid);
      const sel = d.preferredRoom === rid;
      return '<button type="button" class="pref-chip' + (sel ? ' active' : '') + '" data-act="su-pref" data-id="' + (rid === null ? '' : rid) + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
}

/* ---- time picker ---- */
function timePickerHtml(d, date) {
  const needTypes = currentNeedTypes(d);
  let html = '<div class="fld" id="su-time-label">Time — tap a start time for 30 minutes; tap a later time in the same section to make it longer</div>';
  bookingWindows(date).forEach((w, wi) => {
    const slots = slotStarts(w);
    html += '<div class="strip-wrap">' +
      '<div class="strip-window-label">' + esc(w.label) + ' · ' + esc(fmtTime(w.start)) + ' – ' + esc(fmtTime(w.end)) + '</div>' +
      '<div class="time-strip" role="group" aria-label="' + esc(w.label) + '">' + slots.map(s => {
        const blocked = needTypes.length ? isSlotBlockedForNeeds(needTypes, date, s, null) : false;
        const inStart = d.start === s;
        const endSlotStart = d.end ? hhmmOfMins(minsOfDay(d.end) - 30) : null;
        const inEnd = d.end !== null && endSlotStart === s;
        const inRange = d.start !== null && d.windowIdx === wi &&
          minsOfDay(s) >= minsOfDay(d.start) && (d.end === null ? s === d.start : minsOfDay(s) < minsOfDay(d.end));
        let cls = 'slot';
        if (blocked) cls += ' blocked';
        else if (inRange) { cls += ' sel'; if (inStart) cls += ' start'; if (inEnd) cls += ' end'; }
        return '<button type="button" class="' + cls + '" aria-label="' + esc(fmtTime(s)) + '" aria-pressed="' + (inRange ? 'true' : 'false') + '"' + (blocked ? ' disabled' : ' data-act="su-slot" data-win="' + wi + '" data-id="' + s + '"') + '>' + esc(fmtTimeTight(s)) + '</button>';
      }).join('') + '</div></div>';
  });
  if (d.start && d.end) {
    html += '<p class="selection-summary" aria-live="polite">Selected: ' + esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) + '</p>';
  }
  return html;
}

/* ---- "who already has / wants this" panel on the Sign Up form ----
   As soon as a member picks what they need (and, if they want, a time),
   show the approved bookings and pending requests for that same resource
   type — so they can see who else is asking before they submit. */
function signupExistingHtml(d, date) {
  const needTypes = currentNeedTypes(d);
  if (!needTypes.length) return '';
  const hasTime = !!(d.start && d.end);
  const rel = activeBookingsForDate(date).filter(b => {
    if (!needTypes.some(t => needsOf(b)[t])) return false;
    return hasTime ? rangesOverlap(b.start, b.end, d.start, d.end) : true;
  }).sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start) || timestampMillis(a.createdAt) - timestampMillis(b.createdAt));

  const scope = needTypes.map(needLabel).join(', ');
  const when = hasTime ? ' at ' + esc(fmtTime(d.start)) + '–' + esc(fmtTime(d.end)) : '';
  let html = '<div class="strip-wrap" style="margin-top:10px">' +
    '<div class="strip-window-label">Already reserved or requested — ' + esc(scope) + when + '</div>';
  if (!rel.length) {
    html += '<p class="hint" style="margin:0">No one else has asked for this yet' + (hasTime ? ' at this time' : '') + ' — you’d be first.</p>';
  } else {
    rel.forEach(b => {
      let who, status;
      if (b.purpose === 'blocked') {
        who = '<span class="mini-reserved">Reserved</span>';
        status = '<span class="badge status-approved">Held</span>';
      } else {
        const cert = b.certainty === 'confirmed' ? '<span class="badge-cert confirmed">&#10003;</span>' : '<span class="badge-cert tentative">&#9670;</span>';
        who = cert + ' ' + esc(b.name);
        status = b.status === 'approved'
          ? '<span class="badge status-approved">Approved</span>'
          : '<span class="badge status-pending">Requested</span>';
      }
      html += '<div class="mini-row"><span class="mini-detail">' + who + ' ' + status + '</span>' +
        '<span class="mini-time">' + esc(fmtTimeTight(b.start)) + '–' + esc(fmtTimeTight(b.end)) + '</span></div>';
    });
  }
  return html + '</div>';
}

function purposeChipsHtml(d) {
  return '<div class="need-row">' + PURPOSES.map(p =>
    '<button type="button" class="purpose-chip' + (d.purpose === p.id ? ' active' : '') + '" data-act="su-purpose" data-id="' + p.id + '" aria-pressed="' + (d.purpose === p.id ? 'true' : 'false') + '">' + esc(p.label) + '</button>'
  ).join('') + '</div>' +
  (d.purpose === 'other'
    ? '<label class="sr-only" for="su-other">Describe the purpose</label><input type="text" id="su-other" value="' + esc(d.purposeOther) + '" placeholder="Please describe" style="margin-top:8px" required>'
    : '');
}

function certaintyButtonsHtml(d) {
  return '<div class="certainty-row compact-certainty">' +
    '<button type="button" class="certainty-btn confirmed' + (d.certainty === 'confirmed' ? ' active' : '') + '" data-act="su-certainty" data-id="confirmed" aria-pressed="' + (d.certainty === 'confirmed' ? 'true' : 'false') + '">Confirmed</button>' +
    '<button type="button" class="certainty-btn tentative' + (d.certainty === 'tentative' ? ' active' : '') + '" data-act="su-certainty" data-id="tentative" aria-pressed="' + (d.certainty === 'tentative' ? 'true' : 'false') + '">Tentative</button>' +
    '</div>';
}

function endTimeOptionsHtml(d, date) {
  const w = bookingWindows(date)[d.windowIdx];
  if (!w || !d.start) return '';
  const options = [];
  for (let m = minsOfDay(d.start) + 30; m <= minsOfDay(w.end); m += 30) {
    const value = hhmmOfMins(m);
    options.push('<option value="' + value + '"' + (d.end === value ? ' selected' : '') + '>' + esc(fmtTime(value)) + '</option>');
  }
  return options.join('');
}

function bookingModalHtml() {
  const d = ui.signup;
  const date = selectedDate();

  return '<div class="modal-backdrop" role="presentation"><section class="booking-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-dialog-title" aria-describedby="booking-dialog-summary">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(date)) + '</div><h2 id="booking-dialog-title">Request this time</h2></div>' +
    '<button type="button" class="modal-close" data-act="su-close" aria-label="Close reservation popup">&times;</button></div>' +
    '<p class="booking-time-summary" id="booking-dialog-summary"><strong>' + esc(needLabel(d.resourceType)) + '</strong> · ' + esc(fmtTime(d.start)) + '–' + esc(fmtTime(d.end)) + '</p>' +
    '<p class="hint booking-approval-hint">' + (isTuesday(date)
      ? 'Tuesday reservations are confirmed right away while space is open.'
      : 'Saturday requests go to the approver first — check My reservations for the decision.') + '</p>' +
    '<form data-act="su-submit">' +
    '<label class="fld" for="su-name">Your name</label>' +
    '<input type="text" id="su-name" value="' + esc(d.name) + '" placeholder="Full name" autocomplete="name" required>' +
    '<div class="fld">Purpose</div>' + purposeChipsHtml(d) +

    '<div class="modal-actions"><button type="button" class="btn" data-act="su-close">Cancel</button>' +
    '<button class="btn primary" type="submit"' + (ui.submitting ? ' disabled' : '') + '>' +
    (ui.submitting ? 'Submitting…' : (isTuesday(date) ? 'Reserve now' : 'Send request')) + '</button></div>' +
    '</form></section></div>';
}

async function submitSignup(form) {
  if (ui.submitting) return; // double-submit guard
  syncSignupDraft();
  const d = ui.signup;
  const date = selectedDate();
  const name = (d.name || '').trim();
  const purposeOther = (d.purposeOther || '').trim();

  if (!name) { addBanner('Please enter your name.', true); return; }
  if (!d.start || !d.end) { addBanner('Please choose a start and end time.', true); return; }
  if (!isValidBookingRange(date, d.start, d.end)) { addBanner('That time is outside the available reservation periods. Please choose a new time.', true); return; }
  if (!d.purpose) { addBanner('Please choose a purpose.', true); return; }
  if (d.purpose === 'other' && !purposeOther) { addBanner('Please describe the purpose.', true); return; }
  if (!fb || !fb.auth.currentUser) {
    addBanner('The shared schedule is not connected yet. Wait for “Live,” then try again.', true);
    return;
  }

  ui.submitting = true;
  setSyncPill(false, 'Saving');
  const btn = form ? form.querySelector('button[type=submit]') : null;
  if (btn) btn.disabled = true; // belt & suspenders: dead until the re-render
  const id = uid();
  try {
    const result = await callBackend('memberSubmitBooking', {
      date: date,
      start: d.start,
      end: d.end,
      name: name,
      resourceType: d.resourceType,
      purpose: d.purpose,
      purposeOther: d.purpose === 'other' ? purposeOther : ''
    });
    addMyBookingId(result.bookingId || id);
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage full/blocked */ }
    ui.signup = null;
    ui.signupBaseline = null;
    ui.returnFocusKey = null;
    ui.memberSelection = null;
    addBanner(result.status === 'approved' ? 'You’re approved. Your reservation is now on the schedule.' : 'Request sent. Saturday reservations are reviewed before approval.');
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.submitting = false;
    render();
  }
}

/* ================= Admin tab ================= */

function renderAdmin() {
  if (!adminUnlocked()) return renderAdminLock();
  const date = selectedDate();
  loadAdminNotes(date);
  return renderAdminHeader() + activityFeedHtml(date) + renderAdminDayOverview(date) + renderAdminQueue(date) +
    renderAdminAddForm(date) + renderAdminHousekeeping();
}

/* ---- PIN gate ---- */

function renderAdminLock() {
  return '<div class="card">' +
    '<div class="lock-title">Admin is locked</div>' +
    '<p class="hint">Enter the admin PIN to approve or decline requests, review the day, and manage bookings.</p>' +
    '<form class="pin-row" style="margin-top:12px" data-act="admin-unlock">' +
    '<label class="sr-only" for="admin-pin-input">Admin PIN</label><input type="password" id="admin-pin-input" placeholder="PIN" autocomplete="off" inputmode="numeric" required>' +
    '<button class="btn primary" type="submit">Unlock</button></form>' +
    (ui.pinError ? '<p class="pin-error" role="alert">' + esc(ui.pinError) + '</p>' : '') +
    '</div>';
}

function renderAdminHeader() {
  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
    '<h2 style="margin:0">Admin</h2>' +
    '<button class="btn small danger" data-act="admin-lock">Lock admin</button>' +
    '</div>' +
    '<p class="section-note" style="margin-top:10px">Approve or decline requests, review the day, add bookings directly, and tidy up old records.</p>' +
    '</div>';
}

/* ---- 1. Pending requests queue ---- */

function pendingQueue(date) {
  return bookingsForDate(date)
    .filter(b => b.status === 'pending')
    .sort((a, b) => {
      const priority = bookingPriority(a) - bookingPriority(b);
      if (priority) return priority;
      return timestampMillis(a.createdAt) - timestampMillis(b.createdAt);
    });
}

function fmtDateTime(ms) {
  const value = timestampMillis(ms);
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' at ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderAdminQueue(date) {
  const items = pendingQueue(date);
  let html = '<div class="card"><h2>Pending requests</h2>';
  if (!items.length) return html + '<p class="hint">No pending requests right now.</p></div>';
  items.forEach(b => { html += pendingCardHtml(b, date); });
  return html + '</div>';
}

async function loadAdminNotes(date) {
  if (!adminUnlocked() || ui.adminNotesLoading || ui.adminNotesDate === date) return;
  ui.adminNotesLoading = true;
  const ids = bookingsForDate(date).map(b => b.id).slice(0, 50);
  try {
    const result = ids.length
      ? await adminCall('adminNoteAction', { action: 'get-many', bookingIds: ids })
      : { notes: [] };
    const notes = {};
    (result.notes || []).forEach(item => { notes[item.bookingId] = item.note || ''; });
    ui.adminNotes = notes;
    ui.adminNotesDate = date;
    render();
  } catch (error) {
    if (/expired|locked|permission/i.test(error.message || '')) sessionStorage.removeItem(ADMIN_KEY);
    addBanner(friendlyFirebaseError(error), true);
  } finally {
    ui.adminNotesLoading = false;
  }
}

/* Pill row for one resource type on a pending/re-approving booking. */
function assignPillRowHtml(booking, type, date, assign) {
  const free = freeUnitsForType(type, date, booking.start, booking.end, booking.id);
  const freeIds = free.map(u => u.id);
  const recommendedId = recommendedUnit(type, booking, date);
  return '<div class="assign-row"><span class="assign-type-label">' + esc(needLabel(type)) + '</span><div class="need-row">' +
    unitsForType(type).map(u => {
      const isFree = freeIds.indexOf(u.id) !== -1;
      const occupant = isFree ? null : unitOccupant(type, u.id, date, booking.start, booking.end, booking.id);
      const isSel = assign[type] === u.id;
      const star = (u.id === recommendedId) ? ' &#9733;' : '';
      const cls = 'unit-pill' + (isSel ? ' active' : '') + (!isFree ? ' disabled' : '');
      const title = occupant ? (' title="' + esc(occupant.name) + '"') : '';
      return '<button type="button" class="' + cls + '"' + title +
        ' aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
        (isFree ? ' data-act="admin-assign" data-booking="' + esc(booking.id) + '" data-type="' + type + '" data-id="' + u.id + '"' : ' disabled') + '>' +
        esc(u.label) + star + (occupant ? ' — ' + esc(occupant.name) : '') + '</button>';
    }).join('') + '</div></div>';
}

function assignmentUiHtml(booking, date) {
  // Build the draft on first render; also rebuild it if it's entirely empty
  // (drafted while everything was full) so a cancellation that just freed a
  // unit pre-selects the recommendation instead of waiting for a manual tap.
  if (!ui.adminAssign[booking.id] || neededTypesOf(booking).every(t => !ui.adminAssign[booking.id][t])) {
    ui.adminAssign[booking.id] = initialAssignmentFor(booking, date);
  }
  const assign = ui.adminAssign[booking.id];
  let html = '<div class="assign-ui">';
  neededTypesOf(booking).forEach(type => { html += assignPillRowHtml(booking, type, date, assign); });
  const ready = neededTypesOf(booking).every(t => !!assign[t]);
  html += '<div class="req-actions">' +
    '<button class="btn small ok" data-act="admin-approve" data-id="' + esc(booking.id) + '"' + (ready ? '' : ' disabled') + '>Approve</button>' +
    '<button class="btn small danger" data-act="admin-decline" data-id="' + esc(booking.id) + '">Decline</button>' +
    '</div></div>';
  return html;
}

function pendingCardHtml(b, date) {
  const certBadge = b.certainty === 'confirmed' ? '<span class="badge-cert confirmed">&#10003; Confirmed</span>' : '<span class="badge-cert tentative">&#9670; Tentative</span>';
  const pos = waitingPositionFor(b, date);
  const hint = certaintyHint(b, date);
  return '<div class="req-row">' +
    '<div class="req-head">' + esc(b.name) + ' ' + certBadge + (pos !== null ? '<span class="badge status-waiting">In line — ' + ordinal(pos) + '</span>' : '') + '</div>' +
    '<div class="req-sub">' + esc(needsSummary(b)) + ' · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + '</div>' +
    '<div class="req-sub">' + esc(bookingPurposeText(b)) + (b.preferredRoom ? ' · Preferred: ' + esc(unitLabel('room', b.preferredRoom)) : '') + '</div>' +
    (ui.adminNotes[b.id] ? '<div class="req-sub">Private note: ' + esc(ui.adminNotes[b.id]) + '</div>' : '') +
    '<div class="req-sub muted">Requested ' + esc(fmtDateTime(b.createdAt)) + '</div>' +
    (hint ? '<p class="conflict-note">' + esc(hint) + '</p>' : '') +
    assignmentUiHtml(b, date) +
    '</div>';
}

async function approveBooking(id) {
  const b = bookingByIdSafe(id);
  if (!b) return;
  const date = b.date;
  if (!isValidBookingRange(date, b.start, b.end)) {
    addBanner('This request overlaps a service or is outside the current reservation dates, so it cannot be approved.', true);
    return;
  }
  const assign = ui.adminAssign[id] || initialAssignmentFor(b, date);
  const need = neededTypesOf(b);
  // Re-check every needed type is still free at approve time.
  for (const type of need) {
    const unitId = assign[type];
    if (!unitId) { addBanner('Please pick a ' + needLabel(type).toLowerCase() + ' before approving.', true); return; }
    const occ = unitOccupant(type, unitId, date, b.start, b.end, b.id);
    if (occ) { addBanner(esc(unitLabel(type, unitId)) + ' was just taken by ' + esc(occ.name) + ' — pick another.', true); return; }
  }
  try {
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', {
      action: ui.adminReapproveId === id ? 'reapprove' : 'approve',
      bookingId: id,
      assignments: { room: assign.room || null, whiteboard: assign.whiteboard || null, tv: assign.tv || null }
    });
    delete ui.adminAssign[id];
    if (ui.adminReapproveId === id) ui.adminReapproveId = null;
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  }
}
async function declineBooking(id) {
  const b = state.bookings[id];
  if (!b) return;
  try {
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', { action: 'decline', bookingId: id });
    delete ui.adminAssign[id];
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  }
}

/* ---- 2. Day overview ---- */

function renderAdminDayOverview(date) {
  let html = '<div class="card"><h2>Day overview</h2>' +
    '<p class="section-note">Select a resource to see the same unit-by-unit calendar members see. Each approved unit shows the member and purpose.</p>' +
    memberCalendarHtml(date, ui.adminType, false, 'admin') +
    '</div>';
  html += renderAdminDayList(date);
  return html;
}

function renderAdminDayList(date) {
  const items = bookingsForDate(date).sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start));
  let html = '<div class="card"><h2>Bookings for ' + esc(fmtDate(date)) + '</h2>';
  if (!items.length) return html + '<p class="hint">No bookings for this date.</p></div>';
  items.forEach(b => { html += adminDayRowHtml(b, date); });
  return html + '</div>';
}

function adminDayRowHtml(b, date) {
  if (ui.adminReapproveId === b.id) {
    return '<div class="req-row">' +
      '<div class="req-head">' + esc(b.name) + ' <span class="badge status-' + esc(b.status) + '">' + esc(STATUS_LABEL[b.status] || b.status) + '</span></div>' +
      '<div class="req-sub">' + esc(needsSummary(b)) + ' · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div>' +
      assignmentUiHtml(b, date) +
      '<div class="req-actions"><button class="btn small" data-act="admin-reapprove-cancel">Cancel</button></div>' +
      '</div>';
  }
  let actions = '';
  if (b.status === 'pending') {
    actions = '<button class="btn small ok" data-act="admin-approve" data-id="' + esc(b.id) + '">Approve</button>' +
      '<button class="btn small danger" data-act="admin-decline" data-id="' + esc(b.id) + '">Decline</button>';
  } else if (b.status === 'approved') {
    actions = '<button class="btn small danger" data-act="admin-cancel" data-id="' + esc(b.id) + '">Cancel</button>';
  } else if (b.status === 'declined' || b.status === 'cancelled') {
    actions = '<button class="btn small ok" data-act="admin-reapprove-start" data-id="' + esc(b.id) + '">Re-approve</button>';
  }
  const assignSummary = b.status === 'approved'
    ? neededTypesOf(b).map(t => assignmentsOf(b)[t] ? unitLabel(t, assignmentsOf(b)[t]) : null).filter(Boolean).join(', ')
    : '';
  return '<div class="req-row">' +
    '<div class="req-head">' + esc(b.name) + ' <span class="badge status-' + esc(b.status) + '">' + esc(STATUS_LABEL[b.status] || b.status) + '</span></div>' +
    '<div class="req-sub">' + esc(needsSummary(b)) + (assignSummary ? ' — ' + esc(assignSummary) : '') + ' · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div>' +
    (actions ? '<div class="req-actions">' + actions + '</div>' : '') +
    '</div>';
}

async function cancelBooking(id) {
  const b = state.bookings[id];
  if (!b) return;
  if (!confirm('Cancel the approved booking for ' + b.name + '?')) return;
  try {
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', { action: 'cancel', bookingId: id });
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  }
}

/* ---- 3. Add a booking directly ---- */

function ensureAdminFormDraft(date) {
  if (ui.adminForm && ui.adminForm.date === date) return;
  ui.adminForm = {
    date: date,
    name: '',
    needs: { room: false, whiteboard: false, tv: false },
    preferredRoom: null,
    start: null,
    end: null,
    windowIdx: null,
    purpose: 'contact',
    purposeOther: '',
    certainty: 'confirmed',
    note: '',
    assign: { room: null, whiteboard: null, tv: null }
  };
}

/* Same reasoning as syncSignupDraft(): text inputs skip re-render on every
   keystroke, so pull their live values back before any render()-triggering change. */
function syncAdminFormDraft() {
  const d = ui.adminForm;
  if (!d) return;
  const name = document.getElementById('af-name');
  const note = document.getElementById('af-note');
  const other = document.getElementById('af-other');
  if (name) d.name = name.value;
  if (note) d.note = note.value;
  if (other) d.purposeOther = other.value;
}

function afNeedsCheckboxesHtml(d) {
  return '<div class="need-row" role="group" aria-labelledby="af-needs-label">' + NEED_TYPES.map(nt =>
    '<button type="button" class="need-chip' + (d.needs[nt.id] ? ' active' : '') + '" data-act="af-need" data-id="' + nt.id + '" aria-pressed="' + (d.needs[nt.id] ? 'true' : 'false') + '">' +
    (d.needs[nt.id] ? '&#10003; ' : '') + esc(nt.label) + '</button>'
  ).join('') + '</div>';
}
function afPreferredRoomHtml(d) {
  if (!d.needs.room) return '';
  return '<div class="fld" id="af-pref-label">Preferred room (optional)</div><div class="need-row" role="group" aria-labelledby="af-pref-label">' +
    PREFERRED_ROOM_CHOICES.map(rid => {
      const label = rid === null ? 'No preference' : unitLabel('room', rid);
      const sel = d.preferredRoom === rid;
      return '<button type="button" class="pref-chip' + (sel ? ' active' : '') + '" data-act="af-pref" data-id="' + (rid === null ? '' : rid) + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
}
function afTimePickerHtml(d) {
  let html = '<div class="fld">Time</div>';
  bookingWindows(d.date).forEach((w, wi) => {
    const slots = slotStarts(w);
    html += '<div class="strip-wrap">' +
      '<div class="strip-window-label">' + esc(w.label) + ' · ' + esc(fmtTime(w.start)) + ' – ' + esc(fmtTime(w.end)) + '</div>' +
      '<div class="time-strip" role="group" aria-label="' + esc(w.label) + '">' + slots.map(s => {
        const inStart = d.start === s;
        const endSlotStart = d.end ? hhmmOfMins(minsOfDay(d.end) - 30) : null;
        const inEnd = d.end !== null && endSlotStart === s;
        const inRange = d.start !== null && d.windowIdx === wi &&
          minsOfDay(s) >= minsOfDay(d.start) && (d.end === null ? s === d.start : minsOfDay(s) < minsOfDay(d.end));
        let cls = 'slot';
        if (inRange) { cls += ' sel'; if (inStart) cls += ' start'; if (inEnd) cls += ' end'; }
        return '<button type="button" class="' + cls + '" data-act="af-slot" data-win="' + wi + '" data-id="' + s + '" aria-label="' + esc(fmtTime(s)) + '" aria-pressed="' + (inRange ? 'true' : 'false') + '">' + esc(fmtTimeTight(s)) + '</button>';
      }).join('') + '</div></div>';
  });
  if (d.start && d.end) html += '<p class="selection-summary" aria-live="polite">Selected: ' + esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) + '</p>';
  return html;
}
function afAssignPillRowHtml(d, type) {
  if (!d.start || !d.end) return '';
  const fakeBooking = { id: '__new__', start: d.start, end: d.end, preferredRoom: d.preferredRoom };
  const free = freeUnitsForType(type, d.date, d.start, d.end, '__new__');
  const freeIds = free.map(u => u.id);
  return '<div class="assign-row"><span class="assign-type-label">' + esc(needLabel(type)) + '</span><div class="need-row">' +
    unitsForType(type).map(u => {
      const isFree = freeIds.indexOf(u.id) !== -1;
      const occupant = isFree ? null : unitOccupant(type, u.id, d.date, d.start, d.end, '__new__');
      const isSel = d.assign[type] === u.id;
      const cls = 'unit-pill' + (isSel ? ' active' : '') + (!isFree ? ' disabled' : '');
      return '<button type="button" class="' + cls + '"' +
        ' aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
        (isFree ? ' data-act="af-assign" data-type="' + type + '" data-id="' + u.id + '"' : ' disabled') + '>' +
        esc(u.label) + (occupant ? ' — ' + esc(occupant.name) : '') + '</button>';
    }).join('') + '</div></div>';
}
function afPurposeChipsHtml(d) {
  return '<div class="need-row">' + ADMIN_PURPOSES.map(p =>
    '<button type="button" class="purpose-chip' + (d.purpose === p.id ? ' active' : '') + '" data-act="af-purpose" data-id="' + p.id + '" aria-pressed="' + (d.purpose === p.id ? 'true' : 'false') + '">' + esc(p.label) + '</button>'
  ).join('') + '</div>' +
  (d.purpose === 'other'
    ? '<label class="sr-only" for="af-other">Describe the purpose</label><input type="text" id="af-other" value="' + esc(d.purposeOther) + '" placeholder="Please describe" style="margin-top:8px" required>'
    : '');
}
function afCertaintyButtonsHtml(d) {
  return '<div class="certainty-row">' +
    '<button type="button" class="certainty-btn confirmed' + (d.certainty === 'confirmed' ? ' active' : '') + '" data-act="af-certainty" data-id="confirmed" aria-pressed="' + (d.certainty === 'confirmed' ? 'true' : 'false') + '">Confirmed<br><small>They’ll be there</small></button>' +
    '<button type="button" class="certainty-btn tentative' + (d.certainty === 'tentative' ? ' active' : '') + '" data-act="af-certainty" data-id="tentative" aria-pressed="' + (d.certainty === 'tentative' ? 'true' : 'false') + '">Tentative<br><small>Still confirming</small></button>' +
    '</div>';
}

function renderAdminAddForm(date) {
  ensureAdminFormDraft(date);
  const d = ui.adminForm;
  const needTypes = NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]);

  return '<div class="card"><h2>Add a booking</h2>' +
    '<p class="section-note">Adds a booking that is approved immediately, including a room held for another use.</p>' +
    '<form data-act="admin-add-submit">' +

    '<label class="fld" for="af-name">Name</label>' +
    '<input type="text" id="af-name" value="' + esc(d.name) + '" placeholder="Full name" required>' +

    '<div class="fld" id="af-needs-label">What do they need?</div>' +
    afNeedsCheckboxesHtml(d) +
    afPreferredRoomHtml(d) +
    afTimePickerHtml(d) +

    (needTypes.length && d.start && d.end ? '<div class="fld">Assign</div>' + needTypes.map(t => afAssignPillRowHtml(d, t)).join('') : '') +

    '<div class="fld">Purpose</div>' +
    afPurposeChipsHtml(d) +

    '<div class="fld">How sure?</div>' +
    afCertaintyButtonsHtml(d) +

    '<label class="fld" for="af-note">Note (optional)</label>' +
    '<input type="text" id="af-note" value="' + esc(d.note) + '" placeholder="Anything worth noting">' +

    '<div style="margin-top:16px"><button class="btn primary big" type="submit">Add booking (approved)</button></div>' +
    '</form></div>';
}

async function submitAdminAdd() {
  syncAdminFormDraft();
  const d = ui.adminForm;
  const name = (d.name || '').trim();
  const note = (d.note || '').trim();
  const purposeOther = (d.purposeOther || '').trim();
  const needTypes = NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]);

  if (!name) { addBanner('Please enter a name.', true); return; }
  if (!needTypes.length) { addBanner('Please choose at least one thing needed.', true); return; }
  if (!d.start || !d.end) { addBanner('Please choose a start and end time.', true); return; }
  if (!isValidBookingRange(d.date, d.start, d.end)) { addBanner('That time is outside the available reservation periods. Please choose a new time.', true); return; }
  if (d.purpose === 'other' && !purposeOther) { addBanner('Please describe the purpose.', true); return; }
  for (const t of needTypes) {
    if (!d.assign[t]) { addBanner('Please assign a ' + needLabel(t).toLowerCase() + '.', true); return; }
    const occ = unitOccupant(t, d.assign[t], d.date, d.start, d.end, '__new__');
    if (occ) { addBanner(esc(unitLabel(t, d.assign[t])) + ' was just taken by ' + esc(occ.name) + ' — pick another.', true); return; }
  }

  try {
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', {
      action: 'direct-add',
      booking: {
        date: d.date, start: d.start, end: d.end, name: name,
        needs: { room: !!d.needs.room, whiteboard: !!d.needs.whiteboard, tv: !!d.needs.tv },
        preferredRoom: d.needs.room ? (d.preferredRoom || null) : null,
        purpose: d.purpose, purposeOther: d.purpose === 'other' ? purposeOther : '',
        certainty: d.certainty || 'confirmed', status: 'approved',
        assignments: { room: d.assign.room || null, whiteboard: d.assign.whiteboard || null, tv: d.assign.tv || null }
      },
      note: note
    });
    addBanner('Booking added and approved for ' + esc(name) + '.');
    ui.adminForm = null;
    ui.adminNotesDate = null;
    setSyncPill(true, 'Saved');
    render();
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  }
}

/* ---- 4. Housekeeping ---- */

function renderAdminHousekeeping() {
  return '<div class="card"><h2>Housekeeping</h2>' +
    '<p class="section-note">Removes bookings dated more than 8 weeks in the past, to keep the shared list tidy.</p>' +
    '<button class="btn danger" data-act="admin-cleanup">Remove old records</button>' +
    '</div>';
}

async function cancelMyBooking(id) {
  const b = bookingByIdSafe(id);
  if (!b || (b.status !== 'pending' && b.status !== 'approved')) return;
  if (!confirm('Cancel this request?')) return;
  if (!fb || !fb.auth.currentUser || b.ownerUid !== fb.auth.currentUser.uid) {
    addBanner('Only the device that made this new request can cancel it. Ask an Admin for help with an older request.', true);
    return;
  }
  try {
    setSyncPill(false, 'Saving');
    await fb.updateDoc(fb.doc(fb.db, 'bookings', id), { status: 'cancelled', updatedAt: fb.serverTimestamp() });
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  }
}

async function startAdminSession(pin) {
  ui.pinError = '';
  try {
    setSyncPill(false, 'Checking PIN');
    const result = await callBackend('adminStartSession', { pin: pin });
    sessionStorage.setItem(ADMIN_KEY, JSON.stringify({ token: result.sessionToken, expiresAt: result.expiresAt }));
    ui.adminNotesDate = null;
    setSyncPill(true, 'Admin unlocked');
    render();
    await runAdminMigrations();
  } catch (error) {
    ui.pinError = friendlyFirebaseError(error);
    setSyncPill(false, 'Locked');
    render();
    // The re-render replaced the form; put focus back on the PIN field so a
    // keyboard or screen-reader user can retry immediately.
    const pinInput = document.getElementById('admin-pin-input');
    if (pinInput) pinInput.focus();
  }
}

async function endAdminSession() {
  const token = adminSessionToken();
  sessionStorage.removeItem(ADMIN_KEY);
  ui.adminNotes = {};
  ui.adminNotesDate = null;
  render();
  if (token && fb) {
    try { await callBackend('adminEndSession', { sessionToken: token }); } catch (error) { /* already locked */ }
  }
}

async function runAdminMigrations() {
  try {
    let roomCursor = {};
    do {
      roomCursor = await adminCall('adminBookingAction', Object.assign({ action: 'retire-baptism-room' }, roomCursor.done === false ? {
        afterDate: roomCursor.afterDate,
        afterBookingId: roomCursor.afterBookingId
      } : {}));
    } while (!roomCursor.done);

    let noteCursor = {};
    do {
      const payload = noteCursor.done === false ? { afterBookingId: noteCursor.afterBookingId } : {};
      noteCursor = await adminCall('adminMigrateNotes', payload);
    } while (!noteCursor.done);
    ui.adminNotesDate = null;
  } catch (error) {
    addBanner('Admin opened, but older records could not be tidied automatically. ' + friendlyFirebaseError(error), true);
  }
}

async function cleanupOldRecords() {
  const cutoff = addDaysISO(todayISO(), -56);
  const count = bookingsList().filter(b => b.date < cutoff).length;
  if (!count) { addBanner('No records older than 8 weeks.'); return; }
  if (!confirm('Delete old booking records? This cannot be undone.')) return;
  try {
    let result;
    let removed = 0;
    do {
      result = await adminCall('adminBookingAction', { action: 'cleanup' });
      removed += result.removed || 0;
    } while (result.more);
    addBanner('Removed ' + removed + ' old booking' + (removed === 1 ? '' : 's') + '.');
  } catch (error) { addBanner(friendlyFirebaseError(error), true); }
}

/* ================= actions ================= */

function handleAction(act, el) {
  if (act === 'tab') { ui.tab = el.dataset.id; ui.pinError = ''; render(); return; }

  if (act === 'select-date') {
    const date = el.dataset.id;
    if (upcomingBookingDates().indexOf(date) === -1) return;
    syncSignupDraft();
    if (ui.signup) { ui.signup.start = null; ui.signup.end = null; ui.signup.windowIdx = null; }
    syncAdminFormDraft();
    ui.adminForm = null;
    ui.selectedDate = date;
    ui.memberSelection = null;
    render();
    return;
  }

  /* ---- Reservations tab ---- */
  if (act === 'member-type') {
    if (!NEED_TYPES.some(type => type.id === el.dataset.id)) return;
    ui.memberType = el.dataset.id;
    ui.memberSelection = null;
    render();
    return;
  }
  if (act === 'admin-type') {
    if (!NEED_TYPES.some(type => type.id === el.dataset.id)) return;
    ui.adminType = el.dataset.id;
    render();
    return;
  }
  if (act === 'member-slot') { selectMemberSlot(el); return; }
  if (act === 'member-continue') { openMemberDetails(); return; }
  if (act === 'su-close') { closeBookingModal(false); return; }
  if (act === 'my-cancel') {
    cancelMyBooking(el.dataset.id);
    return;
  }

  /* ---- Sign Up tab ---- */
  if (act === 'su-need') {
    syncSignupDraft(); ensureSignupDraft();
    const d = ui.signup;
    d.needs[el.dataset.id] = !d.needs[el.dataset.id];
    render();
    return;
  }
  if (act === 'su-pref') { syncSignupDraft(); ensureSignupDraft(); ui.signup.preferredRoom = el.dataset.id || null; render(); return; }
  if (act === 'su-slot') {
    syncSignupDraft(); ensureSignupDraft();
    tapSlot(ui.signup, +el.dataset.win, el.dataset.id);
    render();
    return;
  }
  if (act === 'su-purpose') { syncSignupDraft(); ensureSignupDraft(); ui.signup.purpose = el.dataset.id; render(); return; }
  if (act === 'su-certainty') { syncSignupDraft(); ensureSignupDraft(); ui.signup.certainty = el.dataset.id; render(); return; }
  if (act === 'su-submit') { submitSignup(el); return; }

  /* ---- Admin tab: PIN gate ---- */
  if (act === 'admin-unlock') {
    const val = document.getElementById('admin-pin-input').value;
    startAdminSession(val);
    return;
  }
  if (act === 'admin-lock') { endAdminSession(); return; }

  /* ---- Admin tab: pending queue + assignment + day overview ---- */
  if (act === 'admin-assign') {
    const bookingId = el.dataset.booking;
    const b = bookingByIdSafe(bookingId);
    if (!b) return;
    const type = el.dataset.type;
    const unitId = el.dataset.id;
    if (!ui.adminAssign[bookingId]) ui.adminAssign[bookingId] = initialAssignmentFor(b, b.date);
    const assign = ui.adminAssign[bookingId];
    assign[type] = unitId;
    render();
    return;
  }
  if (act === 'admin-approve') { approveBooking(el.dataset.id); return; }
  if (act === 'admin-decline') { declineBooking(el.dataset.id); return; }
  if (act === 'admin-cancel') { cancelBooking(el.dataset.id); return; }
  if (act === 'admin-reapprove-start') {
    const b = bookingByIdSafe(el.dataset.id);
    if (!b) return;
    ui.adminReapproveId = b.id;
    ui.adminAssign[b.id] = initialAssignmentFor(b, b.date);
    render();
    return;
  }
  if (act === 'admin-reapprove-cancel') { ui.adminReapproveId = null; render(); return; }

  /* ---- Admin tab: add a booking directly ---- */
  if (act === 'af-need') {
    syncAdminFormDraft(); ensureAdminFormDraft(selectedDate());
    const d = ui.adminForm;
    d.needs[el.dataset.id] = !d.needs[el.dataset.id];
    d.assign = { room: null, whiteboard: null, tv: null };
    if (!d.needs.room) d.preferredRoom = null;
    render();
    return;
  }
  if (act === 'af-pref') { syncAdminFormDraft(); ensureAdminFormDraft(selectedDate()); ui.adminForm.preferredRoom = el.dataset.id || null; render(); return; }
  if (act === 'af-slot') {
    syncAdminFormDraft(); ensureAdminFormDraft(selectedDate());
    tapSlot(ui.adminForm, +el.dataset.win, el.dataset.id);
    ui.adminForm.assign = { room: null, whiteboard: null, tv: null };
    render();
    return;
  }
  if (act === 'af-assign') {
    syncAdminFormDraft(); ensureAdminFormDraft(selectedDate());
    const d = ui.adminForm;
    const type = el.dataset.type, unitId = el.dataset.id;
    d.assign[type] = unitId;
    render();
    return;
  }
  if (act === 'af-purpose') { syncAdminFormDraft(); ensureAdminFormDraft(selectedDate()); ui.adminForm.purpose = el.dataset.id; render(); return; }
  if (act === 'af-certainty') { syncAdminFormDraft(); ensureAdminFormDraft(selectedDate()); ui.adminForm.certainty = el.dataset.id; render(); return; }
  if (act === 'admin-add-submit') { submitAdminAdd(); return; }

  /* ---- Admin tab: housekeeping ---- */
  if (act === 'admin-cleanup') {
    cleanupOldRecords();
    return;
  }
}

/* Shared tap-to-pick-a-range logic for both the Sign Up draft and the
   admin Add-a-booking draft: first tap sets the start, second tap (in
   the same window) sets the end (inclusive); tapping before the current
   start restarts the selection; a tap after a completed range starts a
   fresh one. */
/* Tapping a slot always leaves a complete [start,end) block selected — a
   single tap gives that one 30-min block (e.g. 2:00 -> 2:00–2:30). Tapping
   a later slot in the same block extends the end through it; tapping a new
   block (earlier slot, a different window, or after a multi-slot range was
   finished) starts a fresh single block. */
function tapSlot(draft, windowIdx, slotStart) {
  const slotEnd = hhmmOfMins(minsOfDay(slotStart) + 30);
  const haveSingle = draft.start !== null && draft.end !== null &&
    draft.windowIdx === windowIdx &&
    minsOfDay(draft.end) - minsOfDay(draft.start) === 30;
  if (!haveSingle) {
    // nothing yet, other window, or a finished multi-slot range -> new single block
    draft.start = slotStart; draft.end = slotEnd; draft.windowIdx = windowIdx;
  } else if (minsOfDay(slotStart) <= minsOfDay(draft.start)) {
    // earlier (or the same) slot -> move the single block there
    draft.start = slotStart; draft.end = slotEnd;
  } else {
    // later slot -> extend the block's end through it
    draft.end = slotEnd;
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  if (el.tagName === 'FORM') return; // forms fire via submit
  if (el.disabled) return;
  handleAction(el.dataset.act, el);
});
document.addEventListener('submit', e => {
  const el = e.target.closest('form[data-act]');
  if (!el) return;
  e.preventDefault();
  handleAction(el.dataset.act, el);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (!el || !ui.signup) return;
  if (el.dataset.chg === 'su-end') {
    syncSignupDraft();
    ui.signup.end = el.value;
    render();
  }
});
document.addEventListener('keydown', e => {
  if (!ui.signup) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeBookingModal(false);
    return;
  }
  if (e.key !== 'Tab') return;
  const modal = document.querySelector('.booking-dialog');
  if (!modal) return;
  const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ================= init ================= */

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (new URLSearchParams(location.search).get('tv') === '1') {
    location.replace('tv.html' + location.search + location.hash);
    return;
  }
  state = loadLocal() || { bookings: {} };
  saveLocal();
  render();

  // Keyboard support for the role=tablist tab bar (arrows, Home, End).
  const tabsEl = document.getElementById('tabs');
  if (tabsEl) {
    tabsEl.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const buttons = Array.from(tabsEl.querySelectorAll('.tab'));
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement);
      let next;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      else if (e.key === 'ArrowLeft') next = current <= 0 ? buttons.length - 1 : current - 1;
      else next = current < 0 || current === buttons.length - 1 ? 0 : current + 1;
      e.preventDefault();
      ui.tab = buttons[next].dataset.id;
      ui.pinError = '';
      render();
      // render() rebuilds the tab buttons, so focus the fresh one
      const fresh = tabsEl.querySelector('.tab[data-id="' + ui.tab + '"]');
      if (fresh) fresh.focus();
    });
  }

  const masthead = document.getElementById('masthead');
  const goHome = () => { ui.tab = 'schedule'; render(); };
  if (masthead) {
    masthead.addEventListener('click', goHome);
    masthead.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      goHome();
    });
  }

  if (window.FIREBASE_CONFIG) {
    initFirebase(window.FIREBASE_CONFIG).catch(err => {
      console.warn('firebase init failed', err);
      addBanner('Running on this device only — shared sync is unavailable.', true);
      setSyncPill(false);
    });
  } else {
    setSyncPill(false);
  }
}

init();
