'use strict';

/* =====================================================================
   LV Zion Study Rooms: Admin workspace, standalone page.

   Carried over verbatim from the Admin experience in app.js (Plan 5,
   Lane 4). The member screens and the design picker are deliberately not
   here: this page is only the Admin workspace, and it loads no other
   project script or stylesheet, so it keeps working after app.js and
   styles.css are removed.

   The September 21 special schedule used to be applied at runtime by
   special-schedule-entry.js, which rewrote app.js before importing it.
   That loader is going away, so every one of its replacements is written
   out natively below (see isSpecialBookingDate, upcomingBookingDates,
   scheduleSegments and bookingDayLabel).

   Some UI strings copied from app.js contain the en dash and em dash the
   Admin screens already show today. They are written as escape
   sequences so this source file carries no literal dash characters
   while the rendered text stays identical.
   ===================================================================== */

/* ================= constants ================= */

const ADMIN_KEY = 'srs-admin-session';
const MY_BOOKINGS_KEY = 'srs-my-bookings';   // localStorage array of this device's own booking ids

/* Priority order, highest first. A Contact reservation outranks a New
   Member one, and both outrank Other. */
const PURPOSES = [
  { id: 'contact', label: 'Contact', rank: 1 },
  { id: 'new-member', label: 'New Member', rank: 2 },
  { id: 'other', label: 'Other', rank: 3 }
];
/* Admin-only addition, used solely on the "Add a booking" form (e.g. to
   hold a room for another use). Never offered to members. */
const ADMIN_PURPOSES = PURPOSES.concat([{ id: 'blocked', label: 'Room unavailable / reserved' }]);

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

/* Preferred-room pill choices on the Admin add form: null = "No preference". */
const PREFERRED_ROOM_CHOICES = [null, 'room-1', 'room-2', 'room-3', 'room-4'];

/* ================= state ================= */

let state = {
  bookings: {}    // id -> booking; may contain stale/invalid docs, always filter via bookingsList()
};
let ui = {
  selectedDate: null,
  adminType: 'room',      // resource displayed in the Admin calendar
  adminSelectedId: null,  // one pending request shown in the Admin detail pane
  endEarly: null,         // { id, admin }; "finished early" sheet
  pinError: '',
  adminAssign: {},        // bookingId -> { room, whiteboard, tv } draft unit picks
  adminReapproveId: null, // id of a declined/cancelled booking currently showing the assignment UI
  adminActionId: null,    // booking currently saving through a protected Admin action
  adminSubmitting: false, // prevents duplicate direct-add bookings
  adminForm: null,        // "Add a booking" form draft, created lazily by ensureAdminFormDraft()
  adminNotes: {},
  adminNotesDate: null,
  adminNotesLoading: false
};

let fb = null; // Firebase modules, authenticated user, and callable functions
let scheduleReady = false; // unverified empty data must never look like real availability
let adminExpiryTimer = null;
let scheduleRefreshTimer = null;
let subscribedDateKey = '';
let rolloverWarningShown = false;

/* ================= tiny helpers ================= */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
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

/* ---- September 21 special booking day. Applied natively here; app.js
   receives the same rules from special-schedule-entry.js at runtime. ---- */
const SPECIAL_BOOKING_DATE = '2026-09-21';
const SPECIAL_BOOKING_DATE_OPENS = '2026-09-13';
function isSpecialBookingDate(date) { return date === SPECIAL_BOOKING_DATE; }
function bookingDayLabel(date) {
  return dateObj(date).toLocaleDateString(undefined, { weekday: 'long' });
}
function upcomingBookingDates() {
  const dates = [upcomingTuesdayISO(), upcomingSaturdayISO()];
  const today = todayISO();
  if (today >= SPECIAL_BOOKING_DATE_OPENS && today <= SPECIAL_BOOKING_DATE) dates.push(SPECIAL_BOOKING_DATE);
  return [...new Set(dates)].sort();
}

