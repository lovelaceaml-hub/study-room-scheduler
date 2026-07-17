'use strict';

/* =====================================================================
   LV Zion Study Rooms — v2
   Sibling of worship-duty-app / new-song-app / morning-prayer-app /
   exhibition-tours (same architecture): vanilla JS, Firestore real-time
   sync with a full localStorage fallback, one screen of embedded CSS,
   no build step.

   Members request a Sabbath study room or a piece of shared equipment
   (whiteboard, TV, podium) for the ONE upcoming Saturday; a committee
   approver assigns the actual room/unit and approves or declines. A
   derived (never stored) waiting line forms when a resource type is
   full. Admin is PIN-gated (hash in Firestore app/settings, sha256,
   default 0000, device unlock cached in localStorage).
   ===================================================================== */

/* ================= constants ================= */

const DATA_KEY = 'srs-data-v2';
const ADMIN_KEY = 'srs-admin-unlock';
const MY_BOOKINGS_KEY = 'srs-my-bookings';   // localStorage array of this device's own booking ids
const NAME_KEY = 'srs-name';                 // localStorage: last name typed on the Sign Up form

const PURPOSES = [
  { id: 'contact', label: 'Contact study' },
  { id: 'new-member', label: 'New member study' },
  { id: 'meeting', label: 'Member meeting' },
  { id: 'other', label: 'Other' }
];
/* Admin-only addition, used solely on the "Add a booking" form (e.g. to
   block the Baptism Room during an actual baptism). Never offered to
   members on the Sign Up tab. Renders as a neutral "Reserved" chip. */
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
  { id: 'room-4', label: 'Study Room 4', num: 4, hasEquipment: true },
  { id: 'room-baptism', label: 'Baptism Room', num: null, hasEquipment: false }
];
const WHITEBOARDS = [
  { id: 'wb-1', label: 'Whiteboard 1 · Large', num: 1 },
  { id: 'wb-2', label: 'Whiteboard 2 · Large', num: 2 },
  { id: 'wb-3', label: 'Whiteboard 3 · Large', num: 3 },
  { id: 'wb-4', label: 'Whiteboard 4 · Vertical', num: 4 },
  { id: 'wb-5', label: 'Whiteboard 5 · Vertical', num: 5 }
];
const PODIUMS = [1, 2, 3, 4, 5].map(n => ({ id: 'pod-' + n, label: 'Podium ' + n, num: n }));
const TVS = [1, 2, 3].map(n => ({ id: 'tv-' + n, label: 'TV ' + n, num: n }));

const UNITS_BY_TYPE = { room: ROOMS, whiteboard: WHITEBOARDS, tv: TVS, podium: PODIUMS };
const CAPACITY = { room: ROOMS.length, whiteboard: WHITEBOARDS.length, tv: TVS.length, podium: PODIUMS.length };

/* Preferred-room pill choices on the Sign Up form: null = "No preference". */
const PREFERRED_ROOM_CHOICES = [null, 'room-1', 'room-2', 'room-3', 'room-4', 'room-baptism'];

/* Saturdays only; two 30-min-slot windows around the services. */
const WINDOWS = [
  { start: '10:00', end: '14:30', label: 'Morning' },
  { start: '16:00', end: '19:30', label: 'Afternoon' }
];

const TABS = [
  { id: 'schedule', label: 'Reservations' },
  { id: 'signup', label: 'Sign up' },
  { id: 'admin', label: 'Admin' }
];

/* ================= state ================= */

let state = {
  bookings: {},   // id -> booking (see spec shape); may contain stale/invalid docs, always filter via bookingsList()
  settings: {}    // { pinHash, ... }
};
let ui = {
  tab: 'schedule',
  viewRef: false,       // true = viewing the read-only "last Sabbath" reference schedule
  pinError: '',
  submitting: false,
  signup: null,         // Sign Up form draft, created lazily by ensureSignupDraft()
  signupConfirm: null,  // { id } of the just-submitted booking, while the confirmation panel is showing
  adminAssign: {},       // bookingId -> { room, whiteboard, tv, podium } draft unit picks (pending or re-approve)
  adminReapproveId: null, // id of a declined/cancelled booking currently showing the assignment UI
  adminForm: null        // Admin "Add a booking" form draft, created lazily by ensureAdminFormDraft()
};

let fb = null; // { db, doc, setDoc, deleteDoc, collection } when online

/* ================= tiny helpers ================= */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
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
function previousSaturdayISO() { return addDaysISO(upcomingSaturdayISO(), -7); }
/* Every valid 30-min slot start inside a window. */
function slotStarts(window) {
  const startMin = minsOfDay(window.start);
  const endMin = minsOfDay(window.end);
  const starts = [];
  for (let m = startMin; m + 30 <= endMin; m += 30) starts.push(hhmmOfMins(m));
  return starts;
}
function allSlotStarts() {
  let out = [];
  WINDOWS.forEach(w => { out = out.concat(slotStarts(w)); });
  return out;
}
function windowIndexFor(hhmm) {
  const m = minsOfDay(hhmm);
  return WINDOWS.findIndex(w => m >= minsOfDay(w.start) && m < minsOfDay(w.end));
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
  return Object.keys(state.bookings)
    .map(id => Object.assign({ id: id }, state.bookings[id]))
    .filter(isValidBooking);
}
function bookingByIdSafe(id) {
  const b = state.bookings[id];
  return isValidBooking(b) ? Object.assign({ id: id }, b) : null;
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

/* ---- admin PIN gate (exhibition-tours pattern: the *hash*, not a boolean,
   is what's stored in localStorage — so changing the PIN on one device
   automatically re-locks every other device whose stored hash no longer
   matches state.settings.pinHash) ---- */
function adminUnlocked() {
  const h = state.settings.pinHash || '';
  return !!h && localStorage.getItem(ADMIN_KEY) === h;
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
    b.status === 'approved' && needsOf(b)[type] && assignmentsOf(b)[type] &&
    rangesOverlap(b.start, b.end, slotStart, slotEnd)).length;
}
function isSlotFull(type, date, slotStart) { return typeUsageCount(type, date, slotStart) >= CAPACITY[type]; }
function fullSlotsForType(type, date) { return allSlotStarts().filter(s => isSlotFull(type, date, s)); }

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
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
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
  const slots = allSlotStarts().filter(s => minsOfDay(s) >= minsOfDay(start) && minsOfDay(s) < minsOfDay(end));
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

