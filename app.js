'use strict';

/* =====================================================================
   LV Zion Study Rooms
   Sibling of worship-duty-app / new-song-app / morning-prayer-app /
   exhibition-tours (same architecture): vanilla JS, Firestore real-time
   sync with a full localStorage fallback, one screen of embedded CSS,
   no build step.

   Members sign up for a Sabbath-day study room or a piece of shared
   equipment (whiteboards, TV) inside one of two after-service booking
   windows; admins (PIN-gated, added in a later work package) approve or
   decline requests. This file (Work Package 1) lays the foundation only:
   the resource/time model, the Firestore sync layer, the tab shell, and
   the required swipe/header UX. WP2/WP3 fill in the Schedule, Sign Up,
   and Admin screens themselves.
   ===================================================================== */

/* ================= constants ================= */

const DATA_KEY = 'srs-data-v1';
const ADMIN_KEY = 'srs-admin-unlock';
const MY_BOOKINGS_KEY = 'srs-my-bookings';   // localStorage array of this device's own booking ids
const NAME_KEY = 'srs-name';                 // localStorage: last name typed on the Sign Up form

const PURPOSES = [
  { id: 'contact', label: 'Contact (Bible study)' },
  { id: 'new-member', label: 'New member study' },
  { id: 'meeting', label: 'Member meeting' },
  { id: 'other', label: 'Other' }
];

const RESOURCES = [
  { id: 'room-1', label: 'Study Room 1', category: 'room', capacity: 1 },
  { id: 'room-2', label: 'Study Room 2', category: 'room', capacity: 1 },
  { id: 'room-3', label: 'Study Room 3', category: 'room', capacity: 1 },
  { id: 'room-4', label: 'Study Room 4', category: 'room', capacity: 1 },
  { id: 'room-baptism', label: 'Baptism Room', category: 'room', capacity: 1 },
  { id: 'wb-large', label: 'Large Whiteboard', category: 'equipment', capacity: 2 },
  { id: 'wb-vertical', label: 'Vertical Whiteboard', category: 'equipment', capacity: 3 },
  { id: 'tv', label: 'TV', category: 'equipment', capacity: 3 },
];

const CATEGORIES = [
  { id: 'room', label: 'Study Rooms' },
  { id: 'wb', label: 'Whiteboards' },   // wb-large + wb-vertical
  { id: 'tv', label: 'TVs' },
];

/* Sabbath (Saturday) services: 9–10 AM, 3–4 PM, 8–9 PM. Bookings fill the
   gaps around them in two 30-min-slot windows; a booking's end must be
   ≤ the window's end, so the last possible start is 14:00 / 19:00. */
const SERVICES = [
  { start: '09:00', end: '10:00', label: 'Morning Service' },
  { start: '15:00', end: '16:00', label: 'Afternoon Service' },
  { start: '20:00', end: '21:00', label: 'Evening Service' },
];
const WINDOWS = [
  { start: '10:00', end: '14:30' },
  { start: '16:00', end: '19:30' },
];

const TABS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'signup', label: 'Sign Up' },
  { id: 'admin', label: 'Admin' },
];

/* ================= state ================= */

