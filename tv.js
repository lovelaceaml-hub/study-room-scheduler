'use strict';

const FIREBASE_VERSION = '10.12.2';
const CACHE_KEY = 'srs-tv-cache-v1';

const RESOURCES = [
  {
    id: 'room',
    label: 'Study Rooms',
    pendingLabel: 'Room requests',
    units: [1, 2, 3, 4].map(n => ({ id: `room-${n}`, label: `Study Room ${n}` }))
  },
  {
    id: 'whiteboard',
    label: 'Whiteboards',
    pendingLabel: 'Whiteboard requests',
    units: [
      { id: 'wb-1', label: 'Whiteboard 1', detail: 'Large · Podium 1' },
      { id: 'wb-2', label: 'Whiteboard 2', detail: 'Large · Podium 2' },
      { id: 'wb-3', label: 'Whiteboard 3', detail: 'Large · Podium 3' },
      { id: 'wb-4', label: 'Whiteboard 4', detail: 'Vertical · Podium 4' },
      { id: 'wb-5', label: 'Whiteboard 5', detail: 'Vertical · Podium 5' }
    ]
  },
  {
    id: 'tv',
    label: 'TVs',
    pendingLabel: 'TV requests',
    units: [1, 2, 3].map(n => ({ id: `tv-${n}`, label: `TV ${n}` }))
  }
];

const dayConfig = {
  2: {
    name: 'Tuesday',
    start: '10:00',
    end: '22:00',
    services: [{ start: '20:00', end: '21:00', label: 'Service' }]
  },
  6: {
    name: 'Saturday',
    start: '09:00',
    end: '22:00',
    services: [
      { start: '09:00', end: '10:00', label: 'Service' },
      { start: '15:00', end: '16:00', label: 'Service' },
      { start: '20:00', end: '21:00', label: 'Service' }
    ]
  }
};