function recommendedUnit(type, booking, date) {
  const free = freeUnitsForType(type, date, booking.start, booking.end, booking.id);
  if (!free.length) return null;
  if (type === 'room') {
    if (booking.preferredRoom) {
      const pref = free.find(u => u.id === booking.preferredRoom);
      if (pref) return pref.id;
    }
    const nonBaptism = free.filter(u => u.id !== 'room-baptism').sort((a, b) => a.num - b.num);
    if (nonBaptism.length) return nonBaptism[0].id;
    const baptism = free.find(u => u.id === 'room-baptism');
    return baptism ? baptism.id : null;
  }
  return free.slice().sort((a, b) => a.num - b.num)[0].id;
}

/* Builds the initial (recommended) assignment draft for a pending/
   re-approving booking. Whiteboard+podium sync: if both are needed,
   prefer a numbered pair that is free on BOTH sides at once. */
function initialAssignmentFor(booking, date) {
  const need = needsOf(booking);
  const assign = { room: null, whiteboard: null, tv: null, podium: null };
  if (need.room) assign.room = recommendedUnit('room', booking, date);
  if (need.tv) assign.tv = recommendedUnit('tv', booking, date);
  if (need.whiteboard && need.podium) {
    const freeWb = freeUnitsForType('whiteboard', date, booking.start, booking.end, booking.id);
    const freePod = freeUnitsForType('podium', date, booking.start, booking.end, booking.id);
    const freeWbNums = freeWb.map(u => u.num);
    const freePodNums = freePod.map(u => u.num);
    const pairedN = [1, 2, 3, 4, 5].find(n => freeWbNums.indexOf(n) !== -1 && freePodNums.indexOf(n) !== -1);
    if (pairedN) { assign.whiteboard = 'wb-' + pairedN; assign.podium = 'pod-' + pairedN; }
    /* else: no free numbered pair — leave both blank; admin resolves manually. */
  } else {
    if (need.whiteboard) assign.whiteboard = recommendedUnit('whiteboard', booking, date);
    if (need.podium) assign.podium = recommendedUnit('podium', booking, date);
  }
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
    localStorage.setItem(DATA_KEY, JSON.stringify({
      bookings: state.bookings, settings: state.settings
    }));
  } catch (e) { /* storage full/blocked — realtime copy still lives in Firestore */ }
}

/* ---- Firestore write layer (works in local mode too) ---- */
function fsSet(col, id, data) {
  if (fb) fb.setDoc(fb.doc(fb.db, col, id), data).catch(err => console.warn('setDoc', col, id, err));
  applyLocalWrite(col, id, data);
}
function fsDelete(col, id) {
  if (fb) fb.deleteDoc(fb.doc(fb.db, col, id)).catch(err => console.warn('deleteDoc', col, id, err));
  applyLocalWrite(col, id, null);
}
function applyLocalWrite(col, id, data) {
  if (col === 'bookings') { if (data) state.bookings[id] = data; else delete state.bookings[id]; }
  if (col === 'app' && id === 'settings' && data) state.settings = data;
  saveLocal();
  render();
}
function saveSettings(patch) {
  fsSet('app', 'settings', Object.assign({}, state.settings, patch));
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
  const app = appMod.initializeApp(config);
  const db = fsMod.getFirestore(app);
  fb = {
    db,
    doc: fsMod.doc,
    setDoc: fsMod.setDoc,
    deleteDoc: fsMod.deleteDoc,
    collection: fsMod.collection
  };
  fsMod.onSnapshot(fsMod.collection(db, 'bookings'), snap => {
    // A cache-only empty snapshot (no server contact yet) must not wipe the
    // device's saved bookings — wait for a real server answer.
    if (snap.metadata.fromCache && snap.empty) return;
    state.bookings = {};
    snap.docs.forEach(d => { state.bookings[d.id] = d.data(); });
    saveLocal(); render();
  }, err => {
    addBanner('Could not connect to the shared database (' + esc(err.code || 'error') + '). Showing this device’s copy.', true);
    setSyncPill(false);
  });
  fsMod.onSnapshot(fsMod.doc(db, 'app', 'settings'), snap => {
    if (snap.exists()) { state.settings = snap.data(); saveLocal(); render(); }
  }, () => { /* connection errors are surfaced by the bookings listener */ });
  setSyncPill(true);
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

  const dateEl = document.getElementById('head-date');
  if (dateEl) dateEl.textContent = 'Sabbath · ' + fmtHeaderDate(upcomingSaturdayISO());

  const tabs = document.getElementById('tabs');
  if (tabs) {
    tabs.innerHTML = TABS.map(t =>
      '<button class="tab' + (ui.tab === t.id ? ' active' : '') + '" data-act="tab" data-id="' + t.id + '">' + esc(t.label) + '</button>'
    ).join('');
  }

  if (ui.tab === 'signup') app.innerHTML = renderSignup();
  else if (ui.tab === 'admin') app.innerHTML = renderAdmin();
  else app.innerHTML = renderSchedule();
}

/* ================= shared schedule grid (This Sabbath / reference / admin day overview) ================= */

/* Chip content for one approved+assigned booking. */
function chipInner(b) {
  if (b.purpose === 'blocked') return '<span class="chip-name">Reserved</span>';
  const badge = b.certainty === 'confirmed'
    ? '<span class="badge-cert confirmed" title="Confirmed">&#10003;</span>'
    : '<span class="badge-cert tentative" title="Tentative">&#9670;</span>';
  return '<span class="chip-name">' + badge + ' ' + esc(b.name) + '</span>' +
    '<span class="chip-time">' + esc(fmtTimeTight(b.start)) + '–' + esc(fmtTimeTight(b.end)) + '</span>';
}
function chipClass(b) {
  if (b.purpose === 'blocked') return 'chip-blocked';
  return b.certainty === 'confirmed' ? 'chip-confirmed' : 'chip-tentative';
}

