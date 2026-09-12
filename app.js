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

/* Priority order, highest first. A Contact reservation outranks a New
   Member one, and both outrank Other. Only an Other reservation can be
   taken over, and only when nothing else is open (see overrideTarget). */
const PURPOSES = [
  { id: 'contact', label: 'Contact', rank: 1 },
  { id: 'new-member', label: 'New Member', rank: 2 },
  { id: 'other', label: 'Other', rank: 3 }
];
/* Purposes that may take a lower-priority reservation's place. */
const OVERRIDE_PURPOSES = ['contact', 'new-member'];
/* The only purpose that can be taken. Meeting was retired as a choice on
   11 September 2026; reservations already saved as Meeting, Group or Study
   member keep their label and are never override targets. */
const OVERRIDABLE_PURPOSE = 'other';
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
  { id: 'home', label: 'Home' },
  { id: 'mine', label: 'My reservations' },
  { id: 'admin', label: 'Admin' }
];

/* ================= state ================= */

let state = {
  bookings: {}    // id -> booking (see spec shape); may contain stale/invalid docs, always filter via bookingsList()
};
let ui = {
  tab: 'home',
  selectedDate: null,   // shared by Home selection and Admin
  homeDate: null,       // independent date in the member Home day overview
  homeOverviewType: 'room', // resource shown in the member Home day overview
  adminType: 'room',    // resource displayed in the matching Admin calendar
  adminSelectedId: null, // one pending request shown in the Admin detail pane
  memberSelection: null, // { date, type, start, end, windowIdx }
  endPrompt: null, // { date, type, start, windowIdx }; shown after choosing a start
  selectionConfirm: null, // { date, type, start, end }; confirmation popup after choosing an end
  availabilityDetails: null, // { date, type, start, end }; read-only availability sheet
  bookingDetails: null, // { id, date, type, start, unit }; public or owner reservation sheet
  endEarly: null,       // { id }; "finished early" sheet for one of this device's reservations
  availabilityConflict: null, // rejected range plus optional shorter ending
  pinError: '',
  submitting: false,
  signup: null,         // reservation-popup draft, created from a calendar cell
  signupBaseline: null, // serialized initial popup state, used for discard warnings
  returnFocusKey: null, // calendar-cell key to restore focus after the popup closes
  adminAssign: {},       // bookingId -> { room, whiteboard, tv } draft unit picks (pending or re-approve)
  adminReapproveId: null, // id of a declined/cancelled booking currently showing the assignment UI
  adminActionId: null,    // booking currently saving through a protected Admin action
  adminSubmitting: false, // prevents duplicate direct-add bookings
  adminForm: null,       // Admin "Add a booking" form draft, created lazily by ensureAdminFormDraft()
  adminNotes: {},
  adminNotesDate: null,
  adminNotesLoading: false
};

let fb = null; // Firebase modules, authenticated user, Firestore, and callable functions
let scheduleReady = false; // unverified empty data must never look like real availability
let adminExpiryTimer = null;
let subscribedDateKey = '';
let rolloverWarningShown = false;

/* ================= tiny helpers ================= */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function timestampMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value && typeof value.toDate === 'function') return timestampMillis(value.toDate());
  if (value && typeof value.seconds === 'number') {
    const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds / 1e6 : 0;
    return value.seconds * 1000 + nanos;
  }
  if (value && typeof value._seconds === 'number') {
    const nanos = typeof value._nanoseconds === 'number' ? value._nanoseconds / 1e6 : 0;
    return value._seconds * 1000 + nanos;
  }
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
function selectedHomeDate() {
  const dates = upcomingBookingDates();
  if (dates.indexOf(ui.homeDate) === -1) ui.homeDate = dates.includes(todayISO()) ? todayISO() : dates[0];
  return ui.homeDate;
}
function isSaturday(date) { return dateObj(date).getDay() === 6; }
function isTuesday(date) { return dateObj(date).getDay() === 2; }
function demoMode() { return new URLSearchParams(window.location.search).get('demo') === '1'; }

/* Keep the member-facing promise aligned with the trusted backend: no day
   waits for approval any more. Whether space is actually open is still
   decided by the server when the reservation is submitted. */
function shouldAutoApproveMemberBooking(date, now = new Date()) {
  return isTuesday(date) || isSaturday(date);
}
// Keep the timestamp boundary directly verifiable in the browser smoke test
// without exposing an application control in normal member or demo use.
if (new URLSearchParams(location.search).get('test') === '1') {
  window.__SRS_TEST_HELPERS__ = {
    shouldAutoApproveMemberBooking,
    endEarlyOptions,
    endEarlyNowOption,
    timestampMillis,
    setTabForTest(tab) { ui.tab = tab; render(); return ui.tab; },
    homeReservationState() {
      return {
        memberSelection: !!ui.memberSelection,
        availabilityConflict: !!ui.availabilityConflict,
        endPrompt: !!ui.endPrompt,
        availabilityDetails: !!ui.availabilityDetails,
        selectionConfirm: !!ui.selectionConfirm,
        returnFocusKey: ui.returnFocusKey
      };
    },
    seedHomeReservationStateForTest() {
      ui.memberSelection = { date: selectedHomeDate(), type: ui.homeOverviewType, start: '10:00', end: '10:30', windowIdx: 0 };
      ui.availabilityConflict = { date: selectedHomeDate(), type: ui.homeOverviewType, start: '10:00', attemptedEnd: '11:00' };
      ui.endPrompt = { date: selectedHomeDate(), type: ui.homeOverviewType, start: '10:00', windowIdx: 0 };
      ui.availabilityDetails = { date: selectedHomeDate(), type: ui.homeOverviewType, start: '10:00', end: '10:30' };
      ui.selectionConfirm = { date: selectedHomeDate(), type: ui.homeOverviewType, start: '10:00', end: '10:30' };
      ui.returnFocusKey = 'test-home-origin';
    }
  };
}

/* Every schedule segment is explicit so a selected range can never cross
   a service. Service times changed on 12 September 2026: Saturday holds all
   three services, Tuesday only the evening one. Reservable slots begin at
   10:00 AM, so Saturday's first bookable start is 11:00 AM. */
function scheduleSegments(date) {
  if (isSaturday(date)) return [
    { start: '10:00', end: '11:00', label: 'Morning service', service: true },
    { start: '11:00', end: '14:30', label: 'Late morning and early afternoon' },
    { start: '14:30', end: '15:30', label: 'Afternoon service', service: true },
    { start: '15:30', end: '19:30', label: 'Afternoon and evening' },
    { start: '19:30', end: '20:30', label: 'Evening service', service: true },
    { start: '20:30', end: '23:00', label: 'Late evening' }
  ];
  return [
    { start: '10:00', end: '19:30', label: 'Daytime and evening' },
    { start: '19:30', end: '20:30', label: 'Evening service', service: true },
    { start: '20:30', end: '23:00', label: 'Late evening' }
  ];
}
function bookingWindows(date) { return scheduleSegments(date).filter(w => !w.service); }
function serviceWindows(date) { return scheduleSegments(date).filter(w => w.service); }

/* Which booking window a start time falls in. The windows between services
   are the only real boundary a reservation cannot cross, so they replaced the
   old Morning/Afternoon/Evening grouping on 11 September 2026. */
function windowIndexForStart(date, start) {
  return bookingWindows(date).findIndex(w => start >= w.start && start < w.end);
}

function periodTimePoints(period) {
  const points = [];
  for (let m = minsOfDay(period.start); m <= minsOfDay(period.end); m += 30) points.push(hhmmOfMins(m));
  return points;
}
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
const PUBLIC_TITLE_INITIALS = { brother: 'B', sister: 'S', elder: 'E', missionary: 'M', deacon: 'D', deaconess: 'D', pastor: 'P' };
function publicNameKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}
function parsePublicName(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  let titleInitial = '';
  if (tokens.length) {
    const candidate = tokens[0].replace(/[.,]+$/g, '');
    const title = PUBLIC_TITLE_INITIALS[candidate.toLocaleLowerCase('en-US')];
    if (title) titleInitial = title;
    else if (/^[BSEMDP]$/i.test(candidate)) titleInitial = candidate.toUpperCase();
    if (titleInitial) tokens.shift();
  }
  const givenName = tokens.shift() || '';
  const surname = tokens.join(' ');
  const surnameParts = surname.split(/\s+/).filter(Boolean);
  const surnameText = surnameParts.join(' ');
  const cleanedSurname = surnameText.replace(/[.,]+/g, '');
  const surnameKey = surnameParts.length === 1 && /^[\p{L}]$/u.test(cleanedSurname)
    ? 'initial:' + publicNameKey(cleanedSurname)
    : 'name:' + publicNameKey(surnameText);
  const surnameInitialMatch = String(surnameText).replace(/^[^\p{L}\p{N}]+/u, '').match(/^./u);
  return {
    titleInitial,
    givenName,
    givenKey: publicNameKey(givenName),
    surnameKey,
    surnameInitial: surnameInitialMatch ? surnameInitialMatch[0].toLocaleUpperCase('en-US') : ''
  };
}
function publicDisplayName(value, peers) {
  const parsed = parsePublicName(value);
  if (!parsed.givenName) return 'Reserved';
  const collision = (Array.isArray(peers) ? peers : []).some(peer => {
    const other = parsePublicName(peer);
    return other.givenKey === parsed.givenKey && other.surnameKey !== parsed.surnameKey;
  });
  return [parsed.titleInitial, parsed.givenName, collision ? parsed.surnameInitial : ''].filter(Boolean).join(' ');
}
function rawBookingsList() {
  const live = Object.keys(state.bookings)
    .map(id => Object.assign({ id: id }, state.bookings[id]))
    .filter(isValidBooking);
  return demoMode() ? demoBookings() : live;
}
function ownsBooking(b) {
  if (!b) return false;
  if (demoMode()) return myBookingIds().indexOf(b.id) !== -1;
  return !!(fb && fb.auth && fb.auth.currentUser && b.ownerUid === fb.auth.currentUser.uid);
}
function publicBookingView(b, peers) {
  const view = Object.assign({}, b);
  view.name = b.purpose === 'blocked' || b.blocked === true ? 'Reserved' : publicDisplayName(b.name, peers);
  delete view.ownerUid;
  delete view.purposeOther;
  delete view.reservedFor;
  delete view.note;
  delete view.privateNote;
  delete view.priorityNotice;
  delete view.needsRebooking;
  delete view.overrodeBookingIds;
  return view;
}
function ownerBookingView(b) {
  const view = Object.assign({}, b);
  if (!view.reservedFor && view.purpose === 'other' && typeof view.purposeOther === 'string') {
    view.reservedFor = view.purposeOther.trim();
  }
  return view;
}
function bookingsList() {
  const raw = rawBookingsList();
  if (ui.tab === 'admin' && adminUnlocked()) return raw;
  const peers = raw.filter(b => b.status === 'approved' && b.purpose !== 'blocked').map(b => b.name).filter(Boolean);
  return raw.map(b => publicBookingView(b, peers));
}
function bookingByIdSafe(id) {
  const b = rawBookingsList().find(booking => booking.id === id);
  if (!b) return null;
  if (ui.tab === 'admin' && adminUnlocked()) return b;
  if (ownsBooking(b)) return ownerBookingView(b);
  const peers = rawBookingsList().filter(booking => booking.status === 'approved' && booking.purpose !== 'blocked').map(booking => booking.name).filter(Boolean);
  return publicBookingView(b, peers);
}

