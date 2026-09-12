'use strict';

const CACHE_KEY = 'srs-tv-cache-v2';
const PUBLIC_LOBBY_SCHEDULE_URL = 'https://us-west1-lvz-rooms.cloudfunctions.net/publicLobbySchedule';
const SCHEDULE_REFRESH_MS = 60000;
const PUBLIC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// The lobby display is intentionally limited to the four study rooms. Shared
// equipment and pending requests are useful in the member/Admin app, but they
// make a room-finding display harder to read from across the lobby.
const ROOM_UNITS = [1, 2, 3, 4].map(n => ({ id: `room-${n}`, label: `Study Room ${n}` }));
const ROOM_IDS = new Set(ROOM_UNITS.map(unit => unit.id));

// 10:30 PM is the final bookable start. The display includes the resulting
// 10:30–11:00 PM assignment, so every schedule ends at 11:00 PM.
// Service times changed on 12 September 2026.
const dayConfig = {
  2: {
    name: 'Tuesday',
    start: '10:00',
    end: '23:00',
    services: [{ start: '19:30', end: '20:30', label: 'Service' }]
  },
  6: {
    name: 'Saturday',
    start: '10:00',
    end: '23:00',
    services: [
      { start: '10:00', end: '11:00', label: 'Service' },
      { start: '14:30', end: '15:30', label: 'Service' },
      { start: '19:30', end: '20:30', label: 'Service' }
    ]
  }
};

let bookings = [];
let lastUpdatedAt = 0;
let selectedDate = '';
let reconnectTimer = null;
let refreshTimer = null;
let reconnectDelay = 3000;
let scheduleRequestGeneration = 0;
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

function dateFromISO(date) {
  return new Date(`${date}T12:00:00`);
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

function formatDate(date) {
  return dateFromISO(date).toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function formatChoiceDate(date, isToday) {
  if (isToday) return 'Today';
  return dateFromISO(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function isDemoMode() {
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

function dateForWeekday(today, weekday) {
  const date = dateFromISO(today);
  date.setDate(date.getDate() + (weekday - date.getDay() + 7) % 7);
  return localISO(date);
}

// The switcher deliberately includes Today even when no room schedule is
// running, followed by the two bookable dates. Duplicate calendar dates are
// removed when Today is Tuesday or Saturday.
function offeredDates(today = localISO()) {
  return [...new Set([today, dateForWeekday(today, 2), dateForWeekday(today, 6)])];
}

function isAllowedDate(date) {
  return offeredDates().includes(date);
}

function selectedConfig() {
  return dayConfig[dateFromISO(selectedDate).getDay()];
}

function publicName(name, peers = []) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  const titles = {brother:'B', sister:'S', elder:'E', missionary:'M', deacon:'D', deaconess:'D', pastor:'P'};
  let titleInitial = '';
  if (tokens.length) {
    const candidate = tokens[0].replace(/[.,]+$/g, '').toLowerCase();
    titleInitial = titles[candidate] || (/^[BSEMDP]$/i.test(candidate) ? candidate.toUpperCase() : '');
    if (titleInitial) tokens.shift();
  }
  const givenName = tokens.shift() || '';
  const surname = tokens.join(' ');
  const surnameParts = surname.split(/\s+/).filter(Boolean);
  const surnameKey = surnameParts.length === 1 && /^[\p{L}]$/u.test(surname.replace(/[.,]+/g, '')) ? `initial:${surname.toLowerCase()}` : `name:${surname.toLowerCase()}`;
  const collision = peers.some(peer => {
    const other = publicNameParts(peer);
    return other.givenName.toLowerCase() === givenName.toLowerCase() && other.surnameKey !== surnameKey;
  });
  return [titleInitial, givenName, collision ? surname.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() : ''].filter(Boolean).join(' ') || 'Reserved';
}
function publicNameParts(name) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length && (/^(brother|sister|elder|missionary|deacon|deaconess|pastor)$/i.test(tokens[0]) || /^[BSEMDP][.]?$/i.test(tokens[0]))) tokens.shift();
  const givenName = tokens.shift() || '';
  const surname = tokens.join(' ');
  const clean = surname.replace(/[.,]+/g, '');
  return {givenName, surnameKey: clean.length === 1 ? `initial:${clean.toLowerCase()}` : `name:${clean.toLowerCase()}`};
}

function toPublicBookings(entries) {
  const peers = entries.map(entry => entry.name).filter(Boolean);
  return entries.map(entry => toPublicBooking(entry.id, entry, peers));
}

function isPublicScheduleEntry(entry) {
  return entry && typeof entry === 'object' &&
    PUBLIC_DATE_PATTERN.test(entry.date) && PUBLIC_TIME_PATTERN.test(entry.start) &&
    PUBLIC_TIME_PATTERN.test(entry.end) && entry.start < entry.end &&
    ROOM_IDS.has(entry.room) && typeof entry.name === 'string' && entry.name.trim().length > 0;
}

function toPublicScheduleBooking(entry, index) {
  return { id: `lobby-${entry.date}-${entry.room}-${entry.start}-${entry.end}-${index}`, date: entry.date, start: entry.start, end: entry.end, name: entry.name, status: 'approved', needs: { room: true }, assignments: { room: entry.room } };
}

function normalizePublicSchedule(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.bookings) || typeof payload.generatedAt !== 'string') throw new Error('The public lobby schedule response is malformed.');
  const updatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(updatedAt)) throw new Error('The public lobby schedule timestamp is malformed.');
  const entries = payload.bookings.filter(isPublicScheduleEntry);
  if (payload.bookings.length && !entries.length) throw new Error('The public lobby schedule contains no safe bookings.');
  return { bookings: toPublicBookings(entries.map(toPublicScheduleBooking)), updatedAt };
}