/* ---- desktop timeline ---- */
function timelineRowHtml(unitLabelHtml, sublabel, type, unitId, date) {
  const bookings = activeBookingsForDate(date).filter(b =>
    b.status === 'approved' && needsOf(b)[type] && assignmentsOf(b)[type] === unitId);
  const tracksHtml = WINDOWS.map(w => {
    const total = minsOfDay(w.end) - minsOfDay(w.start);
    const chips = bookings.filter(b => rangesOverlap(b.start, b.end, w.start, w.end)).map(b => {
      const left = Math.max(0, minsOfDay(b.start) - minsOfDay(w.start));
      const width = Math.min(minsOfDay(b.end), minsOfDay(w.end)) - minsOfDay(w.start) - left;
      const podiumTag = (type === 'whiteboard' && assignmentsOf(b).podium)
        ? '<span class="chip-podium">' + esc(unitLabel('podium', assignmentsOf(b).podium)) + '</span>' : '';
      return '<div class="chip ' + chipClass(b) + '" style="left:' + (left / total * 100) + '%;width:' + (width / total * 100) + '%" title="' +
        esc(b.name + ' — ' + bookingPurposeText(b)) + '">' + chipInner(b) + podiumTag + '</div>';
    }).join('');
    return '<div class="timeline-track ' + (w === WINDOWS[0] ? 'morning' : 'afternoon') + '">' + chips + '</div>';
  }).join('');
  return '<div class="timeline-row"><div class="timeline-label">' + unitLabelHtml +
    (sublabel ? '<small>' + esc(sublabel) + '</small>' : '') + '</div>' +
    '<div class="timeline-track-wrap">' + tracksHtml + '</div></div>';
}

function rulerHtml() {
  const tracks = WINDOWS.map((w, wi) => {
    const total = minsOfDay(w.end) - minsOfDay(w.start);
    const ticks = [];
    for (let m = minsOfDay(w.start); m < minsOfDay(w.end); m += 60) ticks.push(m);
    const ticksHtml = ticks.map(m =>
      '<span style="left:' + ((m - minsOfDay(w.start)) / total * 100) + '%">' + esc(fmtTime(hhmmOfMins(m))) + '</span>'
    ).join('');
    return '<div class="ruler ' + (wi === 0 ? 'morning' : 'afternoon') + '">' + ticksHtml + '</div>';
  }).join('');
  return '<div class="ruler-row"><div class="timeline-label"></div><div class="ruler-track-wrap">' + tracks + '</div></div>';
}

function waitingStretchLabelHtml(st) {
  const names = st.entries.map(e => '<span class="queue-num">' + e.position + '</span>' + esc(e.booking.name)).join(' · ');
  return '<div class="wait-strip"><span class="wait-time">' + esc(fmtTime(st.start)) + '–' + esc(fmtTime(st.end)) + '</span>' +
    '<span class="wait-label">' + esc(NEED_TYPES.find(n => n.id === st.type).plural) + ' full — Waiting in line:</span> ' + names + '</div>';
}

/* Small italic sub-label under a unit's name in the timeline (matching
   podium pairs on whiteboards, like the design reference). */
function unitSublabel(type, u) {
  if (type === 'whiteboard') return 'Pairs with Podium ' + u.num;
  return '';
}

/* ---- one category group (rooms / whiteboards / tvs), desktop + mobile ---- */
function categoryGroupHtml(type, units, date, showWaiting) {
  const nt = NEED_TYPES.find(n => n.id === type);
  let html = '<div class="cat-title">' + esc(nt.plural) + '</div>';

  // Desktop timeline
  html += '<div class="sched-desktop">';
  units.forEach(u => { html += timelineRowHtml(esc(u.label), unitSublabel(type, u), type, u.id, date); });
  html += '</div>';

  // Mobile list — only units with at least one approved booking today
  html += '<div class="sched-mobile">';
  let anyMobile = false;
  units.forEach(u => {
    const bookings = activeBookingsForDate(date).filter(b =>
      b.status === 'approved' && needsOf(b)[type] && assignmentsOf(b)[type] === u.id)
      .sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start));
    bookings.forEach(b => {
      anyMobile = true;
      const badge = b.purpose === 'blocked' ? '<span class="mini-reserved">Reserved</span>' :
        (b.certainty === 'confirmed' ? '<span class="badge-cert confirmed">&#10003;</span>' : '<span class="badge-cert tentative">&#9670;</span>') + ' ' + esc(b.name);
      html += '<div class="mini-row"><span class="mini-unit">' + esc(u.label) + '</span>' +
        '<span class="mini-detail">' + badge + '</span>' +
        '<span class="mini-time">' + esc(fmtTimeTight(b.start)) + '–' + esc(fmtTimeTight(b.end)) + '</span></div>';
    });
  });
  if (!anyMobile) html += '<p class="hint">Nothing booked yet.</p>';
  html += '</div>';

  if (showWaiting) {
    const lines = waitingLineForType(type, date);
    if (lines.length) html += lines.map(waitingStretchLabelHtml).join('');
  }
  return html;
}

function legendHtml() {
  return '<div class="legend">' +
    '<span class="legend-item"><span class="legend-swatch confirmed"></span>Confirmed</span>' +
    '<span class="legend-item"><span class="legend-swatch tentative"></span>Tentative</span>' +
    '<span class="legend-item"><span class="legend-swatch waiting"></span>Waiting in line</span>' +
    '</div>';
}

/* The whole grid: ruler + 3 groups (rooms/whiteboards/tvs) + a combined
   waiting-line strip placed right under the rooms group, then any
   contested whiteboard/tv stretches folded in below their own groups. */
function scheduleGridHtml(date) {
  let html = '<div class="sched-scroll"><div class="sched-inner">';
  html += legendHtml();
  html += '<div class="sched-desktop">' + rulerHtml() + '</div>';
  html += categoryGroupHtml('room', ROOMS, date, true);
  html += categoryGroupHtml('whiteboard', WHITEBOARDS, date, true);
  html += categoryGroupHtml('tv', TVS, date, true);
  html += '</div></div>';
  return html;
}