let bookings = [];
let lastUpdatedAt = 0;
let unsubscribe = null;
let reconnectTimer = null;
let reconnectDelay = 3000;
let renderedDate = '';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function localISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function formatTime(time, compact = false) {
  const total = minutes(time);
  if (!Number.isFinite(total)) return '';
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  if (compact) return minute ? `${hour}:${pad(minute)}` : `${hour}`;
  return `${hour}:${pad(minute)} ${suffix}`;
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function publicName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(part => !/^(brother|sister|elder|missionary|deacon|deaconess|pastor)$/i.test(part));
  // Member lists sometimes use a title initial (for example, "B. Anthony L").
  // It is not the person's first name, so omit it from the public TV version.
  if (parts.length > 1 && /^[BSEMDP]\.$/i.test(parts[0])) parts.shift();
  if (!parts.length) return 'Reserved';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

function isDisplayableBooking(booking) {
  return booking &&
    booking.date === localISO() &&
    (booking.status === 'approved' || booking.status === 'pending') &&
    typeof booking.needs === 'object' &&
    Number.isFinite(minutes(booking.start)) &&
    Number.isFinite(minutes(booking.end)) &&
    minutes(booking.start) < minutes(booking.end);
}

// Keep the lobby display's in-memory/cache model intentionally narrow. Private
// request details (notes, purpose text, and room preference) are never retained.
function toPublicBooking(id, booking) {
  return {
    id,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    name: publicName(booking.name),
    needs: booking.needs || {},
    status: booking.status,
    assignments: booking.assignments || {},
    createdAt: booking.createdAt || 0,
    blocked: booking.blocked === true || booking.purpose === 'blocked'
  };
}

function bookingName(booking) {
  return booking.blocked ? 'Reserved' : publicName(booking.name);
}

function positionStyle(start, end, config) {
  const total = minutes(config.end) - minutes(config.start);
  const clippedStart = Math.max(minutes(start), minutes(config.start));
  const clippedEnd = Math.min(minutes(end), minutes(config.end));
  const left = (clippedStart - minutes(config.start)) / total * 100;
  const width = Math.max(0, clippedEnd - clippedStart) / total * 100;
  return `left:${left.toFixed(4)}%;width:${width.toFixed(4)}%`;
}

function overlapsVisibleRange(booking, config) {
  return minutes(booking.start) < minutes(config.end) && minutes(config.start) < minutes(booking.end);
}

function serviceBlocks(config) {
  return config.services.map(service =>
    `<span class="service-block" style="${positionStyle(service.start, service.end, config)}" aria-label="${escapeHtml(service.label)} from ${escapeHtml(formatTime(service.start))} to ${escapeHtml(formatTime(service.end))}">${escapeHtml(service.label)}</span>`
  ).join('');
}

function currentTimeMarker(config) {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  if (current < minutes(config.start) || current > minutes(config.end)) return '';
  const percentage = (current - minutes(config.start)) / (minutes(config.end) - minutes(config.start)) * 100;
  return `<span class="current-time" style="left:${percentage.toFixed(4)}%" aria-hidden="true"></span>`;
}

function bookingChip(booking, config, pending, lane = 0) {
  if (!overlapsVisibleRange(booking, config)) return '';
  const title = pending
    ? `${bookingName(booking)} — requested, awaiting approval — ${formatTime(booking.start)} to ${formatTime(booking.end)}`
    : `${bookingName(booking)} — ${formatTime(booking.start)} to ${formatTime(booking.end)}`;
  return `<div class="booking${pending ? ' pending' : ''}" style="${positionStyle(booking.start, booking.end, config)};--lane:${lane}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
    <span class="booking-name">${escapeHtml(bookingName(booking))}</span>
    ${pending ? '<span class="booking-status">Requested — awaiting approval</span>' : ''}
    <span class="booking-time">${escapeHtml(formatTime(booking.start, true))}–${escapeHtml(formatTime(booking.end, true))}</span>
  </div>`;
}

function timelineTrack(content, config, showEmpty = false) {
  return `<div class="track" style="--slot-width:${(30 / (minutes(config.end) - minutes(config.start)) * 100).toFixed(4)}%">
    ${serviceBlocks(config)}
    ${showEmpty && !content ? '<span class="empty-note">Available</span>' : ''}
    ${content}
    ${currentTimeMarker(config)}
  </div>`;
}

function timeRuler(config) {
  const ticks = [];
  const start = minutes(config.start);
  const end = minutes(config.end);
  for (let value = start; value <= end; value += 60) ticks.push(value);
  if (ticks[ticks.length - 1] !== end) ticks.push(end);
  const labels = ticks.map((value, index) => {
    const percentage = (value - start) / (end - start) * 100;
    const edgeClass = index === 0 ? ' edge-start' : index === ticks.length - 1 ? ' edge-end' : '';
    const hhmm = `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
    return `<span class="tick${edgeClass}" style="left:${percentage.toFixed(4)}%">${escapeHtml(formatTime(hhmm))}</span>`;
  }).join('');
  return `<div class="time-ruler">
    <div class="ruler-label">Today</div>
    <div class="track ruler-track" style="--slot-width:${(30 / (end - start) * 100).toFixed(4)}%">${labels}${currentTimeMarker(config)}</div>
  </div>`;
}

function approvedForUnit(type, unitId, config) {
  return bookings
    .filter(isDisplayableBooking)
    .filter(booking => booking.status === 'approved' && booking.needs[type] && booking.assignments && booking.assignments[type] === unitId)
    .sort((a, b) => minutes(a.start) - minutes(b.start))
    .map(booking => bookingChip(booking, config, false))
    .join('');
}

function pendingForType(type, config) {
  const pending = bookings
    .filter(isDisplayableBooking)
    .filter(booking => booking.status === 'pending' && booking.needs[type])
    .sort((a, b) => minutes(a.start) - minutes(b.start) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const laneEnds = [];
  const html = pending.map(booking => {
    let lane = laneEnds.findIndex(end => minutes(booking.start) >= end);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = minutes(booking.end);
    return bookingChip(booking, config, true, lane);
  }).join('');
  return { html, laneCount: Math.max(1, laneEnds.length) };
}

function resourceSection(resource, config) {
  const unitRows = resource.units.map(unit => {
    const chips = approvedForUnit(resource.id, unit.id, config);
    return `<div class="schedule-row">
      <div class="row-label">${escapeHtml(unit.label)}${unit.detail ? `<small>${escapeHtml(unit.detail)}</small>` : ''}</div>
      ${timelineTrack(chips, config, true)}
    </div>`;
  }).join('');

  const pending = pendingForType(resource.id, config);
  return `<section aria-label="${escapeHtml(resource.label)}">
    <div class="category-title">${escapeHtml(resource.label)}</div>
    ${unitRows}
    <div class="schedule-row pending-row" style="--pending-lanes:${pending.laneCount}">
      <div class="row-label">${escapeHtml(resource.pendingLabel)}<small>Requested — awaiting approval</small></div>
      ${timelineTrack(pending.html, config, false)}
    </div>
  </section>`;
}

function render() {
  const now = new Date();
  const date = localISO(now);
  const config = dayConfig[now.getDay()];
  const schedule = document.getElementById('schedule');
  document.getElementById('today-label').textContent = now.toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  if (!config) {
    schedule.innerHTML = `<section class="closed-day">
      <h2>No study-room schedule today</h2>
      <p>The lobby schedule is shown on Tuesdays and Saturdays.</p>
    </section>`;
    renderedDate = date;
    return;
  }

  schedule.innerHTML = `<div class="board" aria-label="${escapeHtml(config.name)} study room schedule">
    ${timeRuler(config)}
    ${RESOURCES.map(resource => resourceSection(resource, config)).join('')}
  </div>`;
  renderedDate = date;
}

function setConnection(state, label) {
  const element = document.getElementById('connection');
  element.className = `connection${state === 'live' ? '' : ` ${state}`}`;
  document.getElementById('connection-label').textContent = label;
  updateLastUpdatedLabel();
}

function updateLastUpdatedLabel() {
  const label = document.getElementById('updated-label');
  label.textContent = lastUpdatedAt
    ? `Last updated ${new Date(lastUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : '';
}

function saveCache() {
  try {
    const todayBookings = bookings.filter(booking => booking && booking.date === localISO());
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      date: localISO(),
      bookings: todayBookings,
      updatedAt: lastUpdatedAt
    }));
  } catch (error) {
    console.warn('Could not save the TV schedule cache.', error);
  }
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!cached || cached.date !== localISO() || !Array.isArray(cached.bookings)) return;
    bookings = cached.bookings.map(booking => toPublicBooking(booking.id, booking));
    lastUpdatedAt = Number(cached.updatedAt) || 0;
  } catch (error) {
    console.warn('Could not read the TV schedule cache.', error);
  }
}