// Keep the privacy formatter directly verifiable in the browser smoke test
// without exposing an application control in normal TV use.
if (new URLSearchParams(location.search).get('test') === '1') {
  window.__SRS_TV_TEST_HELPERS__ = { publicName };
}

function isDisplayableBooking(booking) {
  return booking &&
    booking.date === selectedDate &&
    (booking.status === 'approved' || booking.status === 'pending') &&
    typeof booking.needs === 'object' &&
    Number.isFinite(minutes(booking.start)) &&
    Number.isFinite(minutes(booking.end)) &&
    minutes(booking.start) < minutes(booking.end);
}

// Keep the lobby model intentionally narrow. Names are reduced before they
// reach storage or rendering; private notes, owners, and purpose text never do.
function toPublicBooking(id, booking, peers = []) {
  return {
    id,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    name: publicName(booking.name, peers),
    needs: booking.needs || {},
    status: booking.status,
    assignments: booking.assignments || {},
    createdAt: booking.createdAt || 0,
    blocked: booking.blocked === true || booking.purpose === 'blocked'
  };
}

function bookingName(booking) {
  return booking.blocked ? 'Reserved' : booking.name || 'Reserved';
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
  // A red "Now" line only makes sense on the actual calendar day.
  if (selectedDate !== localISO()) return '';
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
    <div class="ruler-label">${escapeHtml(config.name)} · ${escapeHtml(formatTime(config.start))}</div>
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

function approvedBookingsForRoom(unitId) {
  return bookings
    .filter(isDisplayableBooking)
    .filter(booking => booking.status === 'approved' && booking.needs.room && booking.assignments && booking.assignments.room === unitId)
    .sort((a, b) => minutes(a.start) - minutes(b.start));
}

function roomTimeline(config) {
  const unitRows = ROOM_UNITS.map(unit => {
    const chips = approvedForUnit('room', unit.id, config);
    return `<div class="schedule-row">
      <div class="row-label">${escapeHtml(unit.label)}</div>
      ${timelineTrack(chips, config, true)}
    </div>`;
  }).join('');
  return `<section class="room-timeline" aria-label="Study room timeline">
    ${unitRows}
  </section>`;
}

function serviceInProgress(config, at) {
  return config.services.find(service => minutes(service.start) <= at && at < minutes(service.end));
}

function roomCard(unit, config) {
  const reservations = approvedBookingsForRoom(unit.id);
  const isToday = selectedDate === localISO();
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const active = isToday && reservations.find(booking => minutes(booking.start) <= current && current < minutes(booking.end));
  const next = isToday
    ? reservations.find(booking => minutes(booking.start) >= current)
    : reservations[0];
  const service = isToday ? serviceInProgress(config, current) : null;
  const nextDetail = next
    ? `Next: ${bookingName(next)} · ${formatTime(next.start)}–${formatTime(next.end)}`
    : '';
  const withNext = detail => [detail, nextDetail].filter(Boolean).join(' · ');

  let state = 'Open all day';
  let detail = 'No approved reservation';
  if (isToday && active) {
    state = 'In use now';
    detail = withNext(`${bookingName(active)} · until ${formatTime(active.end)}`);
  } else if (isToday && service) {
    state = 'Service in progress';
    detail = withNext(`Available after ${formatTime(service.end)}`);
  } else if (isToday && current < minutes(config.start)) {
    state = 'Available when rooms open';
    detail = withNext(`Opens at ${formatTime(config.start)}`);
  } else if (isToday && current >= minutes(config.end)) {
    state = 'Schedule ended';
    detail = `Reopens on the next schedule day`;
  } else if (next) {
    state = isToday ? 'Available now' : 'First reservation';
    detail = isToday
      ? nextDetail
      : `${bookingName(next)} · ${formatTime(next.start)}–${formatTime(next.end)}`;
  } else if (isToday) {
    state = 'Available now';
    detail = `Open through ${formatTime(config.end)}`;
  }

  return `<article class="room-card${active ? ' occupied' : ''}" aria-label="${escapeHtml(`${unit.label}: ${state}. ${detail}`)}">
    <h2>${escapeHtml(unit.label)}</h2>
    <p class="room-state">${escapeHtml(state)}</p>
    <p class="room-detail">${escapeHtml(detail)}</p>
  </article>`;
}

function roomAvailability(config) {
  return `<section class="room-availability" aria-label="Study room availability">
    <div class="availability-heading">
      <p>Room availability</p>
      <span>${selectedDate === localISO() ? 'Right now' : 'Selected day'}</span>
    </div>
    <div class="room-card-grid">
      ${ROOM_UNITS.map(unit => roomCard(unit, config)).join('')}
    </div>
  </section>`;
}

function renderFooter() {
  const footer = document.querySelector('.tv-footer');
  if (!footer) return;
  footer.innerHTML = `<span>Live study room availability</span>
    <span class="legend approved"><i aria-hidden="true"></i>Approved reservation</span>
    <span class="legend service"><i aria-hidden="true"></i>Service</span>`;
}

function renderDayChooser() {
  const today = localISO();
  const choices = offeredDates(today);
  document.getElementById('day-chooser').innerHTML = choices.map(date => {
    const active = date === selectedDate;
    const label = formatChoiceDate(date, date === today);
    return `<button class="day-choice${active ? ' active' : ''}" type="button" data-tv-date="${date}" aria-pressed="${active}" aria-label="Show ${escapeHtml(formatDate(date))}">${escapeHtml(label)}</button>`;
  }).join('');
}

function render() {
  const config = selectedConfig();
  const schedule = document.getElementById('schedule');
  document.getElementById('today-label').textContent = formatDate(selectedDate);
  renderDayChooser();

  if (!config) {
    schedule.innerHTML = `<section class="closed-day">
      <h2>No study-room schedule on this day</h2>
      <p>Use Choose day to view the upcoming Tuesday or Saturday timetable.</p>
    </section>`;
    renderedDate = selectedDate;
    return;
  }

  schedule.innerHTML = `<div class="board" aria-label="${escapeHtml(config.name)} study room schedule for ${escapeHtml(formatDate(selectedDate))}">
    ${roomAvailability(config)}
    <section class="timeline-section" aria-label="Study room schedule timeline">
      <div class="timeline-heading">
        <p>${selectedDate === localISO() ? 'Today’s timeline' : 'Selected day’s timeline'}</p>
        <span>Approved reservations only</span>
      </div>
      <div class="timeline-scroller" tabindex="0" aria-label="Scroll horizontally to view the full room timeline">
        <div class="timeline-canvas">
          ${timeRuler(config)}
          ${roomTimeline(config)}
        </div>
      </div>
    </section>
  </div>`;
  renderedDate = selectedDate;
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

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.dates && typeof cached.dates === 'object') return cached.dates;
    // Gracefully accept the previous single-day cache while a screen updates.
    if (cached && cached.date && Array.isArray(cached.bookings)) {
      return { [cached.date]: { bookings: cached.bookings, updatedAt: cached.updatedAt } };
    }
  } catch (error) {
    console.warn('Could not read the TV schedule cache.', error);
  }
  return {};
}