/* ---- "Who's requesting" list: every request still waiting for the
   approver, so anyone browsing (or signing up) can see who has already
   asked for a room or piece of equipment, and at what time. In-line
   requests show their place in the queue. ---- */
function reservationRequestsHtml(date) {
  const items = bookingsForDate(date).filter(b => b.status === 'pending')
    .sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start) || (a.createdAt || 0) - (b.createdAt || 0));
  if (!items.length) return '';
  let html = '<div class="card"><h2>Who’s requesting</h2>' +
    '<p class="section-note">These people have asked to reserve a room or piece of equipment and are waiting for the approver.</p>';
  items.forEach(b => {
    const pos = waitingPositionFor(b, date);
    const certBadge = b.certainty === 'confirmed' ? '<span class="badge-cert confirmed">&#10003;</span>' : '<span class="badge-cert tentative">&#9670;</span>';
    const statusBadge = pos !== null
      ? '<span class="badge status-waiting">In line — ' + ordinal(pos) + '</span>'
      : '<span class="badge status-pending">Awaiting approval</span>';
    html += '<div class="req-row"><div class="req-head">' + esc(b.name) + ' ' + certBadge + ' ' + statusBadge + '</div>' +
      '<div class="req-sub">' + esc(needsSummary(b)) + ' · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div></div>';
  });
  return html + '</div>';
}

/* ---- This Sabbath tab ---- */

function renderSchedule() {
  const upcoming = upcomingSaturdayISO();
  const date = ui.viewRef ? previousSaturdayISO() : upcoming;

  let html = '<div class="card sched-head">';
  if (ui.viewRef) {
    html += '<h2>Last Sabbath <span class="ref-tag">reference</span></h2>' +
      '<p class="section-note">' + esc(fmtHeaderDate(date)) + ' — read-only. Approved bookings only; no sign-ups happen here.</p>' +
      '<a href="#" class="ref-link" data-act="ref-back">Back to this Sabbath</a>';
  } else {
    html += '<h2>Reservations</h2>' +
      '<p class="section-note">' + esc(fmtHeaderDate(date)) + ' — see who has each study room and piece of equipment, and who has asked to reserve one.</p>' +
      '<a href="#" class="ref-link" data-act="ref-view">View last Sabbath (reference)</a>';
  }
  html += '</div>';

  html += '<div class="card">' + scheduleGridHtml(date) + '</div>';

  if (!ui.viewRef) {
    html += reservationRequestsHtml(date);
    html += renderMyRequests(date);
  }
  return html;
}

function renderMyRequests(date) {
  const items = myBookingIds()
    .map(id => bookingByIdSafe(id))
    .filter(b => b && b.date === date)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!items.length) return '';

  let html = '<div class="card"><h2>My requests</h2>';
  items.forEach(b => { html += myRequestRowHtml(b, date); });
  html += '</div>';
  return html;
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
  const baptismNote = (b.status === 'approved' && assignmentsOf(b).room === 'room-baptism')
    ? '<div class="req-sub baptism-note">Note: the Baptism Room has no whiteboard or TV — add a request if you need one.</div>' : '';
  return '<div class="req-row">' +
    '<div class="req-head">' + esc(needsSummary(b)) + ' ' + myRequestStatusHtml(b, date) + '</div>' +
    '<div class="req-sub">' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + ' · ' + esc(bookingPurposeText(b)) + '</div>' +
    baptismNote +
    (active ? '<div class="req-actions"><a href="#" class="cancel-link" data-act="my-cancel" data-id="' + esc(b.id) + '">Plans changed? Cancel</a></div>' : '') +
    '</div>';
}

/* ================= Sign Up tab ================= */

function ensureSignupDraft() {
  if (ui.signup) return;
  ui.signup = {
    name: localStorage.getItem(NAME_KEY) || '',
    needs: { room: false, whiteboard: false, tv: false, podium: false },
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

function currentNeedTypes(d) { return NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]); }

function needsCheckboxesHtml(d) {
  return '<div class="need-row">' + NEED_TYPES.map(nt =>
    '<button type="button" class="need-chip' + (d.needs[nt.id] ? ' active' : '') + '" data-act="su-need" data-id="' + nt.id + '" aria-pressed="' + (d.needs[nt.id] ? 'true' : 'false') + '">' +
    (d.needs[nt.id] ? '&#10003; ' : '') + esc(nt.label) + '</button>'
  ).join('') + '</div>';
}

function preferredRoomHtml(d) {
  if (!d.needs.room) return '';
  return '<label class="fld">Preferred room (optional)</label><div class="need-row">' +
    PREFERRED_ROOM_CHOICES.map(rid => {
      const label = rid === null ? 'No preference' : unitLabel('room', rid);
      const sel = d.preferredRoom === rid;
      return '<button type="button" class="pref-chip' + (sel ? ' active' : '') + '" data-act="su-pref" data-id="' + (rid === null ? '' : rid) + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
}

/* ---- time picker ---- */
function timePickerHtml(d, date) {
  const needTypes = currentNeedTypes(d);
  let html = '<label class="fld">Time — tap your start time (that gives a 30-minute block); tap a later time to make it longer</label>';
  WINDOWS.forEach((w, wi) => {
    const slots = slotStarts(w);
    html += '<div class="strip-wrap">' +
      '<div class="strip-window-label">' + esc(w.label) + ' · ' + esc(fmtTime(w.start)) + ' – ' + esc(fmtTime(w.end)) + '</div>' +
      '<div class="time-strip">' + slots.map(s => {
        const blocked = needTypes.length ? isSlotBlockedForNeeds(needTypes, date, s, null) : false;
        const inStart = d.start === s;
        const endSlotStart = d.end ? hhmmOfMins(minsOfDay(d.end) - 30) : null;
        const inEnd = d.end !== null && endSlotStart === s;
        const inRange = d.start !== null && d.windowIdx === wi &&
          minsOfDay(s) >= minsOfDay(d.start) && (d.end === null ? s === d.start : minsOfDay(s) < minsOfDay(d.end));
        let cls = 'slot';
        if (blocked) cls += ' blocked';
        else if (inRange) { cls += ' sel'; if (inStart) cls += ' start'; if (inEnd) cls += ' end'; }
        return '<button type="button" class="' + cls + '"' + (blocked ? ' disabled' : ' data-act="su-slot" data-win="' + wi + '" data-id="' + s + '"') + '>' + esc(fmtTimeTight(s)) + '</button>';
      }).join('') + '</div></div>';
  });
  if (d.start && d.end) {
    html += '<p class="hint">Selected: ' + esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) + '</p>';
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
  }).sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start) || (a.createdAt || 0) - (b.createdAt || 0));

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
    '<button type="button" class="purpose-chip' + (d.purpose === p.id ? ' active' : '') + '" data-act="su-purpose" data-id="' + p.id + '">' + esc(p.label) + '</button>'
  ).join('') + '</div>' +
  (d.purpose === 'other'
    ? '<input type="text" id="su-other" value="' + esc(d.purposeOther) + '" placeholder="Please describe" style="margin-top:8px" required>'
    : '');
}