function scheduleReconnect(connect) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 60000);
}

async function initFirebase() {
  if (!window.FIREBASE_CONFIG) {
    setConnection('error', 'Schedule unavailable');
    return;
  }

  const appMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
  const firestoreMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
  const app = appMod.getApps().find(candidate => candidate.name === 'lobby-tv') ||
    appMod.initializeApp(window.FIREBASE_CONFIG, 'lobby-tv');
  const db = firestoreMod.getFirestore(app);

  const connect = () => {
    if (unsubscribe) unsubscribe();
    setConnection('reconnecting', bookings.length ? 'Reconnecting' : 'Connecting');
    const todayQuery = firestoreMod.query(
      firestoreMod.collection(db, 'bookings'),
      firestoreMod.where('date', '==', localISO())
    );
    unsubscribe = firestoreMod.onSnapshot(
      todayQuery,
      { includeMetadataChanges: true },
      snapshot => {
        if (!(snapshot.metadata.fromCache && snapshot.empty && bookings.length)) {
          bookings = snapshot.docs.map(doc => toPublicBooking(doc.id, doc.data()));
          render();
        }
        if (snapshot.metadata.fromCache) {
          setConnection('reconnecting', 'Reconnecting');
        } else {
          reconnectDelay = 3000;
          lastUpdatedAt = Date.now();
          saveCache();
          setConnection('live', 'Live');
        }
      },
      error => {
        console.warn('Lobby schedule listener failed.', error);
        setConnection('reconnecting', 'Reconnecting');
        scheduleReconnect(connect);
      }
    );
  };

  connect();
}

function startFirebase() {
  initFirebase().catch(error => {
    console.warn('Lobby schedule could not connect.', error);
    setConnection('reconnecting', bookings.length ? 'Reconnecting' : 'Schedule unavailable');
    scheduleReconnect(startFirebase);
  });
}

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = formatClock(now);
  if (localISO(now) !== renderedDate) {
    bookings = [];
    lastUpdatedAt = 0;
    loadCache();
    render();
    // The listener query is date-specific. Restart it at midnight so a lobby
    // display left open overnight subscribes to the new day automatically.
    startFirebase();
  }
}

function init() {
  loadCache();
  render();
  updateClock();
  updateLastUpdatedLabel();

  window.addEventListener('offline', () => setConnection('reconnecting', 'Reconnecting'));
  window.addEventListener('online', () => setConnection('reconnecting', 'Reconnecting'));

  setInterval(updateClock, 1000);
  setInterval(render, 30000);

  startFirebase();
}

init();