function selectedDate() {
  const dates = upcomingBookingDates();
  if (dates.indexOf(ui.selectedDate) === -1) ui.selectedDate = dates[0];
  return ui.selectedDate;
}
function isSaturday(date) { return dateObj(date).getDay() === 6; }
function demoMode() { return new URLSearchParams(window.location.search).get('demo') === '1'; }

/* Every schedule segment is explicit so a selected range can never cross
   a service. Saturday holds all three services, Tuesday only the evening
   one, and the September 21 special day has its own shape. Reservable
   slots begin at 10:00 AM, so Saturday's first bookable start is 11:00 AM. */
function scheduleSegments(date) {
  if (isSpecialBookingDate(date)) return [
    { start: '10:00', end: '11:00', label: 'Morning service', service: true },
    { start: '11:00', end: '14:30', label: 'Late morning and early afternoon' },
    { start: '14:30', end: '15:30', label: 'Afternoon service', service: true },
    { start: '15:30', end: '23:00', label: 'Afternoon and evening' }
  ];
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
function rawBookingsList() {
  const live = Object.keys(state.bookings)
    .map(id => Object.assign({ id: id }, state.bookings[id]))
    .filter(isValidBooking);
  return demoMode() ? demoBookings() : live;
}
function publicScheduleRows(raw) {
  const publicRows = raw.filter(booking => !booking.ownerOnlyRecord);
  return publicRows.concat(raw.filter(booking => booking.ownerOnlyRecord && !publicRows.some(row => row.ownerDetail?.bookingId === booking.id)));
}
/* Every screen on this page sits behind the Admin lock, so the full Admin
   rows are the only view it ever needs. A locked page shows nothing. */
function bookingsList() {
  if (!adminUnlocked()) return [];
  return publicScheduleRows(rawBookingsList());
}
function bookingByIdSafe(id) {
  if (!adminUnlocked()) return null;
  return rawBookingsList().find(booking => booking.id === id) || null;
}

function demoBookings() {
  if (!demoMode()) return [];
  const dates = upcomingBookingDates();
  const tuesday = dates.find(date => dateObj(date).getDay() === 2);
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
    { id: 'demo-room-admin-held', date: tuesday, start: '12:00', end: '12:30', name: 'Admin Hold \u2014 Private', purpose: 'blocked', purposeOther: 'Internal staffing note', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-3', whiteboard: null, tv: null }, createdAt: created - 4500, decidedAt: created - 4400 },
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
  return neededTypesOf(b).map(needLabel).join(', ') || '\u2014';
}

/* ---- server-validated Admin session; sessionStorage clears when the
   browser session ends and the backend independently expires the token.
   The PIN itself is never stored, shown, or logged. ---- */
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

/* ---- this device's own requests (localStorage), so the day map still
   marks the Admin's own reservations the way it does today ---- */
function myBookingIds() {
  if (demoMode()) return ['demo-sat-room-mine', 'demo-room-4', 'demo-room-cancelled', 'demo-room-moved', 'demo-room-released'];
  try { const raw = localStorage.getItem(MY_BOOKINGS_KEY); return raw ? JSON.parse(raw) : []; }
  catch (e) { return []; }
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
   so cancellations self-heal the queue automatically. */
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

/* ================= admin assignment recommendation ================= */

function purposePriority(purpose) {
  return ({ contact: 0, 'new-member': 1, group: 2, 'study-member': 2, meeting: 2, other: 3 }[purpose] ?? 3);
}
function bookingPriority(b) { return purposePriority(b.purpose); }

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

/* "Tip: Elena is Confirmed, Daniel is Tentative", shown when this
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

/* ================= backend ================= */

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

/* The Admin schedule is read only while a validated session is open, and
   it is never written to this device's storage. */
async function refreshSchedule() {
  if (!fb || !fb.auth.currentUser) throw new Error('The secure connection is not ready yet.');
  if (!adminUnlocked()) throw new Error('Admin is locked.');
  const data = await callBackend('adminSchedule', { sessionToken: adminSessionToken() });
  const next = {};
  (Array.isArray(data?.bookings) ? data.bookings : []).forEach(booking => {
    const id = typeof booking?.id === 'string' && booking.id ? booking.id : String(booking?.key || '');
    if (id) next[id] = booking;
  });
  state.bookings = next;
  subscribedDateKey = upcomingBookingDates().join('|');
  scheduleReady = true;
  setSyncPill(true, 'Admin live');
  render();
  if (scheduleRefreshTimer) clearTimeout(scheduleRefreshTimer);
  scheduleRefreshTimer = setTimeout(() => {
    if (fb && !demoMode() && adminUnlocked()) refreshSchedule().catch(() => {});
  }, 15000);
  return data;
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
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const fnMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const app = appMod.initializeApp(config);

  const auth = authMod.getAuth(app);
  if (!auth.currentUser) await authMod.signInAnonymously(auth);

  const functions = fnMod.getFunctions(app, 'us-west1');
  fb = {
    auth,
    callables: {
      adminStartSession: fnMod.httpsCallable(functions, 'adminStartSession'),
      adminEndSession: fnMod.httpsCallable(functions, 'adminEndSession'),
      adminBookingAction: fnMod.httpsCallable(functions, 'adminBookingAction'),
      adminNoteAction: fnMod.httpsCallable(functions, 'adminNoteAction'),
      adminMigrateNotes: fnMod.httpsCallable(functions, 'adminMigrateNotes'),
      adminSchedule: fnMod.httpsCallable(functions, 'adminSchedule')
    }
  };
  setSyncPill(false, 'Connecting');
  // A locked page has no session to read the schedule with; unlocking is
  // what loads it (see startAdminSession).
  if (!adminUnlocked()) { setSyncPill(false, 'Locked'); render(); return; }
  try {
    await refreshSchedule();
  } catch (error) {
    addBanner('Could not connect to the shared schedule. Unlock again or reload the page.', true);
    setSyncPill(false, 'Reconnecting');
    render();
  }
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

  // The schedule can refresh while someone is typing in the add form or the
  // PIN field. Pull the current inputs into the draft before rebuilding so a
  // live update never erases unsaved Admin details.
  const activeBeforeRender = document.activeElement;
  const adminPinDraft = activeBeforeRender && activeBeforeRender.id === 'admin-pin-input' ? activeBeforeRender.value : '';
  const popupFocus = ui.endEarly && activeBeforeRender && activeBeforeRender.closest('.booking-dialog')
    ? { id: activeBeforeRender.id || '', act: activeBeforeRender.dataset.act || '', item: activeBeforeRender.dataset.id || '' }
    : null;
  const actionNode = activeBeforeRender && !activeBeforeRender.closest('.booking-dialog')
    ? activeBeforeRender.closest('[data-act]') : null;
  const fieldFocus = activeBeforeRender && !activeBeforeRender.closest('.booking-dialog') && activeBeforeRender.id ? {
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
  syncAdminFormDraft();
  document.body.classList.toggle('modal-open', !!ui.endEarly);
  document.body.classList.toggle('admin-workspace-open', adminUnlocked());

  app.innerHTML = renderAdmin();

  const masthead = document.querySelector('#masthead .head-in');
  const sheetOpen = !!ui.endEarly;
  if (masthead) masthead.inert = sheetOpen;
  app.querySelectorAll(':scope > .admin-workspace').forEach(node => { node.inert = sheetOpen; });
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
        if (!target) target = modal.querySelector('button, select, input');
        if (target) target.focus();
      }
    });
  }
}