function certaintyButtonsHtml(d) {
  return '<div class="certainty-row">' +
    '<button type="button" class="certainty-btn confirmed' + (d.certainty === 'confirmed' ? ' active' : '') + '" data-act="su-certainty" data-id="confirmed">&#10003; Confirmed<br><small>— they’ll be there</small></button>' +
    '<button type="button" class="certainty-btn tentative' + (d.certainty === 'tentative' ? ' active' : '') + '" data-act="su-certainty" data-id="tentative">&#9670; Tentative<br><small>— still confirming</small></button>' +
    '</div>';
}

function renderSignup() {
  if (ui.signupConfirm) return renderSignupConfirm();
  ensureSignupDraft();
  const d = ui.signup;
  const date = upcomingSaturdayISO();

  let html = '<div class="card"><h2>Sign up</h2>' +
    '<p class="section-note">' + esc(fmtHeaderDate(date)) + ' — request a study room or piece of equipment. The approver will assign it and let you know.</p>' +
    '<form data-act="su-submit">' +

    '<label class="fld">Your name</label>' +
    '<input type="text" id="su-name" value="' + esc(d.name) + '" placeholder="Full name" autocomplete="name" required>' +

    '<label class="fld">What do you need?</label>' +
    needsCheckboxesHtml(d) +

    preferredRoomHtml(d) +

    timePickerHtml(d, date) +

    signupExistingHtml(d, date) +

    '<label class="fld">Purpose</label>' +
    purposeChipsHtml(d) +

    '<label class="fld">How sure are you?</label>' +
    certaintyButtonsHtml(d) +

    '<label class="fld">Note (optional)</label>' +
    '<input type="text" id="su-note" value="' + esc(d.note) + '" placeholder="Anything the reviewer should know">' +

    '<div style="margin-top:16px"><button class="btn primary big" type="submit"' + (ui.submitting ? ' disabled' : '') + '>' +
    (ui.submitting ? 'Submitting…' : 'Request this time') + '</button></div>' +
    '</form></div>';
  return html;
}

function renderSignupConfirm() {
  const needsRoom = ui.signupConfirm && ui.signupConfirm.needsRoom;
  const msg = needsRoom
    ? 'Your request is in — it’s waiting for approval. The approver will assign a room and you’ll see it under My requests.'
    : 'Your request is in — it’s waiting for approval. The approver will assign it and you’ll see it under My requests.';
  return '<div class="card"><h2>Request sent</h2>' +
    '<p class="section-note">' + esc(msg) + '</p>' +
    '<button class="btn primary big" data-act="su-again">Make another request</button>' +
    '</div>';
}

function submitSignup(form) {
  if (ui.submitting) return; // double-submit guard
  syncSignupDraft();
  const d = ui.signup;
  const date = upcomingSaturdayISO();
  const name = (d.name || '').trim();
  const note = (d.note || '').trim();
  const purposeOther = (d.purposeOther || '').trim();
  const needTypes = currentNeedTypes(d);

  if (!name) { addBanner('Please enter your name.', true); return; }
  if (!needTypes.length) { addBanner('Please choose at least one thing you need.', true); return; }
  if (!d.start || !d.end) { addBanner('Please choose a start and end time.', true); return; }
  if (!d.purpose) { addBanner('Please choose a purpose.', true); return; }
  if (d.purpose === 'other' && !purposeOther) { addBanner('Please describe the purpose.', true); return; }
  if (!d.certainty) { addBanner('Please tell us how sure you are — Confirmed or Tentative.', true); return; }

  const block = blockingReasonForRange(needTypes, date, d.start, d.end, null);
  if (block) {
    addBanner('This time is full and ' + block.count + ' people are already in line for ' + esc(needLabel(block.type).toLowerCase()) + ' — pick another time.', true);
    return;
  }

  ui.submitting = true;
  const btn = form ? form.querySelector('button[type=submit]') : null;
  if (btn) btn.disabled = true; // belt & suspenders: dead until the re-render
  const id = uid();
  fsSet('bookings', id, {
    date: date,
    start: d.start,
    end: d.end,
    name: name,
    needs: { room: !!d.needs.room, whiteboard: !!d.needs.whiteboard, tv: !!d.needs.tv, podium: !!d.needs.podium },
    preferredRoom: d.needs.room ? (d.preferredRoom || null) : null,
    purpose: d.purpose,
    purposeOther: d.purpose === 'other' ? purposeOther : '',
    certainty: d.certainty,
    note: note,
    status: 'pending',
    assignments: { room: null, whiteboard: null, tv: null, podium: null },
    createdAt: Date.now()
  });
  addMyBookingId(id);
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage full/blocked */ }
  ui.submitting = false;
  ui.signupConfirm = { id: id, needsRoom: !!d.needs.room };
  ui.signup = null; // fresh draft next time
  render();
}

/* ================= Admin tab ================= */

