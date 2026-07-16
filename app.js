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
  submitting: false
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

/* ---- placeholders — filled in by WP2 (Schedule/Sign Up) and WP3 (Admin) ---- */

function renderSchedule() {
  return '<div class="card"><h2>Schedule</h2>' +
    '<p class="section-note">See who has booked each study room and piece of equipment for the coming Sabbaths.</p>' +
    '<p class="hint">Coming in the next step.</p></div>';
}
function renderSignup() {
  return '<div class="card"><h2>Sign Up</h2>' +
    '<p class="section-note">Request a study room or equipment for a Sabbath booking window.</p>' +
    '<p class="hint">Coming in the next step.</p></div>';
}
function renderAdmin() {
  return '<div class="card"><h2>Admin</h2>' +
    '<p class="section-note">Approve or decline sign-up requests.</p>' +
    '<p class="hint">Coming in the next step.</p></div>';
}

/* ================= actions ================= */

function handleAction(act, el) {
  if (act === 'tab') { ui.tab = el.dataset.id; ui.pinError = ''; render(); return; }
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