function loadCacheForDate(date) {
  const entry = readCache()[date];
  if (!entry || !Array.isArray(entry.bookings)) return { bookings: [], updatedAt: 0 };
  return {
    bookings: toPublicBookings(entry.bookings),
    updatedAt: Number(entry.updatedAt) || 0
  };
}

function saveCache() {
  try {
    const dates = readCache();
    dates[selectedDate] = { bookings, updatedAt: lastUpdatedAt };
    // The chooser reaches at most three dates. Retaining only these prevents a
    // lobby device from accumulating stale schedules over months of uptime.
    const allowed = new Set(offeredDates());
    Object.keys(dates).forEach(date => { if (!allowed.has(date)) delete dates[date]; });
    localStorage.setItem(CACHE_KEY, JSON.stringify({ dates }));
  } catch (error) {
    console.warn('Could not save the TV schedule cache.', error);
  }
}

function writeSelectedDateToUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('date', selectedDate);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function setSelectedDate(date, { updateUrl = true, restart = true } = {}) {
  const safeDate = isAllowedDate(date) ? date : localISO();
  selectedDate = safeDate;
  const cached = loadCacheForDate(selectedDate);
  bookings = isDemoMode() ? demoBookingsFor(selectedDate) : cached.bookings;
  lastUpdatedAt = isDemoMode() ? 0 : cached.updatedAt;
  render();
  updateLastUpdatedLabel();
  if (updateUrl) writeSelectedDateToUrl();
  if (restart && !isDemoMode()) startSchedule();
}