function renderAdmin() {
  if (!adminUnlocked()) return renderAdminLock();
  const date = upcomingSaturdayISO();
  return renderAdminHeader() + renderAdminQueue(date) + renderAdminDayOverview(date) +
    renderAdminAddForm(date) + renderAdminHousekeeping();
}

/* ---- PIN gate ---- */

function renderAdminLock() {
  return '<div class="card">' +
    '<div class="lock-title">Admin is locked</div>' +
    '<p class="hint">Enter the admin PIN to approve or decline requests, review the day, and manage bookings.</p>' +
    '<form class="pin-row" style="margin-top:12px" data-act="admin-unlock">' +
    '<input type="password" id="admin-pin-input" placeholder="PIN" autocomplete="off" inputmode="numeric" required>' +
    '<button class="btn primary" type="submit">Unlock</button></form>' +
    (ui.pinError ? '<p class="pin-error">' + esc(ui.pinError) + '</p>' : '') +
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
      const pa = waitingPositionFor(a, date); const pb = waitingPositionFor(b, date);
      const ka = pa === null ? Infinity : pa; const kb = pb === null ? Infinity : pb;
      if (ka !== kb) return ka - kb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
}

function fmtDateTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
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

/* Pill row for one resource type on a pending/re-approving booking's
   assignment UI. Clicking a free pill selects it (with wb<->podium sync). */
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
    (b.note ? '<div class="req-sub">Note: ' + esc(b.note) + '</div>' : '') +
    '<div class="req-sub muted">Requested ' + esc(fmtDateTime(b.createdAt)) + '</div>' +
    (hint ? '<p class="conflict-note">' + esc(hint) + '</p>' : '') +
    assignmentUiHtml(b, date) +
    '</div>';
}

function approveBooking(id) {
  const b = bookingByIdSafe(id);
  if (!b) return;
  const date = b.date;
  const assign = ui.adminAssign[id] || initialAssignmentFor(b, date);
  const need = neededTypesOf(b);
  // Re-check every needed type is still free at approve time.
  for (const type of need) {
    const unitId = assign[type];
    if (!unitId) { addBanner('Please pick a ' + needLabel(type).toLowerCase() + ' before approving.', true); return; }
    const occ = unitOccupant(type, unitId, date, b.start, b.end, b.id);
    if (occ) { addBanner(esc(unitLabel(type, unitId)) + ' was just taken by ' + esc(occ.name) + ' — pick another.', true); return; }
  }
  fsSet('bookings', id, Object.assign({}, state.bookings[id], {
    status: 'approved',
    assignments: { room: assign.room || null, whiteboard: assign.whiteboard || null, tv: assign.tv || null, podium: assign.podium || null },
    decidedAt: Date.now()
  }));
  delete ui.adminAssign[id];
  if (ui.adminReapproveId === id) ui.adminReapproveId = null;
}
function declineBooking(id) {
  const b = state.bookings[id];
  if (!b) return;
  fsSet('bookings', id, Object.assign({}, b, { status: 'declined', decidedAt: Date.now() }));
  delete ui.adminAssign[id];
}

/* ---- 2. Day overview ---- */