function syncMastheadScheduleLink() {
  const scheduleLink = document.getElementById('masthead-schedule');
  if (!scheduleLink) return;
  scheduleLink.setAttribute('href', demoMode() ? '../tv.html?tv=1&demo=1' : '../tv.html?tv=1');
}

function dateSelectorHtml() {
  const dates = upcomingBookingDates();
  const date = selectedDate();
  const index = dates.indexOf(date);
  return '<div class="date-selector" role="group" aria-label="Choose reservation date">' +
    '<button type="button" class="date-arrow" data-act="date-step" data-id="-1" aria-label="Previous reservation date"' + (index <= 0 ? ' disabled' : '') + '><span aria-hidden="true">‹</span></button>' +
    '<div class="date-current" aria-live="polite"><strong>' + esc(bookingDayLabel(date)) + ', ' + esc(fmtHeaderDate(date)) + '</strong><span>Confirmed instantly when open</span></div>' +
    '<button type="button" class="date-arrow" data-act="date-step" data-id="1" aria-label="Next reservation date"' + (index >= dates.length - 1 ? ' disabled' : '') + '><span aria-hidden="true">›</span></button>' +
    '</div>';
}

/* Read-only day map with Admin status styling. */
function dayMapGridHtml(date, type) {
  const units = unitsForType(type);
  let html = '<div class="member-calendar-grid">' +
    '<div class="member-calendar-row unit-header"><div class="member-time"><small>Time</small></div><div class="member-squares" style="--capacity:' + units.length + '">' + units.map(unit => '<span>' + esc(String(unit.num)) + '</span>').join('') + '</div></div>';
  scheduleSegments(date).forEach(window => {
    if (window.service) {
      html += '<div class="member-service"><span>' + esc(window.label) + '</span><span>' + esc(fmtTime(window.start)) + '\u2013' + esc(fmtTime(window.end)) + '</span></div>';
      return;
    }
    slotStarts(window).forEach(start => {
      const end = hhmmOfMins(minsOfDay(start) + 30);
      html += '<div class="member-calendar-row"><div class="member-time">' + esc(fmtTime(start)) + '</div><div class="member-squares" style="--capacity:' + units.length + '">' + units.map(unit => {
        const occupant = unitOccupant(type, unit.id, date, start, end, null);
        const status = memberSlotStatus(type, date, start, unit.id);
        return '<div class="member-square ' + status + '" aria-label="' + esc(fmtTime(start) + ', ' + unit.label + ', ' + (occupant ? 'reserved by ' + occupant.name : status)) + '">' + (occupant ? esc(occupant.name) : '') + '</div>';
      }).join('') + '</div></div>';
    });
  });
  return html + '</div>';
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

/* ---- finishing early ---- */

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
    '<p class="booking-time-summary"><strong>' + esc(fmtTime(b.start)) + '\u2013' + esc(fmtTime(b.end)) + '</strong> · ' + esc(needsSummary(b)) + '</p>' +
    '<p class="hint">Choose when you actually finished. The time after that is released right away, so everyone sees it as open.</p>' +
    '<div class="end-time-list" role="group" aria-label="Choose a new ending">' + options.map(end =>
      '<button type="button" class="end-time-choice' + (end === nowOption ? ' end-time-now' : '') + '" data-act="end-early-pick" data-id="' + esc(b.id) + '" data-end="' + end + '">' +
      '<strong>End at ' + esc(fmtTime(end)) + (end === nowOption ? ' · now' : '') + '</strong>' +
      '<span>Frees ' + esc(fmtTime(end)) + '\u2013' + esc(fmtTime(b.end)) + '</span></button>').join('') +
    '</div><div class="modal-actions"><button type="button" class="btn" data-act="end-early-close">Keep my time</button></div></section></div>';
}