function scheduleReconnect(callback) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    callback();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 60000);
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshTimer = null; startSchedule(); }, SCHEDULE_REFRESH_MS);
}

function startSchedule() {
  if (isDemoMode()) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  const date = selectedDate;
  const generation = ++scheduleRequestGeneration;
  setConnection('reconnecting', bookings.length ? 'Reconnecting' : 'Connecting');
  fetch(PUBLIC_LOBBY_SCHEDULE_URL, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } })
    .then(response => { if (!response.ok) throw new Error(`Public lobby schedule request failed (${response.status}).`); return response.json(); })
    .then(payload => normalizePublicSchedule(payload))
    .then(result => {
      if (generation !== scheduleRequestGeneration || date !== selectedDate) return;
      bookings = result.bookings.filter(booking => booking.date === selectedDate);
      lastUpdatedAt = result.updatedAt;
      reconnectDelay = 3000;
      saveCache();
      render();
      setConnection('live', 'Live');
      scheduleRefresh();
    }).catch(error => {
    if (generation !== scheduleRequestGeneration || date !== selectedDate) return;
    console.warn('Public lobby schedule could not connect.', error);
    setConnection('reconnecting', bookings.length ? 'Reconnecting' : 'Schedule unavailable');
    scheduleReconnect(startSchedule);
  });
}