function renderAdminDayOverview(date) {
  let html = '<div class="card"><h2>Day overview</h2>' +
    '<p class="section-note">' + esc(fmtHeaderDate(date)) + ' at a glance, then manage individual bookings below.</p>' +
    scheduleGridHtml(date) +
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

function cancelBooking(id) {
  const b = state.bookings[id];
  if (!b) return;
  if (!confirm('Cancel the approved booking for ' + b.name + '?')) return;
  fsSet('bookings', id, Object.assign({}, b, { status: 'cancelled' }));
}

/* ---- 3. Add a booking directly ---- */

function ensureAdminFormDraft(date) {
  if (ui.adminForm) return;
  ui.adminForm = {
    date: date,
    name: '',
    needs: { room: false, whiteboard: false, tv: false, podium: false },
    preferredRoom: null,
    start: null,
    end: null,
    windowIdx: null,
    purpose: 'contact',
    purposeOther: '',
    certainty: 'confirmed',
    note: '',
    assign: { room: null, whiteboard: null, tv: null, podium: null }
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
  return '<div class="need-row">' + NEED_TYPES.map(nt =>
    '<button type="button" class="need-chip' + (d.needs[nt.id] ? ' active' : '') + '" data-act="af-need" data-id="' + nt.id + '">' +
    (d.needs[nt.id] ? '&#10003; ' : '') + esc(nt.label) + '</button>'
  ).join('') + '</div>';
}
function afPreferredRoomHtml(d) {
  if (!d.needs.room) return '';
  return '<label class="fld">Preferred room (optional)</label><div class="need-row">' +
    PREFERRED_ROOM_CHOICES.map(rid => {
      const label = rid === null ? 'No preference' : unitLabel('room', rid);
      const sel = d.preferredRoom === rid;
      return '<button type="button" class="pref-chip' + (sel ? ' active' : '') + '" data-act="af-pref" data-id="' + (rid === null ? '' : rid) + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
}
function afTimePickerHtml(d) {
  let html = '<label class="fld">Time</label>';
  WINDOWS.forEach((w, wi) => {
    const slots = slotStarts(w);
    html += '<div class="strip-wrap">' +
      '<div class="strip-window-label">' + esc(w.label) + ' · ' + esc(fmtTime(w.start)) + ' – ' + esc(fmtTime(w.end)) + '</div>' +
      '<div class="time-strip">' + slots.map(s => {
        const inStart = d.start === s;
        const endSlotStart = d.end ? hhmmOfMins(minsOfDay(d.end) - 30) : null;
        const inEnd = d.end !== null && endSlotStart === s;
        const inRange = d.start !== null && d.windowIdx === wi &&
          minsOfDay(s) >= minsOfDay(d.start) && (d.end === null ? s === d.start : minsOfDay(s) < minsOfDay(d.end));
        let cls = 'slot';
        if (inRange) { cls += ' sel'; if (inStart) cls += ' start'; if (inEnd) cls += ' end'; }
        return '<button type="button" class="' + cls + '" data-act="af-slot" data-win="' + wi + '" data-id="' + s + '">' + esc(fmtTimeTight(s)) + '</button>';
      }).join('') + '</div></div>';
  });
  if (d.start && d.end) html += '<p class="hint">Selected: ' + esc(fmtTime(d.start)) + ' – ' + esc(fmtTime(d.end)) + '</p>';
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
        (isFree ? ' data-act="af-assign" data-type="' + type + '" data-id="' + u.id + '"' : ' disabled') + '>' +
        esc(u.label) + (occupant ? ' — ' + esc(occupant.name) : '') + '</button>';
    }).join('') + '</div></div>';
}
function afPurposeChipsHtml(d) {
  return '<div class="need-row">' + ADMIN_PURPOSES.map(p =>
    '<button type="button" class="purpose-chip' + (d.purpose === p.id ? ' active' : '') + '" data-act="af-purpose" data-id="' + p.id + '">' + esc(p.label) + '</button>'
  ).join('') + '</div>' +
  (d.purpose === 'other'
    ? '<input type="text" id="af-other" value="' + esc(d.purposeOther) + '" placeholder="Please describe" style="margin-top:8px" required>'
    : '');
}
function afCertaintyButtonsHtml(d) {
  return '<div class="certainty-row">' +
    '<button type="button" class="certainty-btn confirmed' + (d.certainty === 'confirmed' ? ' active' : '') + '" data-act="af-certainty" data-id="confirmed">&#10003; Confirmed<br><small>— they’ll be there</small></button>' +
    '<button type="button" class="certainty-btn tentative' + (d.certainty === 'tentative' ? ' active' : '') + '" data-act="af-certainty" data-id="tentative">&#9670; Tentative<br><small>— still confirming</small></button>' +
    '</div>';
}

function renderAdminAddForm(date) {
  ensureAdminFormDraft(date);
  const d = ui.adminForm;
  const needTypes = NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]);

  return '<div class="card"><h2>Add a booking</h2>' +
    '<p class="section-note">Adds a booking that is approved immediately — for reserving directly, or blocking a room off (e.g. the Baptism Room during an actual baptism).</p>' +
    '<form data-act="admin-add-submit">' +

    '<label class="fld">Name</label>' +
    '<input type="text" id="af-name" value="' + esc(d.name) + '" placeholder="Full name" required>' +

    '<label class="fld">What do they need?</label>' +
    afNeedsCheckboxesHtml(d) +
    afPreferredRoomHtml(d) +
    afTimePickerHtml(d) +

    (needTypes.length && d.start && d.end ? '<label class="fld">Assign</label>' + needTypes.map(t => afAssignPillRowHtml(d, t)).join('') : '') +

    '<label class="fld">Purpose</label>' +
    afPurposeChipsHtml(d) +

    '<label class="fld">How sure?</label>' +
    afCertaintyButtonsHtml(d) +

    '<label class="fld">Note (optional)</label>' +
    '<input type="text" id="af-note" value="' + esc(d.note) + '" placeholder="Anything worth noting">' +

    '<div style="margin-top:16px"><button class="btn primary big" type="submit">Add booking (approved)</button></div>' +
    '</form></div>';
}

function submitAdminAdd() {
  syncAdminFormDraft();
  const d = ui.adminForm;
  const name = (d.name || '').trim();
  const note = (d.note || '').trim();
  const purposeOther = (d.purposeOther || '').trim();
  const needTypes = NEED_TYPES.map(nt => nt.id).filter(t => d.needs[t]);

  if (!name) { addBanner('Please enter a name.', true); return; }
  if (!needTypes.length) { addBanner('Please choose at least one thing needed.', true); return; }
  if (!d.start || !d.end) { addBanner('Please choose a start and end time.', true); return; }
  if (d.purpose === 'other' && !purposeOther) { addBanner('Please describe the purpose.', true); return; }
  for (const t of needTypes) {
    if (!d.assign[t]) { addBanner('Please assign a ' + needLabel(t).toLowerCase() + '.', true); return; }
    const occ = unitOccupant(t, d.assign[t], d.date, d.start, d.end, '__new__');
    if (occ) { addBanner(esc(unitLabel(t, d.assign[t])) + ' was just taken by ' + esc(occ.name) + ' — pick another.', true); return; }
  }

  fsSet('bookings', uid(), {
    date: d.date,
    start: d.start,
    end: d.end,
    name: name,
    needs: { room: !!d.needs.room, whiteboard: !!d.needs.whiteboard, tv: !!d.needs.tv, podium: !!d.needs.podium },
    preferredRoom: d.needs.room ? (d.preferredRoom || null) : null,
    purpose: d.purpose,
    purposeOther: d.purpose === 'other' ? purposeOther : '',
    certainty: d.certainty || 'confirmed',
    note: note,
    status: 'approved',
    assignments: { room: d.assign.room || null, whiteboard: d.assign.whiteboard || null, tv: d.assign.tv || null, podium: d.assign.podium || null },
    createdAt: Date.now(),
    decidedAt: Date.now()
  });
  addBanner('Booking added and approved for ' + esc(name) + '.');
  ui.adminForm = null; // reset the draft for next time
  render();
}

/* ---- 4. Housekeeping ---- */

function renderAdminHousekeeping() {
  return '<div class="card"><h2>Housekeeping</h2>' +
    '<p class="section-note">Removes bookings dated more than 8 weeks in the past, to keep the shared list tidy.</p>' +
    '<button class="btn danger" data-act="admin-cleanup">Remove old records</button>' +
    '</div>';
}

/* ================= actions ================= */