function adminUnitCalendarHtml(date, type) {
  const units = unitsForType(type);
  return '<section class="member-calendar admin-unit-calendar" aria-label="' + esc(needLabel(type)) + ' schedule">' +
    '<div class="member-calendar-heading"><h2>' + esc(needLabel(type)) + ' day map</h2><span>' + units.length + ' units</span></div>' +
    memberResourceToggleHtml(type, 'admin-type') +
    '<div class="member-calendar-scroll">' + dayMapGridHtml(date, type) + '</div></section>';
}

/* ================= Admin workspace ================= */

function renderAdmin() {
  if (!adminUnlocked()) return renderAdminLock();
  if (!scheduleReady) {
    return '<section class="admin-workspace"><div class="card admin-header-card"><div class="eyebrow">Admin workspace</div><h1>Confirming the shared schedule.</h1><p class="section-note">Approval controls will appear after current bookings and availability are verified.</p></div><div class="schedule-loading" role="status" aria-live="polite"><span aria-hidden="true"></span>Loading protected Admin workspace</div></section>';
  }
  const date = selectedDate();
  if (!demoMode()) loadAdminNotes(date);
  const queue = pendingQueue(date);
  if (!queue.some(b => b.id === ui.adminSelectedId)) ui.adminSelectedId = queue.length ? queue[0].id : null;
  return '<section class="admin-workspace">' + (demoMode() ? '<div class="demo-notice">Sample Admin preview \u2014 scheduling and approval controls are read-only here.</div>' : '') + renderAdminHeader(date) +
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
      '<span class="admin-queue-name"><strong>' + esc(b.name) + '</strong><time>' + esc(fmtTime(b.start)) + '\u2013' + esc(fmtTime(b.end)) + '</time></span>' +
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
    '<p class="selected-request-time">' + esc(needsSummary(booking)) + ' · ' + esc(fmtTime(booking.start)) + '\u2013' + esc(fmtTime(booking.end)) + '</p>' +
    '<p class="section-note">' + certainty + (waiting !== null ? ' <span class="badge status-waiting">In line \u2014 ' + ordinal(waiting) + '</span>' : '') + '</p>' +
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
        esc(u.label) + recommendation + (occupant ? ' \u2014 ' + esc(occupant.name) : '') + '</button>';
    }).join('') + '</div></div>';
}