function demoBookings() {
  if (!demoMode()) return [];
  const dates = upcomingBookingDates();
  const tuesday = dates.find(isTuesday);
  const saturday = dates.find(isSaturday);
  const created = Date.now() - 45 * 60 * 1000;
  return [
    // Tuesday: confirmed examples, a full short interval, equipment, and late slots.
    { id: 'demo-room-4', date: tuesday, start: '10:00', end: '13:30', name: 'Anthony', purpose: 'contact', purposeOther: '', reservedFor: 'Sample contact', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-4', whiteboard: null, tv: null }, createdAt: created, decidedAt: created + 1000 },
    // ISO decision time verifies that Live updates uses the actual latest update, not fixture order.
    { id: 'demo-room-1-full', date: tuesday, start: '11:00', end: '11:30', name: 'Jordan A.', purpose: 'other', purposeOther: 'Catching up', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: created - 2000, decidedAt: new Date(created + 3000).toISOString() },
    { id: 'demo-room-2-full', date: tuesday, start: '11:00', end: '11:30', name: 'Taylor B.', purpose: 'other', purposeOther: 'Catching up', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-2', whiteboard: null, tv: null }, createdAt: created - 3000, decidedAt: created - 2000 },
    { id: 'demo-room-3-full', date: tuesday, start: '11:00', end: '11:30', name: 'Morgan C.', purpose: 'other', purposeOther: 'Catching up', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-3', whiteboard: null, tv: null }, createdAt: created - 4000, decidedAt: created - 3000 },
    // Admin-held slots deliberately use a name that must never appear in the member map.
    { id: 'demo-room-admin-held', date: tuesday, start: '12:00', end: '12:30', name: 'Admin Hold — Private', purpose: 'blocked', purposeOther: 'Internal staffing note', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-3', whiteboard: null, tv: null }, createdAt: created - 4500, decidedAt: created - 4400 },
    { id: 'demo-room-1', date: tuesday, start: '18:00', end: '19:00', name: 'Sofia M.', purpose: 'other', purposeOther: 'Family Bible study', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: created - 1800000, decidedAt: created - 1700000 },
    { id: 'demo-room-late', date: tuesday, start: '22:00', end: '22:30', name: 'Noah P.', purpose: 'meeting', purposeOther: '', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-2', whiteboard: null, tv: null }, createdAt: created - 2000000, decidedAt: created - 1900000 },
    { id: 'demo-whiteboard-1', date: tuesday, start: '16:00', end: '17:30', name: 'Daniel K.', purpose: 'meeting', purposeOther: '', status: 'approved', needs: { room: false, whiteboard: true, tv: false }, assignments: { room: null, whiteboard: 'wb-1', tv: null }, createdAt: created - 1200000, decidedAt: created - 1100000 },
    { id: 'demo-tv-1', date: tuesday, start: '14:00', end: '15:00', name: 'Maria R.', purpose: 'new-member', purposeOther: '', status: 'approved', needs: { room: false, whiteboard: false, tv: true }, assignments: { room: null, whiteboard: null, tv: 'tv-1' }, createdAt: created - 1300000, decidedAt: created - 1200000 },
    { id: 'demo-tv-2', date: tuesday, start: '14:00', end: '15:00', name: 'Maria R.', purpose: 'new-member', purposeOther: '', status: 'cancelled', needs: { room: false, whiteboard: false, tv: true }, assignments: { room: null, whiteboard: null, tv: null }, lastAssignments: { room: null, whiteboard: null, tv: 'tv-2' }, createdAt: created - 600000, updatedAt: created - 300000 },
    // The two priority updates: one that kept its time in another room, one
    // that had to be released because nothing else was open.
    { id: 'demo-room-moved', date: tuesday, start: '18:00', end: '19:00', name: 'Anthony', purpose: 'other', purposeOther: 'Catching up', reservedFor: 'Catching up', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-3', whiteboard: null, tv: null }, createdAt: created - 800000, decidedAt: created - 800000, updatedAt: created - 60000, priorityNotice: { kind: 'moved', type: 'room', fromUnit: 'room-2', toUnit: 'room-3', byPurpose: 'new-member', at: created - 60000 } },
    { id: 'demo-room-released', date: tuesday, start: '11:00', end: '11:30', name: 'Anthony', purpose: 'other', purposeOther: 'Catching up', reservedFor: 'Catching up', status: 'overridden', needsRebooking: true, needs: { room: true, whiteboard: false, tv: false }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: created - 500000, updatedAt: created - 30000, priorityNotice: { kind: 'released', type: 'room', fromUnit: 'room-2', toUnit: null, byPurpose: 'contact', at: created - 30000 } },
    { id: 'demo-room-cancelled', date: tuesday, start: '17:00', end: '18:00', name: 'Anthony', purpose: 'meeting', purposeOther: '', reservedFor: '', status: 'cancelled', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: created - 1500000, updatedAt: created - 1400000 },
    // Saturday: confirmed on submission, exactly like Tuesday.
    { id: 'demo-sat-room-1', date: saturday, start: '11:00', end: '13:00', name: 'Elena M.', purpose: 'contact', purposeOther: '', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: created - 2400000, decidedAt: created - 2300000 },
    { id: 'demo-sat-room-2', date: saturday, start: '11:30', end: '12:30', name: 'Isaac V.', purpose: 'meeting', purposeOther: '', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-2', whiteboard: null, tv: null }, createdAt: created - 2500000, decidedAt: created - 2400000 },
    { id: 'demo-sat-room-mine', date: saturday, start: '11:00', end: '12:30', name: 'Grace L.', purpose: 'new-member', purposeOther: '', reservedFor: 'Grace new member', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-3', whiteboard: null, tv: null }, createdAt: created - 900000, decidedAt: created - 900000 },
    { id: 'demo-sat-tv-1', date: saturday, start: '16:00', end: '17:30', name: 'Micah S.', purpose: 'meeting', purposeOther: '', status: 'approved', needs: { room: false, whiteboard: false, tv: true }, assignments: { room: null, whiteboard: null, tv: 'tv-1' }, createdAt: created - 850000, decidedAt: created - 850000 },
    { id: 'demo-sat-wb-2', date: saturday, start: '17:30', end: '19:00', name: 'Hannah C.', purpose: 'contact', purposeOther: '', status: 'approved', needs: { room: false, whiteboard: true, tv: false }, assignments: { room: null, whiteboard: 'wb-2', tv: null }, createdAt: created - 2600000, decidedAt: created - 2500000 },
    { id: 'demo-sat-room-late', date: saturday, start: '22:30', end: '23:00', name: 'Samuel D.', purpose: 'other', purposeOther: 'Review meeting', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: created - 700000, decidedAt: created - 700000 }
  ];
}
function bookingsForDate(date) { return bookingsList().filter(b => b.date === date); }
function activeBookingsForDate(date) {
  return bookingsForDate(date).filter(b => b.status === 'pending' || b.status === 'approved');
}
function needsOf(b) { return b.needs || {}; }
function assignmentsOf(b) { return b.assignments || {}; }

const LEGACY_PURPOSES = [
  { id: 'meeting', label: 'Meeting' },
  { id: 'group', label: 'Group' },
  { id: 'study-member', label: 'Study member' }
];
const PURPOSE_MAP = {};
PURPOSES.concat(ADMIN_PURPOSES, LEGACY_PURPOSES).forEach(p => { PURPOSE_MAP[p.id] = p.label; });
function purposeLabel(p) { return PURPOSE_MAP[p] || p || ''; }
function bookingPurposeText(b) {
  if (b.purpose === 'other' && b.purposeOther) return 'Other: ' + b.purposeOther;
  return purposeLabel(b.purpose);
}
const STATUS_LABEL = { pending: 'Pending review', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled', overridden: 'Given to a higher priority' };

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
  // Demo mode is intentionally a read-only Admin preview. It never creates a
  // session, starts Firebase, or enables any protected action.
  if (demoMode()) return true;
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
function scheduleAdminExpiry(expiresAt) {
  if (adminExpiryTimer) clearTimeout(adminExpiryTimer);
  const delay = Math.max(0, Number(expiresAt || 0) - Date.now());
  adminExpiryTimer = setTimeout(() => {
    adminExpiryTimer = null;
    endAdminSession();
  }, Math.min(delay, 2147483647));
}

/* ---- this device's own requests (localStorage) ---- */
function myBookingIds() {
  if (demoMode()) return ['demo-sat-room-mine', 'demo-room-4', 'demo-room-cancelled', 'demo-room-moved', 'demo-room-released'];
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

function purposePriority(purpose) {
  return ({ contact: 0, 'new-member': 1, group: 2, 'study-member': 2, meeting: 2, other: 3 }[purpose] ?? 3);
}
function bookingPriority(b) { return purposePriority(b.purpose); }

/* Colour tone for a purpose. Legacy purposes that are no longer offered
   share one neutral tone so they never read as a current choice. */
function purposeToneClass(purpose) {
  return PURPOSES.some(p => p.id === purpose) ? 'purpose-' + purpose : 'purpose-legacy';
}

/* Units of `type` that a higher priority could take for [start,end): every
   approved reservation touching that unit in the range must be an Other.
   A unit with nothing on it is not listed here, because it is simply free. */
function reclaimableUnits(type, date, start, end) {
  return unitsForType(type).map(unit => {
    const holders = bookingsForDate(date).filter(b =>
      b.status === 'approved' && assignmentsOf(b)[type] === unit.id &&
      rangesOverlap(b.start, b.end, start, end));
    if (!holders.length) return null;
    if (!holders.every(b => b.purpose === OVERRIDABLE_PURPOSE)) return null;
    return { unit: unit, holders: holders };
  }).filter(Boolean).sort((a, b) => a.holders.length - b.holders.length || a.unit.num - b.unit.num);
}
function overrideCandidate(type, date, start, end) {
  if (freeUnitsForType(type, date, start, end, null).length) return null;
  return reclaimableUnits(type, date, start, end)[0] || null;
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
    localStorage.setItem(DATA_KEY, JSON.stringify({ bookings: state.bookings, queryDates: upcomingBookingDates() }));
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
      memberOverrideBooking: fnMod.httpsCallable(functions, 'memberOverrideBooking'),
      memberEndBookingEarly: fnMod.httpsCallable(functions, 'memberEndBookingEarly'),
      memberSetPrivateNote: fnMod.httpsCallable(functions, 'memberSetPrivateNote')
    }
  };
  const bookingQuery = fsMod.query(
    fsMod.collection(db, 'bookings'),
    fsMod.where('date', 'in', upcomingBookingDates())
  );
  subscribedDateKey = upcomingBookingDates().join('|');
  fsMod.onSnapshot(bookingQuery, { includeMetadataChanges: true }, snap => {
    // A cache-only empty snapshot (no server contact yet) must not wipe the
    // device's saved bookings — wait for a real server answer.
    if (snap.metadata.fromCache && snap.empty) return;
    const previousStatuses = {};
    const previousNotices = {};
    myBookingIds().forEach(id => {
      if (!state.bookings[id]) return;
      previousStatuses[id] = state.bookings[id].status;
      previousNotices[id] = priorityNoticeKey(state.bookings[id]);
    });
    state.bookings = {};
    snap.docs.forEach(d => { state.bookings[d.id] = d.data(); });
    scheduleReady = true;
    // Tell this device's owner (visibly and via the aria-live banner region)
    // when the approver decides one of their pending requests.
    myBookingIds().forEach(id => {
      const now = state.bookings[id] && state.bookings[id].status;
      if (previousStatuses[id] !== 'pending' || !now || now === 'pending') return;
      if (now === 'approved') addBanner('Your reservation was approved. See My reservations for details.');
      else if (now === 'declined') addBanner('Your reservation request was declined. See My reservations.', true);
    });
    // A priority update: someone with a higher purpose took this time, so the
    // reservation either moved to another unit or was released.
    myBookingIds().forEach(id => {
      const booking = state.bookings[id];
      const key = priorityNoticeKey(booking);
      if (!key || key === previousNotices[id]) return;
      const message = priorityNoticeText(booking);
      if (message) addBanner(message, booking.priorityNotice.kind === 'released');
    });
    saveLocal(); render();
    setSyncPill(!snap.metadata.fromCache, snap.metadata.fromCache ? 'Reconnecting' : 'Live');
  }, err => {
    addBanner('Could not connect to the shared database (' + (err.code || 'error') + '). Showing this device’s copy.', true);
    setSyncPill(false, 'Reconnecting');
    render();
  });
  setSyncPill(false, 'Connecting');
}

/* ================= banners ================= */

function addBanner(text, isError) {
  const box = document.getElementById('banners');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'banner' + (isError ? ' error' : '');
  div.textContent = String(text || '');
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
  const adminPinDraft = activeBeforeRender && activeBeforeRender.id === 'admin-pin-input' ? activeBeforeRender.value : '';
  const popupFocus = (ui.signup || ui.endPrompt || ui.availabilityDetails || ui.bookingDetails || ui.endEarly) && activeBeforeRender && activeBeforeRender.closest('.booking-dialog')
    ? { id: activeBeforeRender.id || '', act: activeBeforeRender.dataset.act || '', item: activeBeforeRender.dataset.id || '' }
    : null;
  const actionNode = activeBeforeRender && !activeBeforeRender.closest('.booking-dialog') && !activeBeforeRender.closest('#tabs')
    ? activeBeforeRender.closest('[data-act]') : null;
  const fieldFocus = activeBeforeRender && !activeBeforeRender.closest('.booking-dialog') && !activeBeforeRender.closest('#tabs') && activeBeforeRender.id ? {
    id: activeBeforeRender.id,
    start: typeof activeBeforeRender.selectionStart === 'number' ? activeBeforeRender.selectionStart : null,
    end: typeof activeBeforeRender.selectionEnd === 'number' ? activeBeforeRender.selectionEnd : null
  } : null;
  const actionFocus = actionNode ? {
    act: actionNode.dataset.act || '', id: actionNode.dataset.id || '', date: actionNode.dataset.date || '',
    type: actionNode.dataset.type || '', win: actionNode.dataset.win || '', booking: actionNode.dataset.booking || '',
    start: actionNode.dataset.start || '', period: actionNode.dataset.period || ''
  } : null;
  syncMastheadScheduleLink();
  syncSignupDraft();
  syncAdminFormDraft();
  document.body.classList.toggle('modal-open', !!ui.signup || !!ui.endPrompt || !!ui.availabilityDetails || !!ui.bookingDetails || !!ui.endEarly);
  document.body.classList.toggle('admin-workspace-open', ui.tab === 'admin' && adminUnlocked());

  const date = selectedDate();

  const tabs = document.getElementById('tabs');
  if (tabs) {
    // A previous version persisted a Reservations tab. Treat that stale state
    // as Home instead of rendering a route that members can no longer reach.
    if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'home';
    tabs.innerHTML = TABS.map(t =>
      '<button id="tab-' + t.id + '" class="tab' + (ui.tab === t.id ? ' active' : '') + '" role="tab" aria-selected="' + (ui.tab === t.id ? 'true' : 'false') + '" tabindex="' + (ui.tab === t.id ? '0' : '-1') + '" aria-controls="app" data-act="tab" data-id="' + t.id + '">' + esc(t.label) + '</button>'
    ).join('');
  }

  app.setAttribute('aria-labelledby', 'tab-' + ui.tab);

  if (ui.tab === 'admin') app.innerHTML = renderAdmin();
  else if (ui.tab === 'mine') app.innerHTML = renderMyReservations();
  else app.innerHTML = renderHome();
  hydrateHomeDayOverview();
  hydrateDashboardActivityFeed();

  const masthead = document.querySelector('#masthead .head-in');
  const primaryNav = document.querySelector('nav[aria-label="Primary"]');
  const sheetOpen = !!ui.signup || !!ui.endPrompt || !!ui.availabilityDetails || !!ui.bookingDetails || !!ui.selectionConfirm || !!ui.endEarly;
  if (masthead) masthead.inert = sheetOpen;
  if (primaryNav) primaryNav.inert = sheetOpen;
  // My reservations renders its list and feed as siblings of the intro, so
  // every top-level block goes inert while a sheet is open.
  app.querySelectorAll(':scope > .member-booking, :scope > .home-dashboard, :scope > .reservation-list, :scope > .activity-feed, :scope > .admin-workspace')
    .forEach(node => { node.inert = sheetOpen; });
  const freshPin = document.getElementById('admin-pin-input');
  if (freshPin && adminPinDraft) freshPin.value = adminPinDraft;

  if (!sheetOpen && (actionFocus || fieldFocus)) {
    requestAnimationFrame(() => {
      const exactField = fieldFocus ? document.getElementById(fieldFocus.id) : null;
      const fresh = Array.from(document.querySelectorAll('[data-act]')).find(node =>
        actionFocus &&
        (node.dataset.act || '') === actionFocus.act && (node.dataset.id || '') === actionFocus.id &&
        (node.dataset.date || '') === actionFocus.date && (node.dataset.type || '') === actionFocus.type &&
        (node.dataset.win || '') === actionFocus.win && (node.dataset.booking || '') === actionFocus.booking &&
        (node.dataset.start || '') === actionFocus.start && (node.dataset.period || '') === actionFocus.period);
      const fallback = document.querySelector('.admin-queue-item.selected, .admin-queue-item');
      if (exactField) {
        exactField.focus();
        if (fieldFocus.start !== null && typeof exactField.setSelectionRange === 'function') exactField.setSelectionRange(fieldFocus.start, fieldFocus.end);
      } else if (fresh && !fresh.disabled) fresh.focus(); else if (fallback) fallback.focus();
    });
  }

  if (sheetOpen) {
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

function syncMastheadScheduleLink() {
  const scheduleLink = document.getElementById('masthead-schedule');
  if (!scheduleLink) return;
  scheduleLink.setAttribute('href', demoMode() ? 'tv.html?tv=1&demo=1' : 'tv.html?tv=1');
}

function dateSelectorHtml() {
  const dates = upcomingBookingDates();
  const date = selectedDate();
  const index = dates.indexOf(date);
  return '<div class="date-selector" role="group" aria-label="Choose reservation date">' +
    '<button type="button" class="date-arrow" data-act="date-step" data-id="-1" aria-label="Previous reservation date"' + (index <= 0 ? ' disabled' : '') + '><span aria-hidden="true">‹</span></button>' +
    '<div class="date-current" aria-live="polite"><strong>' + (isTuesday(date) ? 'Tuesday' : 'Saturday') + ', ' + esc(fmtHeaderDate(date)) + '</strong><span>Confirmed instantly when open</span></div>' +
    '<button type="button" class="date-arrow" data-act="date-step" data-id="1" aria-label="Next reservation date"' + (index >= dates.length - 1 ? ' disabled' : '') + '><span aria-hidden="true">›</span></button>' +
    '</div>';
}

/* ---- Home dashboard ---- */

function updateHomeScrollCue(map) {
  const canScroll = map.scrollHeight > map.clientHeight + 1;
  const atTop = map.scrollTop <= 1;
  const atBottom = map.scrollTop + map.clientHeight >= map.scrollHeight - 1;
  const state = !canScroll ? 'none' : (atTop ? 'top' : (atBottom ? 'bottom' : 'middle'));
  const cue = map.parentElement?.querySelector('.home-scroll-cue');
  map.dataset.scrollState = state;
  if (cue) {
    cue.hidden = !canScroll;
    cue.dataset.state = state;
    cue.textContent = state === 'top' ? 'Scroll down ↓' : (state === 'bottom' ? 'Scroll up ↑' : 'Scroll up or down ↕');
  }
}

function hydrateHomeDayOverview() {
  document.querySelectorAll('.home-day-map').forEach(map => {
    map.addEventListener('scroll', () => updateHomeScrollCue(map), { passive: true });
    updateHomeScrollCue(map);
  });
}

function updateDashboardActivityCue(list) {
  const canScroll = list.scrollHeight > list.clientHeight + 1;
  const atTop = list.scrollTop <= 1;
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  const state = !canScroll ? 'none' : (atTop ? 'top' : (atBottom ? 'bottom' : 'middle'));
  const cue = list.parentElement?.querySelector('.activity-scroll-cue');
  list.dataset.scrollState = state;
  if (cue) {
    cue.hidden = !canScroll;
    cue.dataset.state = state;
    cue.textContent = state === 'top' ? 'More updates below ↓' : (state === 'bottom' ? 'Earlier updates above ↑' : 'More updates above and below ↕');
  }
}

function hydrateDashboardActivityFeed() {
  document.querySelectorAll('.dashboard-feed .activity-list').forEach(list => {
    list.addEventListener('scroll', () => updateDashboardActivityCue(list), { passive: true });
    updateDashboardActivityCue(list);
  });
}

/* Shared read-only day map. Admin gets status styling; Home opts into open-cell
   actions, which still start a general reservation rather than assigning that
   specific unit. */
function dayMapGridHtml(date, type, options = {}) {
  const units = unitsForType(type);
  let html = '<div class="member-calendar-grid">' +
    '<div class="member-calendar-row unit-header"><div class="member-time"><small>Time</small></div><div class="member-squares" style="--capacity:' + units.length + '">' + units.map(unit => '<span>' + esc(String(unit.num)) + '</span>').join('') + '</div></div>';
  (options.segments || scheduleSegments(date)).forEach(window => {
    if (window.service) {
      html += '<div class="member-service"><span>' + esc(window.label) + '</span><span>' + esc(fmtTime(window.start)) + '–' + esc(fmtTime(window.end)) + '</span></div>';
      return;
    }
    slotStarts(window).forEach(start => {
      const end = hhmmOfMins(minsOfDay(start) + 30);
      html += '<div class="member-calendar-row"><div class="member-time">' + esc(fmtTime(start)) + '</div><div class="member-squares" style="--capacity:' + units.length + '">' + units.map(unit => {
        const occupant = unitOccupant(type, unit.id, date, start, end, null);
        const status = options.memberStatus ? memberSlotStatus(type, date, start, unit.id) : (occupant ? 'taken' : 'open');
        if (options.clickOpen && !occupant) {
          const focusKey = 'home-open-' + date + '-' + type + '-' + start + '-' + unit.id;
          return '<button type="button" class="member-square open home-open-cell" data-act="home-reserve-slot" data-date="' + esc(date) + '" data-type="' + esc(type) + '" data-start="' + start + '" data-unit="' + esc(unit.id) + '" data-focus-key="' + esc(focusKey) + '" aria-label="' + esc(fmtTime(start) + ', ' + unit.label + ' is open. Reserve this time.') + '">Open</button>';
        }
        if (options.clickOpen && occupant) {
          const adminHeld = occupant.purpose === 'blocked' || occupant.blocked === true;
          const name = adminHeld ? 'Reserved' : occupant.name;
          const purpose = adminHeld ? 'Reserved' : purposeLabel(occupant.purpose);
          const tone = adminHeld ? 'purpose-held' : purposeToneClass(occupant.purpose);
          const body = '<strong class="home-cell-name">' + esc(name) + '</strong><small class="home-cell-purpose">' + esc(purpose) + '</small>';
          // A held slot is Admin business and stays inert. Anything else can be
          // opened, which is how a higher priority asks to take an Other slot.
          if (adminHeld) {
            return '<div class="member-square ' + status + ' home-occupied-cell home-held-cell ' + tone + '" data-held="true" aria-label="' + esc(fmtTime(start) + ', ' + unit.label + ', reserved') + '">' + body + '</div>';
          }
          const takenKey = 'home-taken-' + date + '-' + type + '-' + start + '-' + unit.id;
          return '<button type="button" class="member-square ' + status + ' home-occupied-cell ' + tone + '" data-act="home-taken-slot" data-booking="' + esc(occupant.id || '') + '" data-date="' + esc(date) + '" data-type="' + esc(type) + '" data-start="' + start + '" data-unit="' + esc(unit.id) + '" data-focus-key="' + esc(takenKey) + '" aria-label="' + esc(fmtTime(start) + ', ' + unit.label + ', reserved by ' + name + ', ' + purpose + '. Open this time to see your options.') + '">' + body + '</button>';
        }
        return '<div class="member-square ' + status + '" aria-label="' + esc(fmtTime(start) + ', ' + unit.label + ', ' + (occupant ? 'reserved by ' + occupant.name : status)) + '">' + (occupant ? esc(occupant.name) : '') + '</div>';
      }).join('') + '</div></div>';
    });
  });
  return html + '</div>';
}

function homeDateControlsHtml(date) {
  const dates = upcomingBookingDates();
  const index = dates.indexOf(date);
  return '<div class="date-selector home-date-selector" role="group" aria-label="Choose home overview date">' +
    '<button type="button" class="date-arrow" data-act="home-date-step" data-id="-1" aria-label="Previous overview date"' + (index <= 0 ? ' disabled' : '') + '><span aria-hidden="true">‹</span></button>' +
    '<div class="date-current" aria-live="polite"><strong>' + (isTuesday(date) ? 'Tuesday' : 'Saturday') + ', ' + esc(fmtHeaderDate(date)) + '</strong><span>Confirmed instantly when open</span></div>' +
    '<button type="button" class="date-arrow" data-act="home-date-step" data-id="1" aria-label="Next overview date"' + (index >= dates.length - 1 ? ' disabled' : '') + '><span aria-hidden="true">›</span></button>' +
    '</div>';
}

function homePendingRequestsHtml(date, type) {
  const pending = bookingsForDate(date).filter(b => b.status === 'pending' && needsOf(b)[type])
    .sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start) || timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
  // Reservations are confirmed on the spot now, so this only ever lists
  // older requests still waiting from before that change. Nothing waiting,
  // nothing shown.
  if (!pending.length) return '';
  return '<section class="home-pending-requests" aria-labelledby="home-pending-title"><h3 id="home-pending-title">Pending requests</h3>' +
    '<div class="pending-request-list">' + pending.map(b => '<div><strong>' + esc(b.name) + '</strong><span>Unassigned · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + '</span></div>').join('') + '</div></section>';
}

/* Only the conflict message lives on the page now. The chosen range, its open
   count and the Clear/Continue actions all moved into the confirmation popup. */
function homeRangeControlsHtml(date, type) {
  const conflict = ui.availabilityConflict && ui.availabilityConflict.date === date && ui.availabilityConflict.type === type
    ? ui.availabilityConflict
    : null;
  return memberConflictHtml(conflict);
}

/* Confirming the chosen time used to happen in a small fixed bar at the
   bottom of the page, which people missed entirely, so the app looked like it
   had swallowed their choice. The same two actions now arrive as a popup. */
function selectionConfirmHtml() {
  const d = ui.selectionConfirm;
  if (!d) return '';
  const open = freeUnitsForType(d.type, d.date, d.start, d.end, null).length;
  const pending = bookingsForDate(d.date).filter(b => b.status === 'pending' && needsOf(b)[d.type] && rangesOverlap(b.start, b.end, d.start, d.end)).length;
  const candidate = d.override ? overrideCandidate(d.type, d.date, d.start, d.end) : null;
  const holderNames = candidate ? Array.from(new Set(candidate.holders.map(b => b.name))).join(', ') : '';
  const shorter = candidate ? shorterAvailableEnd(d.type, d.date, d.start, d.end) : null;
  return '<div class="modal-backdrop selection-confirm-backdrop" role="presentation"><section class="booking-dialog selection-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="selection-confirm-title">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(d.date)) + '</div><h2 id="selection-confirm-title">' + (candidate ? 'This time is full' : 'Confirm this time') + '</h2></div><button type="button" class="modal-close" data-act="member-clear" aria-label="Clear this time">&times;</button></div>' +
    '<p class="selection-confirm-range"><strong>' + esc(fmtTime(d.start) + ' – ' + fmtTime(d.end)) + '</strong><small>' + esc(needLabel(d.type)) + ' · exact reservation time</small></p>' +
    (candidate
      ? '<div class="override-offer"><p><strong>' + esc(candidate.unit.label) + '</strong> is held by ' + esc(holderNames) + ' for <strong>Other</strong>. Contact and New Member come first, so you can take this time.</p><p class="hint">Whoever is here now moves to another open ' + esc(needLabel(d.type).toLowerCase()) + ' if one is free, and is told either way.</p>' +
        (shorter ? '<button type="button" class="btn small" data-act="member-shorten" data-end="' + esc(shorter) + '">Take nobody\u2019s time: end at ' + esc(fmtTime(shorter)) + ' instead</button>' : '') + '</div>'
      : '<button type="button" class="selected-counts confirm-counts" data-act="member-range-details" data-focus-key="member-range-details" data-date="' + esc(d.date) + '" data-type="' + esc(d.type) + '" data-start="' + d.start + '" data-end="' + d.end + '"><span><strong>' + open + '</strong> open</span>' + (pending ? '<span><strong>' + pending + '</strong> pending</span>' : '') + '<small>View room and request details</small></button>') +
    '<div class="modal-actions selection-confirm-actions"><button type="button" class="btn selection-clear" data-act="member-clear">Clear</button>' +
    (candidate
      ? '<button type="button" class="btn primary" data-act="member-override" data-focus-key="member-continue">Override with priority</button>'
      : '<button type="button" class="btn primary" data-act="member-continue" data-focus-key="member-continue">Continue</button>') +
    '</div></section></div>';
}

/* The Admin day map is useful before a member starts a request too. This
   member version deliberately exposes only names, times, status, and open
   capacity already visible elsewhere in the public-by-link schedule. */
function purposeLegendHtml() {
  return '<div class="purpose-legend" aria-label="What the colors mean">' + PURPOSES.map(p =>
    '<span class="purpose-legend-item purpose-' + esc(p.id) + '"><span class="purpose-swatch" aria-hidden="true"></span>' + esc(p.rank + '. ' + p.label) + '</span>'
  ).join('') + '</div>';
}

/* One whole day in one scroll region. The dayparts used to be three
   collapsible boxes with only Morning open, which read as a missing
   schedule. The in-grid service rows already separate the day. */
function homeDayOverviewHtml(date, type) {
  const cueId = 'home-scroll-cue-' + date + '-' + type;
  return '<section class="home-day-overview" aria-labelledby="home-day-overview-title">' +
    '<div class="home-section-head"><div><div class="eyebrow">Plan a reservation</div><h2 id="home-day-overview-title">Day overview</h2></div></div>' +
    homeDateControlsHtml(date) + memberResourceToggleHtml(type, 'home-overview-type') +
    purposeLegendHtml() +
    '<div class="home-day-map-wrap"><div class="member-calendar-scroll home-day-map" tabindex="0" role="region" aria-label="' + esc('Full day ' + needLabel(type).toLowerCase() + ' schedule') + '" aria-describedby="' + esc(cueId) + '">' + dayMapGridHtml(date, type, { clickOpen: true }) + '</div><span id="' + esc(cueId) + '" class="home-scroll-cue" aria-live="polite" aria-atomic="true"></span></div>' +
    homeRangeControlsHtml(date, type) +
    homePendingRequestsHtml(date, type) + '</section>';
}

function renderHome() {
  if (!scheduleReady && !demoMode()) {
    return '<section class="member-booking"><div class="member-intro"><div class="eyebrow">Home</div><h1>Loading today’s room activity.</h1><p>The dashboard will appear as soon as the shared schedule is verified.</p></div><div class="schedule-loading" role="status" aria-live="polite"><span aria-hidden="true"></span>Connecting to the shared schedule</div></section>';
  }
  const dates = upcomingBookingDates();
  const overviewDate = selectedHomeDate();
  let html = '<section class="home-dashboard"><h1 class="sr-only">Study Rooms</h1>' + activityFeedHtml(dates, true, 2) +
    homeDayOverviewHtml(overviewDate, ui.homeOverviewType) + '</section>';
  if (ui.signup) html += bookingModalHtml();
  else if (ui.endPrompt) html += endTimePromptHtml();
  else if (ui.availabilityDetails) html += availabilityDetailsHtml();
  else if (ui.bookingDetails) html += bookingDetailsHtml();
  else if (ui.selectionConfirm) html += selectionConfirmHtml();
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
  // Pending requests never own a numbered unit. They appear only in the
  // aggregate request count and Admin queue until approval assigns a unit.
  return 'open';
}

function resourceLabelFor(b) {
  const type = neededTypesOf(b)[0];
  const id = assignmentsOf(b)[type] || (b.lastAssignments || {})[type];
  return id ? unitLabel(type, id) : needLabel(type);
}

/* ---- finishing early ---- */

/* The reservation was shortened after it was made; `endedEarlyFrom` keeps the
   ending that was originally booked. */
function endedEarly(b) {
  return !!(b && typeof b.endedEarlyFrom === 'string' && b.endedEarlyFrom > b.end);
}

/* Every 30-minute boundary this reservation could end at instead: after its
   start so at least one block is kept, and before its current ending. */
function endEarlyOptions(b) {
  const options = [];
  if (!b || !b.start || !b.end) return options;
  for (let m = minsOfDay(b.start) + 30; m < minsOfDay(b.end); m += 30) options.push(hhmmOfMins(m));
  return options;
}

/* The choice that means "I am done right now": the most recent boundary the
   Los Angeles clock has already passed. Null when the reservation is on
   another day or has not started yet, so nothing is mislabelled as now. */
function endEarlyNowOption(b, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  if (!b || b.date !== get('year') + '-' + get('month') + '-' + get('day')) return null;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const reached = endEarlyOptions(b).filter(end => minsOfDay(end) <= minutes);
  return reached.length ? reached[reached.length - 1] : null;
}

function endEarlySheetHtml() {
  const b = ui.endEarly ? bookingByIdSafe(ui.endEarly.id) : null;
  const options = b ? endEarlyOptions(b) : [];
  if (!b || !options.length) return '';
  const nowOption = endEarlyNowOption(b);
  return '<div class="modal-backdrop end-time-backdrop" role="presentation"><section class="booking-dialog end-time-dialog" role="dialog" aria-modal="true" aria-labelledby="end-early-dialog-title">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(b.date)) + '</div><h2 id="end-early-dialog-title">Finished early?</h2></div>' +
    '<button type="button" class="modal-close" data-act="end-early-close" aria-label="Close ending choices">&times;</button></div>' +
    '<p class="booking-time-summary"><strong>' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + '</strong> · ' + esc(needsSummary(b)) + '</p>' +
    '<p class="hint">Choose when you actually finished. The time after that is released right away, so everyone sees it as open.</p>' +
    '<div class="end-time-list" role="group" aria-label="Choose a new ending">' + options.map(end =>
      '<button type="button" class="end-time-choice' + (end === nowOption ? ' end-time-now' : '') + '" data-act="end-early-pick" data-id="' + esc(b.id) + '" data-end="' + end + '"' + (ui.submitting ? ' disabled' : '') + '>' +
      '<strong>End at ' + esc(fmtTime(end)) + (end === nowOption ? ' · now' : '') + '</strong>' +
      '<span>Frees ' + esc(fmtTime(end)) + '–' + esc(fmtTime(b.end)) + '</span></button>').join('') +
    '</div><div class="modal-actions"><button type="button" class="btn" data-act="end-early-close">Keep my time</button></div></section></div>';
}

function activityFeedHtml(dateOrDates, dashboard, limit) {
  const dates = Array.isArray(dateOrDates) ? dateOrDates : [dateOrDates];
  const allEvents = bookingsList().filter(b => dates.includes(b.date) && ['pending', 'approved', 'cancelled'].includes(b.status)).map(b => {
    const status = b.status === 'cancelled' ? 'Cancelled'
      : b.status === 'overridden' ? 'Priority update:'
        : b.status === 'pending' ? 'Requested'
          : endedEarly(b) ? 'Ended early —' : 'Reserved';
    const when = Math.max(timestampMillis(b.createdAt), timestampMillis(b.updatedAt), timestampMillis(b.decidedAt));
    return { b, status, when };
  }).sort((a, b) => b.when - a.when);
  const events = dashboard ? allEvents : allEvents.slice(0, limit || 6);
  const title = dashboard ? 'Live updates' : 'Recent updates';
  if (!events.length) return '<section class="activity-feed' + (dashboard ? ' dashboard-feed' : '') + '"><div class="activity-title">' + title + '</div><p>No updates yet.</p></section>';
  const rows = events.map(event =>
    '<div class="activity-row ' + esc(event.b.status) + '"><div><strong>' + esc(event.status + ' ' + resourceLabelFor(event.b)) + '</strong><span>' + esc(event.b.name) + ' · ' + esc(bookingPurposeText(event.b)) + '</span></div><time>' + esc(fmtDate(event.b.date)) + '<br>' + esc(fmtTime(event.b.start)) + '–' + esc(fmtTime(event.b.end)) + '</time></div>'
  ).join('');
  if (dashboard) return '<section class="activity-feed dashboard-feed"><div class="activity-title">' + title + '</div><div class="activity-list-wrap"><div class="activity-list" role="region" tabindex="0" aria-label="Live reservation updates" aria-describedby="live-updates-scroll-cue">' + rows + '</div><span id="live-updates-scroll-cue" class="activity-scroll-cue" aria-live="polite" aria-atomic="true"></span></div></section>';
  return '<section class="activity-feed"><div class="activity-title">' + title + '</div><div class="activity-list">' + rows + '</div></section>';
}

function unavailableRangeMessage(type) {
  if (type === 'room') return 'There are no rooms available in the time slot that was selected.';
  if (type === 'whiteboard') return 'There are no whiteboards available in the time slot that was selected.';
  return 'There are no TVs available in the time slot that was selected.';
}

function shorterAvailableEnd(type, date, start, attemptedEnd) {
  let suggestion = null;
  for (let end = minsOfDay(start) + 30; end < minsOfDay(attemptedEnd); end += 30) {
    const value = hhmmOfMins(end);
    if (freeUnitsForType(type, date, start, value, null).length) suggestion = value;
    else break;
  }
  return suggestion;
}

function memberConflictHtml(conflict) {
  if (!conflict) return '';
  const suggestion = conflict.suggestedEnd;
  return '<div class="availability-conflict" role="alert"><strong>' + esc(unavailableRangeMessage(conflict.type)) + '</strong>' +
    (suggestion ? '<p>Would you like to schedule from ' + esc(fmtTime(conflict.start)) + ' to ' + esc(fmtTime(suggestion)) + ' instead?</p><div class="conflict-actions"><button type="button" class="btn primary small" data-act="conflict-yes">Yes</button><button type="button" class="btn small" data-act="conflict-no">No</button></div>' : '<p>Please choose a different end time.</p><div class="conflict-actions"><button type="button" class="btn small" data-act="conflict-no">Choose another time</button></div>') +
    '</div>';
}

function availabilityDetailsHtml() {
  const d = ui.availabilityDetails;
  if (!d) return '';
  const units = unitsForType(d.type);
  const pending = bookingsForDate(d.date)
    .filter(b => b.status === 'pending' && needsOf(b)[d.type] && rangesOverlap(b.start, b.end, d.start, d.end))
    .sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start) || timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
  return '<div class="modal-backdrop availability-backdrop" role="presentation"><section class="booking-dialog availability-dialog" role="dialog" aria-modal="true" aria-labelledby="availability-dialog-title">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(d.date)) + '</div><h2 id="availability-dialog-title">Availability details</h2></div><button type="button" class="modal-close" data-act="member-close-sheet" aria-label="Close availability details">&times;</button></div>' +
    '<p class="booking-time-summary"><strong>' + esc(needLabel(d.type)) + '</strong> · ' + esc(fmtTime(d.start)) + '–' + esc(fmtTime(d.end)) + '</p>' +
    '<section class="availability-detail-section"><h3>Approved unit assignments</h3><div class="unit-detail-grid" style="--capacity:' + units.length + '">' + units.map(unit => {
      const occupant = unitOccupant(d.type, unit.id, d.date, d.start, d.end, null);
      return '<div class="unit-detail ' + (occupant ? 'taken' : 'open') + '"><strong>' + esc(unit.label) + '</strong><span>' + (occupant ? esc(occupant.name + ' · ' + fmtTime(occupant.start) + '–' + fmtTime(occupant.end)) : 'Open') + '</span></div>';
    }).join('') + '</div></section>' +
    (pending.length
      ? '<section class="availability-detail-section"><h3>Pending requests</h3><div class="pending-request-list">' + pending.map(b => '<div><strong>' + esc(b.name) + '</strong><span>Requested · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + '</span></div>').join('') + '</div></section>'
      : '') +
    '<div class="modal-actions"><button type="button" class="btn primary" data-act="member-close-sheet">Done</button></div></section></div>';
}

function reservedForValue(b) {
  if (!b) return '';
  if (typeof b.reservedFor === 'string' && b.reservedFor.trim()) return b.reservedFor.trim();
  return b.purpose === 'other' && typeof b.purposeOther === 'string' ? b.purposeOther.trim() : '';
}
function reservedForLabel(purpose) {
  if (purpose === 'contact') return 'Contact name';
  if (purpose === 'new-member') return 'Member name';
  if (purpose === 'other') return 'Purpose description';
  return 'Reserved for';
}
function bookingDetailsHtml() {
  const details = ui.bookingDetails;
  const b = details ? bookingByIdSafe(details.id) : null;
  if (!b) return '';
  const owner = ownsBooking(b);
  const active = b.status === 'pending' || b.status === 'approved';
  const reservedFor = reservedForValue(b);
  const peers = rawBookingsList().filter(booking => booking.status === 'approved' && booking.purpose !== 'blocked').map(booking => booking.name).filter(Boolean);
  const displayName = b.purpose === 'blocked' || b.blocked === true ? 'Reserved' : publicDisplayName(b.name, peers);
  const purpose = b.purpose === 'blocked' || b.blocked === true ? 'Reserved' : bookingPurposeText(b);
  const resource = resourceLabelFor(b);
  const canEndEarly = owner && b.status === 'approved' && endEarlyOptions(b).length > 0;
  return '<div class="modal-backdrop booking-details-backdrop" role="presentation"><section class="booking-dialog booking-details-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-details-title">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(b.date)) + '</div><h2 id="booking-details-title">Reservation details</h2></div><button type="button" class="modal-close" data-act="booking-details-close" aria-label="Close reservation details">&times;</button></div>' +
    '<p class="booking-time-summary"><strong>' + esc(resource) + '</strong></p>' +
    '<dl class="booking-detail-list"><div><dt>Reservation</dt><dd>' + esc(fmtTime(b.start) + ' to ' + fmtTime(b.end)) + '</dd></div><div><dt>Reserved</dt><dd>' + esc(displayName) + '</dd></div><div><dt>Purpose</dt><dd>' + esc(purpose) + '</dd></div>' +
    (reservedFor ? '<div><dt>' + esc(reservedForLabel(b.purpose)) + '</dt><dd>' + esc(reservedFor) + '</dd></div>' : '') +
    '</dl>' +
    (b.status !== 'approved' ? '<p class="hint">' + esc(STATUS_LABEL[b.status] || b.status || 'Unavailable') + '</p>' : '') +
    (owner && active ? '<div class="modal-actions booking-details-actions">' +
      (canEndEarly ? '<button type="button" class="btn" data-act="booking-details-end-early" data-id="' + esc(b.id) + '">End early</button>' : '') +
      '<button type="button" class="btn danger" data-act="booking-details-cancel" data-id="' + esc(b.id) + '">' + (b.status === 'approved' ? 'Cancel reservation' : 'Cancel request') + '</button></div>' :
      (!owner && b.status === 'approved' && b.purpose !== 'blocked' ? '<div class="modal-actions booking-details-actions"><button type="button" class="btn primary" data-act="booking-details-reserve" data-date="' + esc(details.date) + '" data-type="' + esc(details.type) + '" data-start="' + esc(details.start) + '">See reservation options</button></div>' : '')) +
    '</section></div>';
}

function endTimePromptHtml() {
  const d = ui.endPrompt;
  const period = d && bookingWindows(d.date)[d.windowIdx];
  if (!d || !period) return '';
  const ends = periodTimePoints(period).filter(end => minsOfDay(end) > minsOfDay(d.start));
  return '<div class="modal-backdrop end-time-backdrop" role="presentation"><section class="booking-dialog end-time-dialog" role="dialog" aria-modal="true" aria-labelledby="end-time-dialog-title">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(d.date)) + '</div><h2 id="end-time-dialog-title">When should it end?</h2></div><button type="button" class="modal-close" data-act="member-close-end-prompt" aria-label="Close end time choices">&times;</button></div>' +
    '<p class="booking-time-summary"><strong>' + esc(fmtTime(d.start)) + ' start</strong> · choose an exact end time</p><div class="end-time-list" role="group" aria-label="Choose an end time">' + ends.map(end => {
      const open = freeUnitsForType(d.type, d.date, d.start, end, null).length;
      return '<button type="button" class="end-time-choice" data-act="member-end-time" data-date="' + esc(d.date) + '" data-type="' + esc(d.type) + '" data-period="' + d.windowIdx + '" data-end="' + end + '"><strong>End at ' + esc(fmtTime(end)) + '</strong><span>' + esc(open ? open + ' open for this range' : 'No units open for this range') + '</span></button>';
    }).join('') + '</div><div class="modal-actions"><button type="button" class="btn" data-act="member-close-end-prompt">Cancel</button></div></section></div>';
}

function adminUnitCalendarHtml(date, type) {
  const units = unitsForType(type);
  let html = '<section class="member-calendar admin-unit-calendar" aria-label="' + esc(needLabel(type)) + ' schedule">' +
    '<div class="member-calendar-heading"><h2>' + esc(needLabel(type)) + ' day map</h2><span>' + units.length + ' units</span></div>' +
    memberResourceToggleHtml(type, 'admin-type') +
    '<div class="member-calendar-scroll">' + dayMapGridHtml(date, type, { memberStatus: true }) + '</div>';
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
  if (!scheduleReady && !demoMode()) {
    return '<section class="member-booking"><div class="member-intro"><div class="eyebrow">My reservations</div><h1>Confirming your reservations.</h1><p>The shared schedule is connecting.</p></div><div class="schedule-loading" role="status" aria-live="polite"><span aria-hidden="true"></span>Loading current reservation statuses</div></section>';
  }
  const items = myBookingIds().map(bookingByIdSafe).filter(Boolean)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  // No date selector here on purpose: this list always shows every upcoming
  // reservation from this device, so a day filter would only mislead.
  let html = '<section class="member-booking"><div class="member-intro"><div class="eyebrow">My reservations</div><h1>Your upcoming plans.</h1><p>Requests made from this device stay here with their latest status.</p></div></section>';
  const active = items.filter(b => b.status === 'pending' || b.status === 'approved');
  const inactive = items.filter(b => b.status !== 'pending' && b.status !== 'approved');
  html += '<div class="reservation-list">';
  if (!items.length) html += '<p class="hint">No reservations have been made from this device yet.</p>';
  else {
    if (active.length) {
      html += '<h2>Upcoming</h2>';
      active.forEach((b, index) => { html += myRequestRowHtml(b, b.date, index === 0); });
    }
    if (inactive.length) {
      html += '<h2 class="reservation-section-title">Past reservations</h2>';
      inactive.forEach(b => { html += myRequestRowHtml(b, b.date, false); });
    }
  }
  return html + '</div>' + activityFeedHtml(upcomingBookingDates()) + endEarlySheetHtml();
}

function myRequestStatusHtml(b, date) {
  if (b.status === 'overridden') return '<span class="badge status-overridden">Given to a higher priority</span>';
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

/* One reservation's latest priority update, or null. `kind` is 'moved' when
   it kept its time in another unit, 'released' when the time was given up. */
function priorityNoticeOf(b) {
  const notice = b && b.priorityNotice;
  return notice && (notice.kind === 'moved' || notice.kind === 'released') ? notice : null;
}
function priorityNoticeKey(b) {
  const notice = priorityNoticeOf(b);
  return notice ? notice.kind + '|' + timestampMillis(notice.at) + '|' + (notice.toUnit || '') : '';
}
function priorityNoticeText(b) {
  const notice = priorityNoticeOf(b);
  if (!notice) return '';
  const type = notice.type || neededTypesOf(b)[0] || 'room';
  const taker = purposeLabel(notice.byPurpose) || 'higher priority';
  if (notice.kind === 'moved') {
    return 'Priority update: a ' + taker + ' reservation took ' + (notice.fromUnit ? unitLabel(type, notice.fromUnit) : 'your ' + needLabel(type).toLowerCase()) +
      '. You kept your time in ' + (notice.toUnit ? unitLabel(type, notice.toUnit) : 'another ' + needLabel(type).toLowerCase()) + '.';
  }
  return 'Priority update: a ' + taker + ' reservation took your ' + fmtTime(b.start) + '–' + fmtTime(b.end) +
    ' ' + needLabel(type).toLowerCase() + '. Nothing else was open, so please choose another time.';
}
function priorityNoticeHtml(b) {
  const notice = priorityNoticeOf(b);
  if (!notice) return '';
  return '<p class="reservation-note priority-notice ' + esc(notice.kind) + '" role="note"><strong>Priority update</strong> ' + esc(priorityNoticeText(b)) + '</p>';
}

function myRequestRowHtml(b, date, featured) {
  const active = b.status === 'pending' || b.status === 'approved';
  const featureClass = featured ? (b.status === 'approved' ? ' featured-approved' : b.status === 'pending' ? ' featured-pending' : '') : '';
  const reservedFor = reservedForValue(b);
  // A reservation that is only one 30-minute block long cannot be shortened;
  // finishing that early simply means cancelling it.
  const canEndEarly = b.status === 'approved' && endEarlyOptions(b).length > 0;
  return '<article class="req-row reservation-card' + featureClass + '">' +
    '<div class="reservation-card-head"><time class="reservation-time">' + esc(fmtDate(b.date)) + ' · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + '</time>' + myRequestStatusHtml(b, date) + '</div>' +
    '<div class="reservation-meta"><span>' + esc(needsSummary(b)) + '</span><span aria-hidden="true">/</span><span>' + esc(bookingPurposeText(b)) + '</span>' + (reservedFor ? '<span>Reserved for: ' + esc(reservedFor) + '</span>' : '') + '</div>' +
    (endedEarly(b) ? '<p class="reservation-note">Ended early · originally booked until ' + esc(fmtTime(b.endedEarlyFrom)) + '</p>' : '') +
    priorityNoticeHtml(b) +
    (b.status === 'overridden' ? '<div class="req-actions"><button type="button" class="btn small primary" data-act="my-rebook" data-id="' + esc(b.id) + '">Reserve another time</button></div>' : '') +
    (active ? '<div class="req-actions">' +
      (canEndEarly ? '<button type="button" class="end-early-btn" data-act="my-end-early" data-id="' + esc(b.id) + '">End early</button>' : '') +
      '<button type="button" class="cancel-request-btn" data-act="my-cancel" data-id="' + esc(b.id) + '">' + (b.status === 'approved' ? 'Cancel reservation' : 'Cancel request') + '</button></div>' : '') +
    '</article>';
}

/* ================= calendar-first reservation popup ================= */

function ensureSignupDraft() {
  if (ui.signup) return;
  ui.signup = {
    date: selectedDate(),
    name: localStorage.getItem(NAME_KEY) || '',
    needs: { room: false, whiteboard: false, tv: false },
    preferredRoom: null,
    start: null,
    end: null,
    windowIdx: null,
    purpose: 'contact',
    purposeOther: '',
    reservedFor: '',
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
  const reservedFor = document.getElementById('su-reserved-for');
  if (name) d.name = name.value;
  if (note) d.note = note.value;
  if (reservedFor) {
    d.reservedFor = reservedFor.value;
    if (d.purpose === 'other') d.purposeOther = reservedFor.value;
  }
}

function signupComparable(d) {
  if (!d) return '';
  return JSON.stringify({
    date: d.date || '', name: d.name || '', needs: d.needs, preferredRoom: d.preferredRoom || null,
    start: d.start, end: d.end, windowIdx: d.windowIdx,
    purpose: d.purpose, purposeOther: d.purposeOther || '', reservedFor: d.reservedFor || '', certainty: d.certainty,
    note: d.note || ''
  });
}

function selectMemberEnd(el) {
  const selection = ui.memberSelection;
  const end = el.dataset.end || el.value;
  if (!selection || !end || selection.date !== el.dataset.date || selection.type !== el.dataset.type || selection.windowIdx !== Number(el.dataset.period)) return;
  const period = bookingWindows(selection.date)[selection.windowIdx];
  if (!period || minsOfDay(end) <= minsOfDay(selection.start) || minsOfDay(end) > minsOfDay(period.end) || !isValidBookingRange(selection.date, selection.start, end)) {
    addBanner('Please choose an end time after the start time in the same reservation period.', true);
    ui.endPrompt = null;
    render();
    return;
  }
  if (!freeUnitsForType(selection.type, selection.date, selection.start, end, null).length) {
    // Nothing open. If every reservation in the way is an Other, a Contact or
    // New Member may take it, so offer that instead of a dead end.
    if (overrideCandidate(selection.type, selection.date, selection.start, end)) {
      selection.end = end;
      ui.endPrompt = null;
      ui.availabilityConflict = null;
      ui.selectionConfirm = { date: selection.date, type: selection.type, start: selection.start, end: end, override: true };
      render();
      return;
    }
    ui.availabilityConflict = {
      date: selection.date,
      type: selection.type,
      start: selection.start,
      attemptedEnd: end,
      suggestedEnd: shorterAvailableEnd(selection.type, selection.date, selection.start, end)
    };
    selection.end = null;
    ui.endPrompt = null;
    ui.selectionConfirm = null;
    render();
    return;
  }
  selection.end = end;
  ui.endPrompt = null;
  ui.availabilityConflict = null;
  ui.selectionConfirm = { date: selection.date, type: selection.type, start: selection.start, end: end };
  render();
}

function closeEndPrompt() {
  const key = ui.returnFocusKey;
  ui.endPrompt = null;
  ui.returnFocusKey = null;
  render();
  restoreFocusKey(key);
}

function closeAvailabilityDetails() {
  const key = ui.returnFocusKey;
  ui.availabilityDetails = null;
  ui.returnFocusKey = null;
  render();
  restoreFocusKey(key);
}

function closeBookingDetails() {
  const key = ui.returnFocusKey;
  ui.bookingDetails = null;
  ui.returnFocusKey = null;
  render();
  restoreFocusKey(key);
}

function restoreFocusKey(key) {
  requestAnimationFrame(() => {
    const target = key ? Array.from(document.querySelectorAll('[data-focus-key]')).find(node => node.dataset.focusKey === key) : null;
    if (target) target.focus();
  });
}

function showAvailabilityDetails(el) {
  const date = el.dataset.date;
  const type = el.dataset.type;
  const start = el.dataset.start;
  const end = el.dataset.end;
  if (!upcomingBookingDates().includes(date) || !NEED_TYPES.some(item => item.id === type) || !start || !end) return;
  ui.availabilityDetails = { date, type, start, end };
  ui.returnFocusKey = el.dataset.focusKey || null;
  render();
}

function openBookingDetails(el) {
  const date = el.dataset.date;
  const type = el.dataset.type;
  const start = el.dataset.start;
  const booking = el.dataset.booking ? bookingByIdSafe(el.dataset.booking) : null;
  if (!booking || !upcomingBookingDates().includes(date) || !NEED_TYPES.some(item => item.id === type) || !start) return;
  ui.bookingDetails = { id: booking.id, date, type, start, unit: el.dataset.unit || '' };
  ui.returnFocusKey = el.dataset.focusKey || null;
  render();
}

function reserveFromBookingDetails() {
  const details = ui.bookingDetails;
  if (!details) return;
  const focusKey = ui.returnFocusKey;
  ui.bookingDetails = null;
  reserveFromHomeOverview({ dataset: { date: details.date, type: details.type, start: details.start, focusKey } });
}

function reserveFromHomeOverview(el) {
  const date = el.dataset.date;
  const type = el.dataset.type;
  const start = el.dataset.start;
  const periodIdx = windowIndexForStart(date, start);
  if (!upcomingBookingDates().includes(date) || !NEED_TYPES.some(item => item.id === type) || periodIdx < 0) return;
  ui.selectedDate = date;
  ui.memberSelection = { date, type, start, end: null, windowIdx: periodIdx };
  ui.availabilityConflict = null;
  ui.bookingDetails = null;
  ui.selectionConfirm = null;
  ui.endPrompt = { date, type, start, windowIdx: periodIdx };
  ui.returnFocusKey = el.dataset.focusKey || null;
  ui.tab = 'home';
  render();
}

function clearHomeReservationState() {
  ui.memberSelection = null;
  ui.availabilityConflict = null;
  ui.selectionConfirm = null;
  ui.endPrompt = null;
  ui.availabilityDetails = null;
  ui.bookingDetails = null;
  ui.returnFocusKey = null;
}

function openMemberDetails(override) {
  const selected = ui.memberSelection;
  if (!selected || !isValidBookingRange(selected.date, selected.start, selected.end)) return;
  let takeover = null;
  if (override) {
    const candidate = overrideCandidate(selected.type, selected.date, selected.start, selected.end);
    if (!candidate) {
      addBanner('That time changed while you were choosing. Please pick it again.', true);
      clearHomeReservationState();
      render();
      return;
    }
    takeover = {
      unitId: candidate.unit.id,
      unitLabel: candidate.unit.label,
      names: Array.from(new Set(candidate.holders.map(b => b.name)))
    };
  }
  ui.selectedDate = selected.date;
  ui.returnFocusKey = 'member-continue';
  ui.selectionConfirm = null;
  ui.signup = {
    date: selected.date,
    name: localStorage.getItem(NAME_KEY) || '',
    resourceType: selected.type,
    start: selected.start,
    end: selected.end,
    purpose: 'contact',
    purposeOther: '',
    reservedFor: '',
    override: takeover
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
  // Closing the reservation popup without sending it keeps the chosen time,
  // so bring its confirmation back rather than dropping them on the page.
  const selection = ui.memberSelection;
  if (selection && selection.start && selection.end) {
    ui.selectionConfirm = {
      date: selection.date,
      type: selection.type,
      start: selection.start,
      end: selection.end,
      override: !freeUnitsForType(selection.type, selection.date, selection.start, selection.end, null).length
    };
  }
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
  const choices = d.override ? PURPOSES.filter(p => OVERRIDE_PURPOSES.includes(p.id)) : PURPOSES;
  const limit = d.purpose === 'other' ? 240 : 120;
  const label = reservedForLabel(d.purpose);
  const placeholder = d.purpose === 'other' ? 'Short description' : 'Name';
  return '<div class="purpose-grid">' + choices.map(p =>
    '<button type="button" class="purpose-chip purpose-' + esc(p.id) + (d.purpose === p.id ? ' active' : '') + '" data-act="su-purpose" data-id="' + p.id + '" aria-pressed="' + (d.purpose === p.id ? 'true' : 'false') + '"><span class="purpose-swatch" aria-hidden="true"></span>' + esc(p.rank + '. ' + p.label) + '</button>'
  ).join('') + '</div>' +
  '<label class="fld purpose-other-label" for="su-reserved-for">' + esc(label) + '</label><input class="purpose-other-field" type="text" id="su-reserved-for" value="' + esc(d.reservedFor || (d.purpose === 'other' ? d.purposeOther : '')) + '" placeholder="' + esc(placeholder) + '" maxlength="' + limit + '" required>';
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
  const date = d.date || selectedDate();

  return '<div class="modal-backdrop" role="presentation"><section class="booking-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-dialog-title" aria-describedby="booking-dialog-summary">' +
    '<div class="booking-dialog-head"><div><div class="booking-kicker">' + esc(fmtDate(date)) + '</div><h2 id="booking-dialog-title">Reserve this time</h2></div>' +
    '<button type="button" class="modal-close" data-act="su-close" aria-label="Close reservation popup">&times;</button></div>' +
    '<p class="booking-time-summary" id="booking-dialog-summary"><strong>' + esc(needLabel(d.resourceType)) + '</strong> · ' + esc(fmtTime(d.start)) + '–' + esc(fmtTime(d.end)) + '</p>' +
    (d.override
      ? '<div class="override-offer" role="note"><p>This takes <strong>' + esc(d.override.unitLabel) + '</strong> from ' + esc(d.override.names.join(', ')) + '. Only Contact and New Member can do this, and they will be told.</p></div>'
      : '<p class="hint booking-approval-hint">Reservations are confirmed right away while space is open. If you finish early, end the reservation in My reservations so the room shows as free.</p>') +
    '<form data-act="su-submit">' +
    '<label class="fld" for="su-name">Your name</label>' +
    '<input type="text" id="su-name" value="' + esc(d.name) + '" placeholder="Full name" autocomplete="name" required>' +
    '<div class="fld">Purpose</div>' + purposeChipsHtml(d) +

    '<div class="modal-actions"><button type="button" class="btn" data-act="su-close">Cancel</button>' +
    '<button class="btn primary" type="submit"' + (ui.submitting ? ' disabled' : '') + '>' +
    (ui.submitting ? 'Submitting…' : 'Reserve now') + '</button></div>' +
    '</form></section></div>';
}

async function submitSignup(form) {
  if (ui.submitting) return; // double-submit guard
  if (demoMode()) { addBanner('Sample preview only — no reservation was saved.'); return; }
  syncSignupDraft();
  const d = ui.signup;
  const date = d.date || selectedDate();
  const name = (d.name || '').trim();
  const reservedFor = (d.reservedFor || (d.purpose === 'other' ? d.purposeOther : '') || '').trim();

  if (!subscribedDateKey || subscribedDateKey !== upcomingBookingDates().join('|') || !upcomingBookingDates().includes(date)) {
    addBanner('The schedule changed overnight. Reload the app and choose the time again.', true);
    return;
  }

  if (!name) { addBanner('Please enter your name.', true); return; }
  if (!d.start || !d.end) { addBanner('Please choose a start and end time.', true); return; }
  if (!isValidBookingRange(date, d.start, d.end)) { addBanner('That time is outside the available reservation periods. Please choose a new time.', true); return; }
  if (!d.purpose) { addBanner('Please choose a purpose.', true); return; }
  if (!/[\p{L}\p{N}]/u.test(reservedFor)) { addBanner(reservedForLabel(d.purpose) + ' is required.', true); return; }
  if (reservedFor.length > (d.purpose === 'other' ? 240 : 120)) { addBanner(reservedForLabel(d.purpose) + ' is too long.', true); return; }
  if (!fb || !fb.auth.currentUser) {
    addBanner('The shared schedule is still connecting. Wait a moment, then try again.', true);
    return;
  }

  if (d.override && !OVERRIDE_PURPOSES.includes(d.purpose)) {
    addBanner('Taking a reserved time needs a Contact or New Member purpose.', true);
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
      purposeOther: d.purpose === 'other' ? reservedFor : '',
      reservedFor: reservedFor
    });
    addMyBookingId(result.bookingId || id);
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage full/blocked */ }
    ui.signup = null;
    ui.signupBaseline = null;
    ui.returnFocusKey = null;
    ui.memberSelection = null;
    addBanner(result.moved
      ? 'Reserved with priority. The reservation that was here moved to another ' + needLabel(d.resourceType).toLowerCase() + '.'
      : result.overrodeBookingId
        ? 'Reserved with priority. The reservation that was here was released and told why.'
        : result.status === 'approved'
          ? 'Reserved. Your time is now on the schedule.'
          : 'Request saved. Check My reservations for its status.');
    setSyncPill(true, 'Saved');
  } catch (error) {
    const code = String(error && error.code || '').replace(/^functions\//, '');
    if (code === 'already-exists' && d && d.resourceType) {
      const periodIdx = windowIndexForStart(date, d.start);
      ui.signup = null;
      ui.signupBaseline = null;
      ui.returnFocusKey = null;
      ui.memberSelection = { date, type: d.resourceType, start: d.start, end: null, windowIdx: periodIdx };
      ui.availabilityConflict = {
        date,
        type: d.resourceType,
        start: d.start,
        attemptedEnd: d.end,
        suggestedEnd: error && error.details && error.details.suggestedEnd
          ? error.details.suggestedEnd
          : shorterAvailableEnd(d.resourceType, date, d.start, d.end)
      };
    } else addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.submitting = false;
    render();
  }
}

/* ================= Admin tab ================= */

function renderAdmin() {
  if (!adminUnlocked()) return renderAdminLock();
  if (!scheduleReady) {
    return '<section class="admin-workspace"><div class="card admin-header-card"><div class="eyebrow">Admin workspace</div><h1>Confirming the shared schedule.</h1><p class="section-note">Approval controls will appear after current bookings and availability are verified.</p></div><div class="schedule-loading" role="status" aria-live="polite"><span aria-hidden="true"></span>Loading protected Admin workspace</div></section>';
  }
  const date = selectedDate();
  if (!demoMode()) loadAdminNotes(date);
  const queue = pendingQueue(date);
  if (!queue.some(b => b.id === ui.adminSelectedId)) ui.adminSelectedId = queue.length ? queue[0].id : null;
  return '<section class="admin-workspace">' + (demoMode() ? '<div class="demo-notice">Sample Admin preview — scheduling and approval controls are read-only here.</div>' : '') + renderAdminHeader(date) +
    '<div class="admin-command"><aside class="admin-queue-panel">' + renderAdminQueue(date, queue) + '</aside>' +
    '<section class="admin-context-panel">' + renderAdminSelectedRequest(date) + renderAdminDayOverview(date) + '</section></div>' +
    (demoMode() ? '' : '<div class="admin-tools-grid">' + renderAdminAddForm(date) + renderAdminHousekeeping() + '</div>') + '</section>' + endEarlySheetHtml();
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

function renderAdminHeader(date) {
  const dayBookings = bookingsForDate(date);
  const pending = dayBookings.filter(b => b.status === 'pending').length;
  const approved = dayBookings.filter(b => b.status === 'approved').length;
  const waiting = dayBookings.filter(b => b.status === 'pending' && waitingPositionFor(b, date) !== null).length;
  return '<div class="card admin-header-card">' +
    '<div class="admin-header-main"><div><div class="eyebrow">Admin workspace</div><h1>Study Rooms Admin</h1><p>' + esc(fmtDate(date)) + ' · Instant reservations</p></div>' +
    '<div class="admin-counts"><span><strong>' + pending + '</strong> Pending</span><span><strong>' + approved + '</strong> Approved</span><span><strong>' + waiting + '</strong> In line</span></div>' +
    (demoMode() ? '<span class="hint">Read-only sample</span>' : '<button class="btn small danger" data-act="admin-lock">Lock admin</button>') +
    '</div><div class="admin-header-date">' + dateSelectorHtml() + '</div></div>';
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

function renderAdminQueue(date, items) {
  items = items || pendingQueue(date);
  let html = '<div class="card admin-queue-card"><div class="eyebrow">Priority queue</div><h2>Pending requests <span class="queue-total">' + items.length + '</span></h2>';
  if (!items.length) return html + '<p class="hint">No pending requests right now.</p></div>';
  items.forEach((b, index) => {
    const selected = b.id === ui.adminSelectedId;
    const pos = waitingPositionFor(b, date);
    html += '<button type="button" class="admin-queue-item' + (selected ? ' selected' : '') + '" data-act="admin-select-request" data-id="' + esc(b.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<span class="admin-priority">' + (index + 1) + ' · ' + esc(purposeLabel(b.purpose)) + '</span>' +
      '<span class="admin-queue-name"><strong>' + esc(b.name) + '</strong><time>' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + '</time></span>' +
      '<span class="admin-queue-meta">' + esc(needsSummary(b)) + (pos !== null ? ' · In line ' + ordinal(pos) : '') + '</span></button>';
  });
  return html + '</div>';
}

function renderAdminSelectedRequest(date) {
  const booking = ui.adminSelectedId ? bookingByIdSafe(ui.adminSelectedId) : null;
  if (!booking || booking.status !== 'pending' || booking.date !== date) {
    return '<div class="card admin-selected-card"><div class="eyebrow">Selected request</div><h2>Queue is clear</h2><p class="hint">New Saturday requests will appear here automatically.</p></div>';
  }
  const openCounts = neededTypesOf(booking).map(type => {
    const count = freeUnitsForType(type, date, booking.start, booking.end, booking.id).length;
    return count + ' ' + needLabel(type).toLowerCase() + (count === 1 ? '' : 's') + ' open for the full range';
  }).join(' · ');
  const certainty = booking.certainty === 'confirmed' ? '<span class="badge-cert confirmed">Confirmed</span>' : booking.certainty === 'tentative' ? '<span class="badge-cert tentative">Tentative</span>' : '';
  const waiting = waitingPositionFor(booking, date);
  const hint = certaintyHint(booking, date);
  return '<div class="card admin-selected-card"><div class="eyebrow">Selected request</div><h2>' + esc(booking.name) + '</h2>' +
    '<p class="selected-request-time">' + esc(needsSummary(booking)) + ' · ' + esc(fmtTime(booking.start)) + '–' + esc(fmtTime(booking.end)) + '</p>' +
    '<p class="section-note">' + certainty + (waiting !== null ? ' <span class="badge status-waiting">In line — ' + ordinal(waiting) + '</span>' : '') + '</p>' +
    '<p class="section-note">' + esc(bookingPurposeText(booking)) + (booking.preferredRoom ? ' · Preferred: ' + esc(unitLabel('room', booking.preferredRoom)) : '') + ' · Requested ' + esc(fmtDateTime(booking.createdAt)) + '</p>' +
    '<p class="availability-note">' + esc(openCounts) + '</p>' +
    (hint ? '<p class="conflict-note">' + esc(hint) + '</p>' : '') +
    (ui.adminNotes[booking.id] ? '<p class="private-note">Private note: ' + esc(ui.adminNotes[booking.id]) + '</p>' : '') +
    assignmentUiHtml(booking, date) + '</div>';
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
    if (/expired|locked|permission/i.test(error.message || '')) {
      sessionStorage.removeItem(ADMIN_KEY);
      ui.adminNotes = {};
      ui.adminNotesDate = null;
      ui.adminSelectedId = null;
      ui.adminAssign = {};
      ui.adminForm = null;
      ui.adminReapproveId = null;
      ui.adminActionId = null;
      ui.adminSubmitting = false;
      if (adminExpiryTimer) clearTimeout(adminExpiryTimer);
      adminExpiryTimer = null;
      render();
    }
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
      const recommendation = (u.id === recommendedId) ? ' · Recommended' : '';
      const cls = 'unit-pill' + (isSel ? ' active' : '') + (!isFree ? ' disabled' : '');
      const title = occupant ? (' title="' + esc(occupant.name) + '"') : '';
      return '<button type="button" class="' + cls + '"' + title +
        ' aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
        (isFree ? ' data-act="admin-assign" data-booking="' + esc(booking.id) + '" data-type="' + type + '" data-id="' + u.id + '"' : ' disabled') + '>' +
        esc(u.label) + recommendation + (occupant ? ' — ' + esc(occupant.name) : '') + '</button>';
    }).join('') + '</div></div>';
}

function assignmentUiHtml(booking, date) {
  if (demoMode()) return '<p class="hint">Sample preview only — this request cannot be approved or changed.</p>';
  // Build the draft on first render; also rebuild it if it's entirely empty
  // (drafted while everything was full) so a cancellation that just freed a
  // unit pre-selects the recommendation instead of waiting for a manual tap.
  if (!ui.adminAssign[booking.id] || neededTypesOf(booking).every(t => !ui.adminAssign[booking.id][t])) {
    ui.adminAssign[booking.id] = initialAssignmentFor(booking, date);
  }
  const assign = ui.adminAssign[booking.id];
  const busy = ui.adminActionId === booking.id;
  let html = '<div class="assign-ui">';
  neededTypesOf(booking).forEach(type => { html += assignPillRowHtml(booking, type, date, assign); });
  const ready = neededTypesOf(booking).every(t => !!assign[t]);
  html += '<div class="req-actions">' +
    '<button class="btn small ok" data-act="admin-approve" data-id="' + esc(booking.id) + '"' + (ready && !busy ? '' : ' disabled') + '>' + (busy ? 'Saving…' : 'Approve') + '</button>' +
    '<button class="btn small danger" data-act="admin-decline" data-id="' + esc(booking.id) + '"' + (busy ? ' disabled' : '') + '>Decline</button>' +
    '</div></div>';
  return html;
}

function pendingCardHtml(b, date) {
  const certBadge = b.certainty === 'confirmed'
    ? '<span class="badge-cert confirmed">Confirmed</span>'
    : b.certainty === 'tentative' ? '<span class="badge-cert tentative">Tentative</span>' : '';
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
  if (ui.adminActionId) return;
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
    if (occ) { addBanner(unitLabel(type, unitId) + ' was just taken by ' + occ.name + ' — pick another.', true); return; }
  }
  try {
    ui.adminActionId = id;
    render();
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
  } finally {
    ui.adminActionId = null;
    render();
  }
}
async function declineBooking(id) {
  if (ui.adminActionId) return;
  const b = state.bookings[id];
  if (!b) return;
  try {
    ui.adminActionId = id;
    render();
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', { action: 'decline', bookingId: id });
    delete ui.adminAssign[id];
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.adminActionId = null;
    render();
  }
}

/* ---- 2. Day overview ---- */

function renderAdminDayOverview(date) {
  let html = '<div class="card"><h2>Day overview</h2>' +
    '<p class="section-note">Approved assignments appear by numbered unit. Pending requests remain unassigned in the queue until approval.</p>' +
    adminUnitCalendarHtml(date, ui.adminType) +
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
  if (!demoMode() && b.status === 'pending') {
    actions = '<button class="btn small ok" data-act="admin-approve" data-id="' + esc(b.id) + '">Approve</button>' +
      '<button class="btn small danger" data-act="admin-decline" data-id="' + esc(b.id) + '">Decline</button>';
  } else if (!demoMode() && b.status === 'approved') {
    actions = (endEarlyOptions(b).length ? '<button class="btn small" data-act="admin-end-early" data-id="' + esc(b.id) + '">End early</button>' : '') +
      '<button class="btn small danger" data-act="admin-cancel" data-id="' + esc(b.id) + '">Cancel</button>';
  } else if (!demoMode() && (b.status === 'declined' || b.status === 'cancelled')) {
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
  if (ui.adminActionId) return;
  const b = state.bookings[id];
  if (!b) return;
  if (!confirm('Cancel the approved booking for ' + b.name + '?')) return;
  try {
    ui.adminActionId = id;
    render();
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', { action: 'cancel', bookingId: id });
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.adminActionId = null;
    render();
  }
}

async function adminEndBookingEarly(id, end) {
  if (demoMode()) { addBanner('Sample preview only — nothing was changed.'); return; }
  if (ui.adminActionId) return;
  const b = state.bookings[id];
  if (!b || b.status !== 'approved' || !endEarlyOptions(b).includes(end)) return;
  try {
    ui.adminActionId = id;
    render();
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', { action: 'end-early', bookingId: id, end: end });
    ui.endEarly = null;
    addBanner(b.name + '\u2019s reservation now ends at ' + fmtTime(end) + '.');
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.adminActionId = null;
    render();
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
  html += '<div class="time-period-list admin-time-periods">';
  bookingWindows(d.date).forEach((period, periodIdx) => {
    const points = periodTimePoints(period);
    const inPeriod = d.windowIdx === periodIdx;
    const startValue = inPeriod ? d.start : '';
    const endValue = inPeriod ? d.end : '';
    html += '<details class="time-period" name="admin-reservation-period"' + (inPeriod || (!d.start && periodIdx === 0) ? ' open' : '') + '><summary><span><strong>' + esc(period.label) + '</strong><small>Start times ' + esc(fmtTime(period.start)) + '–' + esc(fmtTime(hhmmOfMins(minsOfDay(period.end) - 30))) + '</small></span><span class="period-summary">' + (inPeriod && d.end ? esc(fmtTime(d.start) + '–' + fmtTime(d.end)) : 'Choose time') + '</span></summary>' +
      '<div class="time-range-controls"><label for="af-start-' + periodIdx + '">Start time<select id="af-start-' + periodIdx + '" data-chg="af-start" data-period="' + periodIdx + '"><option value="">Choose start</option>' + points.slice(0, -1).map(start => '<option value="' + start + '"' + (startValue === start ? ' selected' : '') + '>' + esc(fmtTime(start)) + '</option>').join('') + '</select></label>' +
      '<label for="af-end-' + periodIdx + '">End time<select id="af-end-' + periodIdx + '" data-chg="af-end" data-period="' + periodIdx + '"' + (!startValue ? ' disabled' : '') + '><option value="">Choose end</option>' + points.slice(1).map(end => '<option value="' + end + '"' + (endValue === end ? ' selected' : '') + (startValue && minsOfDay(end) <= minsOfDay(startValue) ? ' disabled' : '') + '>' + esc('End at ' + fmtTime(end)) + '</option>').join('') + '</select></label></div></details>';
  });
  return html + '</div>' + (d.start && d.end ? '<p class="selection-summary" aria-live="polite">Selected: ' + esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) + '</p>' : '');
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

    '<div style="margin-top:16px"><button class="btn primary big" type="submit"' + (ui.adminSubmitting ? ' disabled' : '') + '>' + (ui.adminSubmitting ? 'Adding booking…' : 'Add booking (approved)') + '</button></div>' +
    '</form></div>';
}

async function submitAdminAdd() {
  if (ui.adminSubmitting) return;
  syncAdminFormDraft();
  const d = ui.adminForm;
  const name = (d.name || '').trim();
  const note = (d.note || '').trim();
  const purposeOther = (d.purposeOther || '').trim();
  const needTypes = NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]);

  if (!subscribedDateKey || subscribedDateKey !== upcomingBookingDates().join('|') || !upcomingBookingDates().includes(d.date)) {
    addBanner('The schedule changed overnight. Reload the app and choose the time again.', true);
    return;
  }

  if (!name) { addBanner('Please enter a name.', true); return; }
  if (!needTypes.length) { addBanner('Please choose at least one thing needed.', true); return; }
  if (!d.start || !d.end) { addBanner('Please choose a start and end time.', true); return; }
  if (!isValidBookingRange(d.date, d.start, d.end)) { addBanner('That time is outside the available reservation periods. Please choose a new time.', true); return; }
  if (d.purpose === 'other' && !purposeOther) { addBanner('Please describe the purpose.', true); return; }
  for (const t of needTypes) {
    if (!d.assign[t]) { addBanner('Please assign a ' + needLabel(t).toLowerCase() + '.', true); return; }
    const occ = unitOccupant(t, d.assign[t], d.date, d.start, d.end, '__new__');
    if (occ) { addBanner(unitLabel(t, d.assign[t]) + ' was just taken by ' + occ.name + ' — pick another.', true); return; }
  }

  try {
    ui.adminSubmitting = true;
    render();
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
    addBanner('Booking added and approved for ' + name + '.');
    ui.adminForm = null;
    ui.adminNotesDate = null;
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.adminSubmitting = false;
    render();
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
  if (demoMode()) { addBanner('Sample preview only — nothing was cancelled.'); return; }
  const b = bookingByIdSafe(id);
  if (!b || (b.status !== 'pending' && b.status !== 'approved')) return;
  if (!confirm(b.status === 'approved' ? 'Cancel this approved reservation?' : 'Cancel this request?')) return;
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

/* Finishing early keeps the reservation and its history; only the ending
   moves back, which immediately frees the remaining slots for everyone. */
async function endMyBookingEarly(id, end) {
  if (demoMode()) { addBanner('Sample preview only — nothing was changed.'); return; }
  if (ui.submitting) return;
  const b = bookingByIdSafe(id);
  if (!b || b.status !== 'approved' || !endEarlyOptions(b).includes(end)) return;
  if (!fb || !fb.auth.currentUser || b.ownerUid !== fb.auth.currentUser.uid) {
    addBanner('Only the device that made this reservation can end it early. Ask an Admin for help with an older one.', true);
    return;
  }
  ui.submitting = true;
  render();
  try {
    setSyncPill(false, 'Saving');
    await callBackend('memberEndBookingEarly', { bookingId: id, end: end });
    ui.endEarly = null;
    addBanner('Ended at ' + fmtTime(end) + '. The rest of your time is now open for others.');
    setSyncPill(true, 'Saved');
  } catch (error) {
    addBanner(friendlyFirebaseError(error), true);
    setSyncPill(false, 'Save failed');
  } finally {
    ui.submitting = false;
    render();
  }
}

async function startAdminSession(pin) {
  ui.pinError = '';
  try {
    setSyncPill(false, 'Checking PIN');
    const result = await callBackend('adminStartSession', { pin: pin });
    sessionStorage.setItem(ADMIN_KEY, JSON.stringify({ token: result.sessionToken, expiresAt: result.expiresAt }));
    scheduleAdminExpiry(result.expiresAt);
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
  if (adminExpiryTimer) clearTimeout(adminExpiryTimer);
  adminExpiryTimer = null;
  sessionStorage.removeItem(ADMIN_KEY);
  ui.adminNotes = {};
  ui.adminNotesDate = null;
  ui.adminSelectedId = null;
  ui.adminAssign = {};
  ui.adminForm = null;
  ui.adminReapproveId = null;
  ui.adminActionId = null;
  ui.adminSubmitting = false;
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
  if (act === 'tab') {
    const nextTab = el.dataset.id;
    ui.tab = TABS.some(tab => tab.id === nextTab) ? nextTab : 'home';
    ui.pinError = '';
    render();
    requestAnimationFrame(() => {
      const activeTab = document.querySelector('.tab[data-id="' + ui.tab + '"]');
      if (activeTab) activeTab.focus();
    });
    return;
  }

  if (act === 'date-step') {
    const dates = upcomingBookingDates();
    const nextIndex = dates.indexOf(selectedDate()) + Number(el.dataset.id || 0);
    if (nextIndex < 0 || nextIndex >= dates.length) return;
    handleAction('select-date', { dataset: { id: dates[nextIndex] } });
    return;
  }

  if (act === 'select-date') {
    const date = el.dataset.id;
    if (upcomingBookingDates().indexOf(date) === -1) return;
    syncSignupDraft();
    if (ui.signup) { ui.signup.start = null; ui.signup.end = null; ui.signup.windowIdx = null; }
    syncAdminFormDraft();
    ui.adminForm = null;
    ui.selectedDate = date;
    ui.memberSelection = null;
    ui.endPrompt = null;
    ui.availabilityDetails = null;
    ui.bookingDetails = null;
    ui.availabilityConflict = null;
    ui.adminSelectedId = null;
    ui.adminAssign = {};
    ui.adminReapproveId = null;
    render();
    return;
  }

  /* ---- Home booking ---- */
  if (act === 'home-date-step') {
    const dates = upcomingBookingDates();
    const nextIndex = dates.indexOf(selectedHomeDate()) + Number(el.dataset.id || 0);
    if (nextIndex < 0 || nextIndex >= dates.length) return;
    clearHomeReservationState();
    ui.homeDate = dates[nextIndex];
    render();
    return;
  }
  if (act === 'home-overview-type') {
    if (!NEED_TYPES.some(type => type.id === el.dataset.id)) return;
    clearHomeReservationState();
    ui.homeOverviewType = el.dataset.id;
    render();
    return;
  }
  if (act === 'home-reserve-slot') { reserveFromHomeOverview(el); return; }
  if (act === 'home-taken-slot') { openBookingDetails(el); return; }
  if (act === 'member-end-time') { selectMemberEnd(el); return; }
  if (act === 'member-close-end-prompt') { closeEndPrompt(); return; }
  if (act === 'member-range-details') { showAvailabilityDetails(el); return; }
  if (act === 'member-close-sheet') { closeAvailabilityDetails(); return; }
  if (act === 'booking-details-close') { closeBookingDetails(); return; }
  if (act === 'booking-details-reserve') { reserveFromBookingDetails(); return; }
  if (act === 'booking-details-end-early') {
    const booking = bookingByIdSafe(el.dataset.id);
    if (!booking || !ownsBooking(booking) || booking.status !== 'approved' || !endEarlyOptions(booking).length) return;
    ui.bookingDetails = null;
    ui.endEarly = { id: booking.id };
    render();
    return;
  }
  if (act === 'booking-details-cancel') {
    const id = el.dataset.id;
    ui.bookingDetails = null;
    render();
    cancelMyBooking(id);
    return;
  }
  if (act === 'admin-type') {
    if (!NEED_TYPES.some(type => type.id === el.dataset.id)) return;
    ui.adminType = el.dataset.id;
    render();
    return;
  }
  if (act === 'member-clear') { clearHomeReservationState(); render(); return; }
  if (act === 'conflict-yes') {
    const conflict = ui.availabilityConflict;
    if (!conflict || !conflict.suggestedEnd) return;
    ui.memberSelection = { date: conflict.date, type: conflict.type, start: conflict.start, end: conflict.suggestedEnd, windowIdx: windowIndexForStart(conflict.date, conflict.start) };
    ui.availabilityConflict = null;
    ui.selectionConfirm = { date: conflict.date, type: conflict.type, start: conflict.start, end: conflict.suggestedEnd };
    render();
    return;
  }
  if (act === 'conflict-no') {
    const key = ui.returnFocusKey;
    clearHomeReservationState();
    render();
    restoreFocusKey(key);
    return;
  }
  if (act === 'member-continue') { openMemberDetails(false); return; }
  if (act === 'member-override') { openMemberDetails(true); return; }
  if (act === 'member-shorten') {
    const selection = ui.memberSelection;
    const end = el.dataset.end;
    if (!selection || !end || !isValidBookingRange(selection.date, selection.start, end)) return;
    selection.end = end;
    ui.availabilityConflict = null;
    ui.selectionConfirm = { date: selection.date, type: selection.type, start: selection.start, end: end };
    render();
    return;
  }
  if (act === 'su-close') { closeBookingModal(false); return; }
  if (act === 'my-rebook') {
    const booking = bookingByIdSafe(el.dataset.id);
    if (!booking) return;
    clearHomeReservationState();
    ui.tab = 'home';
    ui.homeDate = upcomingBookingDates().includes(booking.date) ? booking.date : null;
    ui.homeOverviewType = neededTypesOf(booking)[0] || 'room';
    render();
    return;
  }
  if (act === 'my-cancel') {
    cancelMyBooking(el.dataset.id);
    return;
  }
  if (act === 'my-end-early') {
    const booking = bookingByIdSafe(el.dataset.id);
    if (!booking || booking.status !== 'approved' || !endEarlyOptions(booking).length) return;
    ui.returnFocusKey = null;
    ui.endEarly = { id: booking.id };
    render();
    return;
  }
  if (act === 'end-early-close') { ui.endEarly = null; render(); return; }
  if (act === 'end-early-pick') {
    if (ui.endEarly && ui.endEarly.admin) adminEndBookingEarly(el.dataset.id, el.dataset.end);
    else endMyBookingEarly(el.dataset.id, el.dataset.end);
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
  if (act === 'su-purpose') { syncSignupDraft(); ensureSignupDraft(); ui.signup.purpose = el.dataset.id; ui.signup.reservedFor = ''; ui.signup.purposeOther = ''; render(); return; }
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
  if (act === 'admin-select-request') {
    const booking = bookingByIdSafe(el.dataset.id);
    if (!booking || booking.status !== 'pending' || booking.date !== selectedDate()) return;
    ui.adminSelectedId = booking.id;
    const selectedType = neededTypesOf(booking)[0];
    if (selectedType) ui.adminType = selectedType;
    render();
    return;
  }
  if (act === 'admin-assign') {
    const bookingId = el.dataset.booking;
    const b = bookingByIdSafe(bookingId);
    if (!b || b.date !== selectedDate() || (b.status !== 'pending' && ui.adminReapproveId !== b.id)) return;
    const type = el.dataset.type;
    const unitId = el.dataset.id;
    if (!neededTypesOf(b).includes(type) || !unitsForType(type).some(unit => unit.id === unitId)) return;
    if (unitOccupant(type, unitId, b.date, b.start, b.end, b.id)) return;
    if (!ui.adminAssign[bookingId]) ui.adminAssign[bookingId] = initialAssignmentFor(b, b.date);
    const assign = ui.adminAssign[bookingId];
    assign[type] = unitId;
    render();
    return;
  }
  if (act === 'admin-approve') { approveBooking(el.dataset.id); return; }
  if (act === 'admin-decline') { declineBooking(el.dataset.id); return; }
  if (act === 'admin-cancel') { cancelBooking(el.dataset.id); return; }
  if (act === 'admin-end-early') {
    const booking = bookingByIdSafe(el.dataset.id);
    if (!booking || booking.status !== 'approved' || !endEarlyOptions(booking).length) return;
    ui.endEarly = { id: booking.id, admin: true };
    render();
    return;
  }
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
  if (!el) return;
  if (el.dataset.chg === 'af-start') {
    syncAdminFormDraft(); ensureAdminFormDraft(selectedDate());
    const periodIdx = Number(el.dataset.period);
    const period = bookingWindows(ui.adminForm.date)[periodIdx];
    ui.adminForm.start = period && el.value ? el.value : null;
    ui.adminForm.end = null;
    ui.adminForm.windowIdx = ui.adminForm.start ? periodIdx : null;
    ui.adminForm.assign = { room: null, whiteboard: null, tv: null };
    render();
    return;
  }
  if (el.dataset.chg === 'af-end') {
    syncAdminFormDraft(); ensureAdminFormDraft(selectedDate());
    const d = ui.adminForm;
    const periodIdx = Number(el.dataset.period);
    const period = bookingWindows(d.date)[periodIdx];
    if (!period || d.windowIdx !== periodIdx || !d.start || !el.value || minsOfDay(el.value) <= minsOfDay(d.start) || minsOfDay(el.value) > minsOfDay(period.end)) {
      addBanner('Choose an end time after the start time in the same reservation period.', true);
      render();
      return;
    }
    d.end = el.value;
    d.assign = { room: null, whiteboard: null, tv: null };
    render();
    return;
  }
  if (!ui.signup) return;
  if (el.dataset.chg === 'su-end') {
    syncSignupDraft();
    ui.signup.end = el.value;
    render();
  }
});
document.addEventListener('keydown', e => {
  if (!ui.signup && !ui.endPrompt && !ui.availabilityDetails && !ui.bookingDetails && !ui.endEarly) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (ui.signup) closeBookingModal(false);
    else if (ui.endPrompt) closeEndPrompt();
    else if (ui.bookingDetails) closeBookingDetails();
    else if (ui.endEarly) { ui.endEarly = null; render(); }
    else closeAvailabilityDetails();
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
  const requestedTab = new URLSearchParams(location.search).get('tab');
  if (['mine', 'admin'].includes(requestedTab)) ui.tab = requestedTab;
  const cachedState = loadLocal();
  const cacheMatchesDates = !!(cachedState && Array.isArray(cachedState.queryDates) && cachedState.queryDates.join('|') === upcomingBookingDates().join('|'));
  // Never carry bookings from an expired date pair into the new schedule. The
  // realtime snapshot is the only code path allowed to stamp a new pair.
  // Demo is fixture-only: it must not read a prior live schedule from this
  // browser, even if the cache happens to match the upcoming dates.
  state = !demoMode() && cacheMatchesDates && cachedState ? cachedState : { bookings: {} };
  scheduleReady = demoMode() || cacheMatchesDates;
  render();
  if (adminUnlocked()) {
    try { scheduleAdminExpiry(JSON.parse(sessionStorage.getItem(ADMIN_KEY)).expiresAt); } catch (error) { sessionStorage.removeItem(ADMIN_KEY); }
  }

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

  const masthead = document.getElementById('masthead-home');
  const goHome = () => { ui.tab = 'home'; render(); };
  if (masthead) {
    masthead.addEventListener('click', goHome);
    masthead.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      goHome();
    });
  }
  if (demoMode()) return;
  setInterval(() => {
    if (!subscribedDateKey || subscribedDateKey === upcomingBookingDates().join('|')) return;
    syncSignupDraft();
    syncAdminFormDraft();
    const adminDraftDirty = ui.adminForm && (ui.adminForm.name || ui.adminForm.start || ui.adminForm.note || ui.adminForm.purposeOther);
    if (ui.signup || ui.submitting || ui.adminSubmitting || ui.adminActionId || adminDraftDirty) {
      if (!rolloverWarningShown) {
        rolloverWarningShown = true;
        addBanner('The schedule changed overnight. Finish or close the open form, then reload.', true);
      }
      return;
    }
    scheduleReady = false;
    location.reload();
  }, 60000);
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