let state = {
  bookings: {},   // id -> { date, resourceId, start, end, name, purpose, purposeOther, note, status, createdAt, decidedAt }
  settings: {}    // { pinHash, ... }
};
let ui = {
  tab: 'schedule',
  pinError: '',
  submitting: false,
  schedDate: null,     // selected Saturday on the Schedule tab (ISO); lazily defaulted to the next Saturday
  signup: null,        // Sign Up form draft, created lazily by ensureSignupDraft()
  signupConfirm: null  // { id } of the just-submitted booking, while the confirmation panel is showing
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
function fmtDateLong(iso) {
  return dateObj(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
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
function nowHHMM() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function minsOfDay(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return (+m[1]) * 60 + (+m[2]);
}
function hhmmOfMins(mins) {
  return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
}
/* Next `n` Saturday ISO dates, chronological; includes today if today is Saturday. */
function nextSaturdays(n) {
  const out = [];
  const d = dateObj(todayISO());
  const offset = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  for (let i = 0; i < n; i++) {
    out.push(toISO(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
/* The booking window a given start time falls in, or null if it isn't a valid start. */
function windowFor(start) {
  const m = minsOfDay(start);
  return WINDOWS.find(w => m >= minsOfDay(w.start) && m < minsOfDay(w.end)) || null;
}
/* Every valid 30-min slot start inside a window (last start leaves room for a 30-min booking). */
function slotStarts(window) {
  const startMin = minsOfDay(window.start);
  const endMin = minsOfDay(window.end);
  const starts = [];
  for (let m = startMin; m + 30 <= endMin; m += 30) starts.push(hhmmOfMins(m));
  return starts;
}
/* Every valid end time for a booking beginning at `start` (30-min increments, up to the window's end). */
function validEndsFor(start) {
  const w = windowFor(start);
  if (!w) return [];
  const startMin = minsOfDay(start);
  const endMin = minsOfDay(w.end);
  const ends = [];
  for (let m = startMin + 30; m <= endMin; m += 30) ends.push(hhmmOfMins(m));
  return ends;
}
/* Half-open interval overlap: [aStart,aEnd) vs [bStart,bEnd). */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return minsOfDay(aStart) < minsOfDay(bEnd) && minsOfDay(bStart) < minsOfDay(aEnd);
}

/* ================= resource model ================= */

/* UI category ('room' | 'wb' | 'tv') for a resource id — the two whiteboards
   share a category tab even though they're separate resources underneath. */
function categoryOf(resourceId) {
  if (resourceId === 'wb-large' || resourceId === 'wb-vertical') return 'wb';
  if (resourceId === 'tv') return 'tv';
  const r = RESOURCES.find(x => x.id === resourceId);
  return r ? r.category : null;
}
function resourcesInCategory(categoryId) {
  return RESOURCES.filter(r => categoryOf(r.id) === categoryId);
}
function resourceById(id) {
  return RESOURCES.find(r => r.id === id) || null;
}

/* ================= booking model ================= */

function bookingsList() {
  return Object.keys(state.bookings).map(id => Object.assign({ id }, state.bookings[id]));
}
/* Bookings that still occupy a slot — cancelled/declined never do. */
function bookingsForResourceDate(resourceId, date) {
  return bookingsList().filter(b =>
    b.resourceId === resourceId && b.date === date && b.status !== 'cancelled' && b.status !== 'declined');
}
function overlappingBookings(resourceId, date, start, end, statuses) {
  return bookingsForResourceDate(resourceId, date)
    .filter(b => statuses.indexOf(b.status) !== -1 && rangesOverlap(b.start, b.end, start, end));
}
function purposeLabel(p) { const found = PURPOSES.find(x => x.id === p); return found ? found.label : (p || ''); }
function bookingPurposeText(b) {
  if (b.purpose === 'other' && b.purposeOther) return 'Other — ' + b.purposeOther;
  return purposeLabel(b.purpose);
}
const STATUS_LABEL = { pending: 'Pending review', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

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
  el.textContent = label || (on ? 'live sync' : 'local');
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

  const tabs = document.getElementById('tabs');
  if (tabs) {
    tabs.innerHTML = TABS.map(t =>
      '<button class="tab' + (ui.tab === t.id ? ' active' : '') + '" data-act="tab" data-id="' + t.id + '">' + t.label + '</button>'
    ).join('');
  }

  if (ui.tab === 'signup') app.innerHTML = renderSignup();
  else if (ui.tab === 'admin') app.innerHTML = renderAdmin();
  else app.innerHTML = renderSchedule();
}

/* ---- Schedule (WP2) ---- */

function renderSchedule() {
  const dates = nextSaturdays(8);
  if (!ui.schedDate || dates.indexOf(ui.schedDate) === -1) ui.schedDate = dates[0];

  let html = '<div class="card"><h2>Schedule</h2>' +
    '<p class="section-note">See who has booked each study room and piece of equipment for the coming Sabbaths.</p>' +
    satChipsHtml(dates) +
    '</div>';
  CATEGORIES.forEach(cat => { html += renderCategoryGrid(cat, ui.schedDate); });
  html += legendHtml();
  html += renderMyRequests();
  return html;
}

function satChipsHtml(dates) {
  return '<div class="sat-chips">' + dates.map(iso => {
    const d = dateObj(iso);
    return '<button class="sat-chip' + (iso === ui.schedDate ? ' active' : '') + '" data-act="sched-date" data-id="' + iso + '">' +
      '<span class="sc-dow">' + esc(d.toLocaleDateString(undefined, { weekday: 'short' })) + '</span>' +
      '<span class="sc-num">' + d.getDate() + '</span>' +
      '<span class="sc-mon">' + esc(d.toLocaleDateString(undefined, { month: 'short' })) + '</span>' +
      '</button>';
  }).join('') + '</div>';
}

function renderCategoryGrid(cat, date) {
  const resources = resourcesInCategory(cat.id);
  let html = '<div class="card sched-cat"><h2>' + esc(cat.label) + '</h2>';
  WINDOWS.forEach((w, wi) => {
    html += renderWindowGrid(w, wi, resources, date);
    if (wi === 0) html += '<div class="service-div">' + esc(fmtTime(SERVICES[1].start)) + ' Service</div>';
  });
  html += '</div>';
  return html;
}

/* '10:00 AM' -> '10:00'; keeps header cells narrow. */
function shortTime(hhmm) { return fmtTime(hhmm).replace(/\s?(AM|PM)$/, ''); }

function renderWindowGrid(w, idx, resources, date) {
  const slots = slotStarts(w);
  const label = (idx === 0 ? 'Morning window' : 'Afternoon window') + ' · ' + fmtTime(w.start) + '–' + fmtTime(w.end);
  let html = '<div class="sched-window">' +
    '<div class="sched-window-label">' + esc(label) + '</div>' +
    '<div class="sched-scroll"><div class="sched-grid" style="grid-template-columns:92px repeat(' + slots.length + ',46px)">' +
    '<div class="sc-cell sc-corner"></div>' +
    slots.map(s => '<div class="sc-cell sc-time">' + esc(shortTime(s)) + '</div>').join('');
  resources.forEach(r => {
    html += '<div class="sc-cell sc-label">' + esc(r.label) +
      (r.capacity > 1 ? '<span class="sc-cap">up to ' + r.capacity + '</span>' : '') + '</div>';
    html += renderRowRuns(r, date, slots);
  });
  html += '</div></div></div>';
  return html;
}

/* Groups consecutive 30-min slots that share the exact same set of active
   bookings into one spanning cell, so a multi-slot booking reads as one
   continuous block instead of repeating across separate cells. */
function renderRowRuns(resource, date, slots) {
  const active = bookingsForResourceDate(resource.id, date);
  const cells = slots.map(s => {
    const e = hhmmOfMins(minsOfDay(s) + 30);
    const hits = active.filter(b => rangesOverlap(b.start, b.end, s, e));
    return { key: hits.map(b => b.id).sort().join(','), hits: hits };
  });
  let html = '';
  let i = 0;
  while (i < cells.length) {
    let j = i + 1;
    while (j < cells.length && cells[j].key === cells[i].key) j++;
    html += runCellHtml(cells[i].hits, resource, j - i);
    i = j;
  }
  return html;
}

function runCellHtml(hits, resource, span) {
  const style = 'grid-column:span ' + span + ';';
  if (!hits.length) return '<div class="sc-cell sc-slot free" style="' + style + '"></div>';

  const approved = hits.filter(b => b.status === 'approved');
  const pending = hits.filter(b => b.status === 'pending');
  const title = hits.map(b => b.name + ' (' + STATUS_LABEL[b.status] + ')').join(', ');
  let cls, content;
  if (hits.length === 1) {
    cls = hits[0].status === 'approved' ? 'approved' : 'pending';
    content = esc(hits[0].name);
  } else if (approved.length) {
    cls = 'approved';
    content = approved.length + ' of ' + resource.capacity + ' in use' +
      (pending.length ? ' · ' + pending.length + ' pending' : '');
  } else {
    cls = 'pending';
    content = pending.length + ' requested';
  }
  return '<div class="sc-cell sc-slot ' + cls + '" style="' + style + '" title="' + esc(title) + '">' + content + '</div>';
}

function legendHtml() {
  return '<div class="card sched-legend">' +
    '<div class="legend-row"><span class="legend-swatch pending"></span> Pending review</div>' +
    '<div class="legend-row"><span class="legend-swatch approved"></span> Approved</div>' +
    '</div>';
}

function renderMyRequests() {
  const items = myBookingIds()
    .map(id => state.bookings[id] ? Object.assign({ id: id }, state.bookings[id]) : null)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!items.length) return '';

  let html = '<div class="card"><h2>My requests</h2>';
  items.forEach(b => {
    const r = resourceById(b.resourceId);
    html += '<div class="req-row">' +
      '<div class="req-head">' + esc(r ? r.label : b.resourceId) +
      ' <span class="badge ' + esc(b.status) + '">' + esc(STATUS_LABEL[b.status] || b.status) + '</span></div>' +
      '<div class="req-sub">' + esc(fmtDate(b.date)) + ' · ' + esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) +
      ' · ' + esc(bookingPurposeText(b)) + '</div>' +
      (b.status === 'pending'
        ? '<div class="req-actions"><button class="btn small danger" data-act="my-cancel" data-id="' + esc(b.id) + '">Cancel request</button></div>'
        : '') +
      '</div>';
  });
  html += '</div>';
  return html;
}

/* ---- Sign Up (WP2) ---- */

function ensureSignupDraft() {
  if (ui.signup) return;
  const dates = nextSaturdays(8);
  const date = ui.schedDate && dates.indexOf(ui.schedDate) !== -1 ? ui.schedDate : dates[0];
  const category = 'room';
  const resources = resourcesInCategory(category);
  const start = slotStarts(WINDOWS[0])[0];
  ui.signup = {
    date: date,
    category: category,
    resourceId: resources[0] ? resources[0].id : '',
    start: start,
    end: validEndsFor(start)[0] || '',
    name: localStorage.getItem(NAME_KEY) || '',
    purpose: 'contact',
    purposeOther: '',
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

function signupConflictHint(d) {
  const resource = resourceById(d.resourceId);
  if (!resource || !d.start || !d.end) return null;
  const approved = overlappingBookings(d.resourceId, d.date, d.start, d.end, ['approved']);
  const pending = overlappingBookings(d.resourceId, d.date, d.start, d.end, ['pending']);
  if (approved.length >= resource.capacity) {
    const b = approved[0];
    return { warn: true, html: esc(resource.label) + ' is already approved for someone else ' +
      esc(fmtTime(b.start)) + '–' + esc(fmtTime(b.end)) + ' — you can still ask, but it may be declined.' };
  }
  if (pending.length) return { warn: false, html: 'Someone else has also requested this time.' };
  return null;
}

function availabilityHintHtml(d) {
  const r = resourceById(d.resourceId);
  const list = bookingsForResourceDate(d.resourceId, d.date)
    .filter(b => b.status === 'approved' || b.status === 'pending')
    .sort((a, b) => minsOfDay(a.start) - minsOfDay(b.start));
  if (!list.length) return '<p class="hint">No requests yet for ' + esc(r ? r.label : '') + ' on this date.</p>';
  const parts = list.map(b => fmtTime(b.start) + '–' + fmtTime(b.end) + ' (' + STATUS_LABEL[b.status].toLowerCase() + ')');
  return '<p class="hint">Already on this date: ' + esc(parts.join(', ')) + '</p>';
}

function startGroupOptionsHtml(selected) {
  return WINDOWS.map((w, i) =>
    '<optgroup label="' + (i === 0 ? 'Morning window' : 'Afternoon window') + '">' +
    slotStarts(w).map(s => '<option value="' + s + '"' + (s === selected ? ' selected' : '') + '>' + esc(fmtTime(s)) + '</option>').join('') +
    '</optgroup>'
  ).join('');
}

function renderSignup() {
  if (ui.signupConfirm) return renderSignupConfirm();
  ensureSignupDraft();
  const d = ui.signup;
  const dates = nextSaturdays(8);
  const resources = resourcesInCategory(d.category);
  if (!resources.some(r => r.id === d.resourceId)) d.resourceId = resources[0] ? resources[0].id : '';
  const endOptions = validEndsFor(d.start);
  if (endOptions.indexOf(d.end) === -1) d.end = endOptions[0] || '';
  const hint = signupConflictHint(d);

  let html = '<div class="card"><h2>Sign Up</h2>' +
    '<p class="section-note">Request a study room or piece of equipment for a Sabbath booking window. A committee member will review and approve or decline it.</p>' +
    '<form data-act="su-submit">' +

    '<label class="fld">1. Saturday</label>' +
    '<select data-chg="su-date">' +
    dates.map(iso => '<option value="' + iso + '"' + (iso === d.date ? ' selected' : '') + '>' + esc(fmtDate(iso)) + '</option>').join('') +
    '</select>' +

    '<label class="fld">2. What do you need?</label>' +
    '<div class="seg">' + CATEGORIES.map(c =>
      '<button type="button" class="seg-btn' + (c.id === d.category ? ' active' : '') + '" data-act="su-cat" data-id="' + c.id + '">' + esc(c.label) + '</button>'
    ).join('') + '</div>' +
    '<select data-chg="su-resource" style="margin-top:8px">' +
    resources.map(r => '<option value="' + r.id + '"' + (r.id === d.resourceId ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('') +
    '</select>' +
    availabilityHintHtml(d) +

    '<label class="fld">3. Time</label>' +
    '<div class="form-row">' +
    '<div><label class="fld" style="margin-top:0">Start</label><select data-chg="su-start">' + startGroupOptionsHtml(d.start) + '</select></div>' +
    '<div><label class="fld" style="margin-top:0">End</label><select data-chg="su-end">' +
    endOptions.map(e => '<option value="' + e + '"' + (e === d.end ? ' selected' : '') + '>' + esc(fmtTime(e)) + '</option>').join('') +
    '</select></div>' +
    '</div>' +
    (hint ? '<p class="' + (hint.warn ? 'conflict-warn' : 'conflict-note') + '">' + hint.html + '</p>' : '') +

    '<label class="fld">4. Your name</label>' +
    '<input type="text" id="su-name" value="' + esc(d.name) + '" placeholder="Full name" autocomplete="name" required>' +

    '<label class="fld">5. Purpose</label>' +
    '<div class="stack">' + PURPOSES.map(p =>
      '<label class="radio-row"><input type="radio" name="su-purpose" value="' + p.id + '"' +
      (p.id === d.purpose ? ' checked' : '') + ' data-chg="su-purpose"> ' + esc(p.label) + '</label>'
    ).join('') + '</div>' +
    (d.purpose === 'other'
      ? '<input type="text" id="su-other" value="' + esc(d.purposeOther) + '" placeholder="Please describe" style="margin-top:8px" required>'
      : '') +

    '<label class="fld">6. Note (optional)</label>' +
    '<input type="text" id="su-note" value="' + esc(d.note) + '" placeholder="Anything the reviewer should know">' +

    '<div style="margin-top:16px"><button class="btn primary big" type="submit"' + (ui.submitting ? ' disabled' : '') + '>' +
    (ui.submitting ? 'Submitting…' : 'Submit request') + '</button></div>' +
    '</form></div>';
  return html;
}

function renderSignupConfirm() {
  return '<div class="card"><h2>Request sent</h2>' +
    '<p class="section-note">Your request is in — it’s waiting for approval. Check the Schedule tab any time to see its status.</p>' +
    '<button class="btn primary big" data-act="su-again">Make another request</button>' +
    '</div>';
}

function submitSignup(form) {
  if (ui.submitting) return; // double-submit guard
  syncSignupDraft();
  const d = ui.signup;
  const name = (d.name || '').trim();
  const note = (d.note || '').trim();
  const purposeOther = (d.purposeOther || '').trim();

  if (!d.date || !d.resourceId || !d.start || validEndsFor(d.start).indexOf(d.end) === -1) {
    addBanner('Please complete the Saturday, resource, and time fields.', true); return;
  }
  if (!name) { addBanner('Please enter your name.', true); return; }
  if (d.purpose === 'other' && !purposeOther) { addBanner('Please describe the purpose.', true); return; }

  ui.submitting = true;
  const btn = form ? form.querySelector('button[type=submit]') : null;
  if (btn) btn.disabled = true; // belt & suspenders: dead until the re-render
  const id = uid();
  fsSet('bookings', id, {
    date: d.date,
    resourceId: d.resourceId,
    start: d.start,
    end: d.end,
    name: name,
    purpose: d.purpose,
    purposeOther: d.purpose === 'other' ? purposeOther : '',
    note: note,
    status: 'pending',
    createdAt: Date.now()
  });
  addMyBookingId(id);
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage full/blocked */ }
  ui.submitting = false;
  ui.signupConfirm = { id: id };
  render();
}

function renderAdmin() {
  return '<div class="card"><h2>Admin</h2>' +
    '<p class="section-note">Approve or decline sign-up requests.</p>' +
    '<p class="hint">Coming in the next step.</p></div>';
}

/* ================= actions ================= */

function handleAction(act, el) {
  if (act === 'tab') { ui.tab = el.dataset.id; ui.pinError = ''; render(); return; }

  /* ---- Schedule tab ---- */
  if (act === 'sched-date') { ui.schedDate = el.dataset.id; render(); return; }
  if (act === 'my-cancel') {
    const b = state.bookings[el.dataset.id];
    if (!b || b.status !== 'pending') return; // members may only cancel their own PENDING requests
    fsSet('bookings', el.dataset.id, Object.assign({}, b, { status: 'cancelled' }));
    return;
  }

  /* ---- Sign Up tab ---- */
  if (act === 'su-cat') {
    syncSignupDraft();
    ensureSignupDraft();
    ui.signup.category = el.dataset.id;
    const resources = resourcesInCategory(el.dataset.id);
    ui.signup.resourceId = resources[0] ? resources[0].id : '';
    render();
    return;
  }
  if (act === 'su-again') { ui.signupConfirm = null; render(); return; }
  if (act === 'su-submit') { submitSignup(el); return; }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  if (el.tagName === 'FORM') return; // forms fire via submit
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
  const chg = el.dataset.chg;
  if (chg === 'su-date' || chg === 'su-resource' || chg === 'su-purpose') {
    syncSignupDraft();
    ensureSignupDraft();
    if (chg === 'su-date') ui.signup.date = el.value;
    if (chg === 'su-resource') ui.signup.resourceId = el.value;
    if (chg === 'su-purpose') ui.signup.purpose = el.value;
    render();
  } else if (chg === 'su-start') {
    syncSignupDraft();
    ensureSignupDraft();
    ui.signup.start = el.value;
    ui.signup.end = validEndsFor(el.value)[0] || '';
    render();
  } else if (chg === 'su-end') {
    syncSignupDraft();
    ensureSignupDraft();
    ui.signup.end = el.value;
    render();
  }
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
  if (masthead) masthead.addEventListener('click', () => { ui.tab = 'schedule'; render(); });

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