function assignmentUiHtml(booking, date) {
  if (demoMode()) return '<p class="hint">Sample preview only \u2014 this request cannot be approved or changed.</p>';
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
    if (occ) { addBanner(unitLabel(type, unitId) + ' was just taken by ' + occ.name + ' \u2014 pick another.', true); return; }
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
      '<div class="req-sub">' + esc(needsSummary(b)) + ' · ' + esc(fmtTime(b.start)) + '\u2013' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div>' +
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
    '<div class="req-sub">' + esc(needsSummary(b)) + (assignSummary ? ' \u2014 ' + esc(assignSummary) : '') + ' · ' + esc(fmtTime(b.start)) + '\u2013' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div>' +
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
  if (demoMode()) { addBanner('Sample preview only \u2014 nothing was changed.'); return; }
  if (ui.adminActionId) return;
  const b = state.bookings[id];
  if (!b || b.status !== 'approved' || !endEarlyOptions(b).includes(end)) return;
  try {
    ui.adminActionId = id;
    render();
    setSyncPill(false, 'Saving');
    await adminCall('adminBookingAction', { action: 'end-early', bookingId: id, end: end });
    ui.endEarly = null;
    addBanner(b.name + '’s reservation now ends at ' + fmtTime(end) + '.');
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

/* Text inputs skip re-render on every keystroke (that would drop focus), so
   pull their live values back before any render()-triggering change. */
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
    html += '<details class="time-period" name="admin-reservation-period"' + (inPeriod || (!d.start && periodIdx === 0) ? ' open' : '') + '><summary><span><strong>' + esc(period.label) + '</strong><small>Start times ' + esc(fmtTime(period.start)) + '\u2013' + esc(fmtTime(hhmmOfMins(minsOfDay(period.end) - 30))) + '</small></span><span class="period-summary">' + (inPeriod && d.end ? esc(fmtTime(d.start) + '\u2013' + fmtTime(d.end)) : 'Choose time') + '</span></summary>' +
      '<div class="time-range-controls"><label for="af-start-' + periodIdx + '">Start time<select id="af-start-' + periodIdx + '" data-chg="af-start" data-period="' + periodIdx + '"><option value="">Choose start</option>' + points.slice(0, -1).map(start => '<option value="' + start + '"' + (startValue === start ? ' selected' : '') + '>' + esc(fmtTime(start)) + '</option>').join('') + '</select></label>' +
      '<label for="af-end-' + periodIdx + '">End time<select id="af-end-' + periodIdx + '" data-chg="af-end" data-period="' + periodIdx + '"' + (!startValue ? ' disabled' : '') + '><option value="">Choose end</option>' + points.slice(1).map(end => '<option value="' + end + '"' + (endValue === end ? ' selected' : '') + (startValue && minsOfDay(end) <= minsOfDay(startValue) ? ' disabled' : '') + '>' + esc('End at ' + fmtTime(end)) + '</option>').join('') + '</select></label></div></details>';
  });
  return html + '</div>' + (d.start && d.end ? '<p class="selection-summary" aria-live="polite">Selected: ' + esc(fmtTime(d.start)) + ' \u2013 ' + esc(fmtTime(d.end)) + '</p>' : '');
}
function afAssignPillRowHtml(d, type) {
  if (!d.start || !d.end) return '';
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
        esc(u.label) + (occupant ? ' \u2014 ' + esc(occupant.name) : '') + '</button>';
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
    '<input type="text" id="af-name" value="' + esc(d.name) + '" required>' +

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
    if (occ) { addBanner(unitLabel(t, d.assign[t]) + ' was just taken by ' + occ.name + ' \u2014 pick another.', true); return; }
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
    await refreshSchedule();
    await runAdminMigrations();
    await refreshSchedule();
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
  state.bookings = {};
  scheduleReady = false;
  if (scheduleRefreshTimer) clearTimeout(scheduleRefreshTimer);
  scheduleRefreshTimer = null;
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
    syncAdminFormDraft();
    ui.adminForm = null;
    ui.selectedDate = date;
    ui.adminSelectedId = null;
    ui.adminAssign = {};
    ui.adminReapproveId = null;
    render();
    return;
  }

  if (act === 'admin-type') {
    if (!NEED_TYPES.some(type => type.id === el.dataset.id)) return;
    ui.adminType = el.dataset.id;
    render();
    return;
  }

  if (act === 'end-early-close') { ui.endEarly = null; render(); return; }
  if (act === 'end-early-pick') { adminEndBookingEarly(el.dataset.id, el.dataset.end); return; }

  /* ---- PIN gate ---- */
  if (act === 'admin-unlock') {
    const val = document.getElementById('admin-pin-input').value;
    startAdminSession(val);
    return;
  }
  if (act === 'admin-lock') { endAdminSession(); return; }

  /* ---- pending queue + assignment + day overview ---- */
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

  /* ---- add a booking directly ---- */
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

  /* ---- housekeeping ---- */
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
  }
});
document.addEventListener('keydown', e => {
  if (!ui.endEarly) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    ui.endEarly = null;
    render();
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
  // Demo is fixture only and needs no backend read, so it is ready at once.
  scheduleReady = demoMode();
  render();
  if (adminUnlocked()) {
    try { scheduleAdminExpiry(JSON.parse(sessionStorage.getItem(ADMIN_KEY)).expiresAt); } catch (error) { sessionStorage.removeItem(ADMIN_KEY); }
  }
  if (demoMode()) return;
  setInterval(() => {
    if (!subscribedDateKey || subscribedDateKey === upcomingBookingDates().join('|')) return;
    syncAdminFormDraft();
    const adminDraftDirty = ui.adminForm && (ui.adminForm.name || ui.adminForm.start || ui.adminForm.note || ui.adminForm.purposeOther);
    if (ui.adminSubmitting || ui.adminActionId || adminDraftDirty) {
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
      addBanner('The secure connection is unavailable, so Admin cannot open right now.', true);
      setSyncPill(false);
    });
  } else {
    setSyncPill(false);
  }
}

init();