function handleAction(act, el) {
  if (act === 'tab') { ui.tab = el.dataset.id; ui.pinError = ''; render(); return; }

  /* ---- This Sabbath tab ---- */
  if (act === 'ref-view') { ui.viewRef = true; render(); return; }
  if (act === 'ref-back') { ui.viewRef = false; render(); return; }
  if (act === 'my-cancel') {
    const b = state.bookings[el.dataset.id];
    if (!b || (b.status !== 'pending' && b.status !== 'approved')) return;
    if (!confirm('Cancel this request?')) return;
    fsSet('bookings', el.dataset.id, Object.assign({}, b, { status: 'cancelled' }));
    return;
  }

  /* ---- Sign Up tab ---- */
  if (act === 'su-need') {
    syncSignupDraft(); ensureSignupDraft();
    const d = ui.signup;
    d.needs[el.dataset.id] = !d.needs[el.dataset.id];
    d.start = null; d.end = null; d.windowIdx = null; // selection resets when needs change
    if (!d.needs.room) d.preferredRoom = null;
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
  if (act === 'su-again') { ui.signupConfirm = null; ui.signup = null; render(); return; }
  if (act === 'su-submit') { submitSignup(el); return; }

  /* ---- Admin tab: PIN gate ---- */
  if (act === 'admin-unlock') {
    const val = document.getElementById('admin-pin-input').value;
    sha256(val).then(h => {
      const existing = state.settings.pinHash || '';
      if (existing) {
        if (h === existing) { localStorage.setItem(ADMIN_KEY, h); ui.pinError = ''; }
        else { ui.pinError = 'That PIN is not right.'; }
      } else if (val === '0000') {
        // bootstrap: first successful entry of the default PIN sets it for good
        localStorage.setItem(ADMIN_KEY, h);
        ui.pinError = '';
        saveSettings({ pinHash: h });
      } else {
        ui.pinError = 'That PIN is not right.';
      }
      render();
    });
    return;
  }
  if (act === 'admin-lock') { localStorage.removeItem(ADMIN_KEY); render(); return; }

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
    // whiteboard <-> podium sync, only when both are needed
    if (type === 'whiteboard' && needsOf(b).podium) {
      const u = unitById('whiteboard', unitId);
      const podId = u ? 'pod-' + u.num : null;
      const podFree = podId && !unitOccupant('podium', podId, b.date, b.start, b.end, b.id);
      assign.podium = podFree ? podId : null;
    }
    if (type === 'podium' && needsOf(b).whiteboard) {
      const u = unitById('podium', unitId);
      const wbId = u ? 'wb-' + u.num : null;
      const wbFree = wbId && !unitOccupant('whiteboard', wbId, b.date, b.start, b.end, b.id);
      assign.whiteboard = wbFree ? wbId : null;
    }
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
    syncAdminFormDraft(); ensureAdminFormDraft(upcomingSaturdayISO());
    const d = ui.adminForm;
    d.needs[el.dataset.id] = !d.needs[el.dataset.id];
    d.assign = { room: null, whiteboard: null, tv: null, podium: null };
    if (!d.needs.room) d.preferredRoom = null;
    render();
    return;
  }
  if (act === 'af-pref') { syncAdminFormDraft(); ensureAdminFormDraft(upcomingSaturdayISO()); ui.adminForm.preferredRoom = el.dataset.id || null; render(); return; }
  if (act === 'af-slot') {
    syncAdminFormDraft(); ensureAdminFormDraft(upcomingSaturdayISO());
    tapSlot(ui.adminForm, +el.dataset.win, el.dataset.id);
    ui.adminForm.assign = { room: null, whiteboard: null, tv: null, podium: null };
    render();
    return;
  }
  if (act === 'af-assign') {
    syncAdminFormDraft(); ensureAdminFormDraft(upcomingSaturdayISO());
    const d = ui.adminForm;
    const type = el.dataset.type, unitId = el.dataset.id;
    d.assign[type] = unitId;
    if (type === 'whiteboard' && d.needs.podium) {
      const u = unitById('whiteboard', unitId);
      const podId = u ? 'pod-' + u.num : null;
      const podFree = podId && !unitOccupant('podium', podId, d.date, d.start, d.end, '__new__');
      d.assign.podium = podFree ? podId : null;
    }
    if (type === 'podium' && d.needs.whiteboard) {
      const u = unitById('podium', unitId);
      const wbId = u ? 'wb-' + u.num : null;
      const wbFree = wbId && !unitOccupant('whiteboard', wbId, d.date, d.start, d.end, '__new__');
      d.assign.whiteboard = wbFree ? wbId : null;
    }
    render();
    return;
  }
  if (act === 'af-purpose') { syncAdminFormDraft(); ensureAdminFormDraft(upcomingSaturdayISO()); ui.adminForm.purpose = el.dataset.id; render(); return; }
  if (act === 'af-certainty') { syncAdminFormDraft(); ensureAdminFormDraft(upcomingSaturdayISO()); ui.adminForm.certainty = el.dataset.id; render(); return; }
  if (act === 'admin-add-submit') { submitAdminAdd(); return; }

  /* ---- Admin tab: housekeeping ---- */
  if (act === 'admin-cleanup') {
    const cutoff = addDaysISO(todayISO(), -56); // 8 weeks
    const old = bookingsList().filter(b => b.date < cutoff);
    if (!old.length) { addBanner('No records older than 8 weeks.'); return; }
    if (!confirm('Delete ' + old.length + ' booking' + (old.length === 1 ? '' : 's') + ' older than 8 weeks? This cannot be undone.')) return;
    old.forEach(b => fsDelete('bookings', b.id));
    addBanner('Removed ' + old.length + ' old booking' + (old.length === 1 ? '' : 's') + '.');
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

/* ================= swipe-to-switch-tabs (house convention) ================= */

function attachSwipeTabs(el) {
  if (!el) return;
  let touch = null;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { touch = null; return; }
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    const dt = Date.now() - touch.time;
    touch = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= 1.5 * Math.abs(dy) || dt >= 600) return;
    const idx = TABS.findIndex(t2 => t2.id === ui.tab);
    const next = idx + (dx < 0 ? 1 : -1);
    if (next < 0 || next >= TABS.length) return; // no wrap
    ui.tab = TABS[next].id;
    render();
  }, { passive: true });
}

/* ================= init ================= */

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  state = loadLocal() || { bookings: {}, settings: {} };
  saveLocal();
  render();

  attachSwipeTabs(document.getElementById('app'));
  const masthead = document.getElementById('masthead');
  if (masthead) masthead.addEventListener('click', () => { ui.tab = 'schedule'; ui.viewRef = false; render(); });

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