function demoBookingsFor(date) {
  const created = Date.now() - 3600000;
  const tuesday = dateForWeekday(localISO(), 2);
  const saturday = dateForWeekday(localISO(), 6);
  const fixtures = [
    // Tuesday: filled room period, shared-equipment assignments, overlapping
    // pending requests, and both late-evening starts.
    { id: 'demo-tu-room-1', date: tuesday, start: '10:00', end: '12:00', name: 'Brother Anthony Lovelace', status: 'approved', needs: { room: true }, assignments: { room: 'room-1' } },
    { id: 'demo-tu-room-2', date: tuesday, start: '10:30', end: '11:30', name: 'Sister Maria Rivera', status: 'approved', needs: { room: true }, assignments: { room: 'room-2' } },
    { id: 'demo-tu-room-3', date: tuesday, start: '11:00', end: '11:30', name: 'Elder Daniel Kim', status: 'approved', needs: { room: true }, assignments: { room: 'room-3' } },
    { id: 'demo-tu-room-4', date: tuesday, start: '11:00', end: '11:30', name: 'Sister Sofia Martinez', status: 'approved', needs: { room: true }, assignments: { room: 'room-4' } },
    { id: 'demo-tu-wb', date: tuesday, start: '13:00', end: '15:00', name: 'Jordan Allen', status: 'approved', needs: { whiteboard: true }, assignments: { whiteboard: 'wb-2' } },
    { id: 'demo-tu-tv', date: tuesday, start: '16:30', end: '18:30', name: 'Taylor Brooks', status: 'approved', needs: { tv: true }, assignments: { tv: 'tv-1' } },
    { id: 'demo-tu-pending-1', date: tuesday, start: '13:30', end: '15:00', name: 'Naomi Carter', status: 'pending', needs: { room: true }, assignments: {}, createdAt: created },
    { id: 'demo-tu-pending-2', date: tuesday, start: '14:00', end: '16:30', name: 'Isaiah Davis', status: 'pending', needs: { room: true, whiteboard: true }, assignments: {}, createdAt: created + 1 },
    { id: 'demo-tu-pending-tv', date: tuesday, start: '18:00', end: '19:00', name: 'Elena Flores', status: 'pending', needs: { tv: true }, assignments: {}, createdAt: created + 2 },
    { id: 'demo-tu-late-1', date: tuesday, start: '22:00', end: '22:30', name: 'Marcus Green', status: 'approved', needs: { room: true }, assignments: { room: 'room-3' } },
    { id: 'demo-tu-late-2', date: tuesday, start: '22:30', end: '23:00', name: 'Olivia Harris', status: 'approved', needs: { tv: true }, assignments: { tv: 'tv-3' } },
    // These non-display statuses prove the demo data is comprehensive without
    // presenting cancelled or declined requests as active lobby reservations.
    { id: 'demo-tu-declined', date: tuesday, start: '17:00', end: '18:00', name: 'Sample Declined', status: 'declined', needs: { room: true }, assignments: {} },
    { id: 'demo-tu-cancelled', date: tuesday, start: '18:00', end: '19:00', name: 'Sample Cancelled', status: 'cancelled', needs: { tv: true }, assignments: {} },
    // Saturday: every resource, service-boundary-adjacent reservations, and a
    // late request so the other bookable day stays informative.
    { id: 'demo-sa-room', date: saturday, start: '11:00', end: '12:30', name: 'Rachel Ingram', status: 'approved', needs: { room: true }, assignments: { room: 'room-1' } },
    { id: 'demo-sa-wb', date: saturday, start: '13:00', end: '14:00', name: 'Brother Caleb Jones', status: 'approved', needs: { whiteboard: true }, assignments: { whiteboard: 'wb-4' } },
    { id: 'demo-sa-tv', date: saturday, start: '16:00', end: '17:30', name: 'Sister Hannah Lee', status: 'approved', needs: { tv: true }, assignments: { tv: 'tv-2' } },
    { id: 'demo-sa-pending-1', date: saturday, start: '18:00', end: '19:30', name: 'Noah Moore', status: 'pending', needs: { room: true }, assignments: {}, createdAt: created + 3 },
    { id: 'demo-sa-pending-2', date: saturday, start: '21:00', end: '22:00', name: 'Ava Nelson', status: 'pending', needs: { whiteboard: true, tv: true }, assignments: {}, createdAt: created + 4 },
    { id: 'demo-sa-late', date: saturday, start: '22:30', end: '23:00', name: 'Mia Ortiz', status: 'approved', needs: { room: true }, assignments: { room: 'room-4' } }
  ];
  return toPublicBookings(fixtures.filter(booking => booking.date === date));
}

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = formatClock(now);
  const today = localISO(now);
  if (!isAllowedDate(selectedDate)) {
    setSelectedDate(today, { updateUrl: true });
    return;
  }
  if (today !== renderedDate && selectedDate === today) {
    setSelectedDate(today, { updateUrl: false });
    return;
  }
  // Keep the date labels and the current-time marker fresh without changing
  // a selected future schedule or reopening its Firestore listener.
  if (selectedDate === today) render();
}

function initSelectedDate() {
  const requested = new URLSearchParams(window.location.search).get('date');
  selectedDate = isAllowedDate(requested) ? requested : localISO();
  if (requested && requested !== selectedDate) writeSelectedDateToUrl();
}

function init() {
  initSelectedDate();
  renderFooter();
  setSelectedDate(selectedDate, { updateUrl: false, restart: false });
  if (isDemoMode()) {
    setConnection('live', 'Sample preview');
  } else {
    startSchedule();
  }

  document.getElementById('day-chooser').addEventListener('click', event => {
    const choice = event.target.closest('[data-tv-date]');
    if (choice) setSelectedDate(choice.dataset.tvDate);
  });
  window.addEventListener('offline', () => { if (!isDemoMode()) setConnection('reconnecting', 'Reconnecting'); });
  window.addEventListener('online', () => { if (!isDemoMode()) startSchedule(); });

  updateClock();
  setInterval(updateClock, 1000);
  setInterval(render, 30000);
}

init();
