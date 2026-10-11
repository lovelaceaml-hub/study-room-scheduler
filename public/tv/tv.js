// Lobby TV: which study rooms are free now, and the day's room timeline.
// It reads the public lobby schedule (public names only), refreshes every
// minute, and keeps the last copy so a dropped connection still shows the day.

import { escapeHtml as esc, formatTime, formatHour, formatLongDay, listOf, weekdayName, monthDay, nowIn, toMinutes, readStored, writeStored, serverNow, setServerTime } from '../shared/format.js';
import { DEMO_CONFIG, demoDay, demoDays, demoRows, demoToday } from '../shared/demo.js';
import { paint } from '../shared/dom.js';
import { roomStatusSorted } from './status.js';

// Served through Hosting so the CDN caches it (firebase.json rewrites it to
// the publicLobbySchedule function).
const SCHEDULE_URL = '/api/lobby-schedule';
const CACHE_KEY = 'srs-tv-schedule';
const REFRESH_MS = 60000;
const RETRY_MS = [3000, 6000, 12000, 30000, 60000];
const FETCH_TIMEOUT_MS = 20000;
// "Reconnecting" shows once this long passes without a good copy.
const STALE_MS = 3 * 60000;
// A tapped day goes back to today after this long.
const RETURN_MS = 2 * 60000;
// The page reloads itself once a day after this time (4:00 AM), to pick up
// new versions of the page.
const RELOAD_MINUTE = 4 * 60;
const RELOAD_AFTER_MS = 30 * 60000;
const ZONE = 'America/Los_Angeles';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const startedAt = Date.now();

let schedule = null; // { generatedAt, config, days, bookings }
let savedAt = 0; // when the copy shown arrived, on this device's clock
let failed = false; // the last request failed
let failures = 0;
let timer = null;
let loading = null;
let chosen = params.get('date'); // a day from the address, or the day last tapped
let returnTimer = null;

const timeZone = () => schedule?.config.timeZone || ZONE;

// ---------- Data ----------

function demoSchedule() {
  const today = demoToday();
  const days = [demoDay(today), ...demoDays(today).filter(day => day.date !== today)];
  const bookings = demoRows(days)
    .filter(row => row.type === 'room')
    .map(row => ({ date: row.date, start: row.start, end: row.end, room: row.unit, name: row.name }));
  return { generatedAt: new Date().toISOString(), config: DEMO_CONFIG, days, bookings };
}

function valid(payload) {
  return payload && Array.isArray(payload.days) && Array.isArray(payload.bookings) && payload.config?.resources?.room;
}

// One request at a time; an `online` event while one runs joins it.
function load() {
  loading ??= fetchSchedule().finally(() => { loading = null; });
  return loading;
}

async function fetchSchedule() {
  clearTimeout(timer);
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let next;
  try {
    const sentAt = Date.now();
    const response = await fetch(SCHEDULE_URL, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const receivedAt = Date.now();
    const payload = await response.json();
    if (!valid(payload)) throw new Error('Unexpected schedule format');
    schedule = payload;
    savedAt = Date.now();
    setServerTime(serverTimeOf(response, payload), sentAt, receivedAt);
    failed = false;
    failures = 0;
    writeStored(CACHE_KEY, JSON.stringify({ ...payload, savedAt }));
    next = REFRESH_MS;
    if (reloadDue()) {
      location.reload();
      return;
    }
  } catch {
    failed = true;
    next = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures += 1;
  } finally {
    clearTimeout(abort);
  }
  clearTimeout(timer);
  timer = setTimeout(load, next);
  render();
}

// The server's time when the copy was served. The CDN keeps one copy for up
// to a minute, so `generatedAt` may be that old; the response's Date header
// is the time it was served, to the second. The later of the two is used.
function serverTimeOf(response, payload) {
  return Math.max(Date.parse(response.headers.get('Date') || '') || 0, Date.parse(payload.generatedAt) || 0);
}

// True once 4:00 AM has passed on the church's clock since the page opened.
function reloadDue() {
  if (Date.now() - startedAt < RELOAD_AFTER_MS) return false;
  const now = nowIn(timeZone());
  const opened = nowIn(timeZone(), serverNow(startedAt));
  return now.minutes >= RELOAD_MINUTE && (opened.date < now.date || opened.minutes < RELOAD_MINUTE);
}

// 'live', 'stale' (no good copy for 3 minutes), 'offline' (none at all),
// 'connecting' or 'demo'. Measured on this device's clock only.
function connection() {
  if (demo) return 'demo';
  if (!schedule) return failed ? 'offline' : 'connecting';
  const age = Date.now() - savedAt;
  return age >= 0 && age <= STALE_MS ? 'live' : 'stale';
}

// '3:42 PM' today, or 'Tue, Sep 29, 3:42 PM', on the church's clock.
function stamp(ms) {
  const at = nowIn(timeZone(), serverNow(ms));
  const time = formatTime(at.minutes);
  return at.date === nowIn(timeZone()).date ? time : `${weekdayName(at.date).slice(0, 3)}, ${monthDay(at.date)}, ${time}`;
}

// ---------- Markup ----------

function renderConnection(status) {
  $('#connection').dataset.status = status;
  $('#connection-label').textContent = { live: 'Live', stale: 'Reconnecting', offline: 'Not connected', demo: 'Sample schedule', connecting: 'Connecting' }[status];
  $('#updated').textContent = schedule && status !== 'demo' && savedAt ? `Updated ${stamp(savedAt)}` : '';
}

function render() {
  const now = nowIn(timeZone());
  $('#clock').textContent = formatTime(now.minutes);
  const status = connection();
  renderConnection(status);
  const board = $('#board');
  if (!schedule) {
    $('#day-label').textContent = '';
    paint($('#days'), '');
    paint(board, '<p class="tv-empty">Loading the schedule…</p>');
    return;
  }
  if (demo && !schedule.days.some(day => day.date === now.date)) schedule = demoSchedule();
  // Days before today are never shown. A copy without today is out of date:
  // it is only shown again once a new copy arrives.
  const days = schedule.days.filter(day => day.date >= now.date);
  if (!days.some(day => day.date === now.date)) {
    $('#day-label').textContent = formatLongDay(now.date);
    paint($('#days'), '');
    if (status === 'live') {
      load();
      paint(board, '<p class="tv-empty">Loading the schedule…</p>');
    } else {
      paint(board, `<section class="tv-empty"><h2>No current schedule</h2><p>${savedAt ? `Not connected since ${esc(stamp(savedAt))}.` : 'Not connected.'}</p></section>`);
    }
    return;
  }
  const day = days.find(item => item.date === chosen) || days.find(item => item.date === now.date);
  $('#day-label').textContent = formatLongDay(day.date);
  paint($('#days'), days.map(item => `
    <button type="button" class="tv-day-button" data-date="${esc(item.date)}" data-key="day-${esc(item.date)}" aria-pressed="${item.date === day.date}">
      ${item.date === now.date ? 'Today' : `${esc(weekdayName(item.date).slice(0, 3))}, ${esc(monthDay(item.date))}`}
    </button>`).join(''));
  if (!day.scheduled) {
    paint(board, `<section class="tv-empty"><h2>No room schedule ${day.date === now.date ? 'today' : 'on this day'}</h2>
      <p>Rooms can be reserved on ${esc(listOf(days.filter(item => item.scheduled).map(item => weekdayName(item.date)))) || 'the next booking day'}.</p></section>`);
    return;
  }
  const rooms = schedule.config.resources.room.units;
  const bookings = schedule.bookings.filter(booking => booking.date === day.date);
  const byRoom = new Map(rooms.map(room => [room.id, []]));
  for (const booking of bookings) {
    const roomBookings = byRoom.get(booking.room);
    if (roomBookings) roomBookings.push(booking);
  }
  for (const roomBookings of byRoom.values()) {
    roomBookings.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  }
  const minute = day.date === now.date ? now.minutes : null;
  // The two parts are kept between redraws, so the timeline keeps its
  // scroll position.
  paint(board, `
    <section class="tv-rooms" aria-label="Rooms ${minute === null ? 'on this day' : 'right now'}"></section>
    <section class="tv-timeline" tabindex="0" aria-label="Room timeline"></section>`);
  paint(board.querySelector('.tv-rooms'), rooms.map(room => roomCard(room, byRoom.get(room.id), day, minute)).join(''));
  paint(board.querySelector('.tv-timeline'), timeline(rooms, byRoom, day, minute));
}

function roomCard(room, bookings, day, minute) {
  const { state, detail, kind } = roomStatusSorted(schedule.config, day, bookings, minute);
  return `<article class="tv-room ${kind}">
    <h2>${esc(room.name)}</h2>
    <p class="tv-room-state">${esc(state)}</p>
    ${detail ? `<p class="tv-room-detail">${esc(detail)}</p>` : ''}
  </article>`;
}

function timeline(rooms, bookingsByRoom, day, now) {
  const config = schedule.config;
  const open = toMinutes(config.open);
  const span = toMinutes(config.close) - open;
  const at = minute => `${((minute - open) / span * 100).toFixed(3)}%`;
  const width = (start, end) => `${((end - start) / span * 100).toFixed(3)}%`;
  const marker = now !== null && now >= open && now <= open + span ? `<span class="tv-now" style="left:${at(now)}" aria-hidden="true"></span>` : '';
  const services = day.services.map(service => `<span class="tv-service" style="left:${at(toMinutes(service.start))};width:${width(toMinutes(service.start), toMinutes(service.end))}" title="${esc(service.label)}"></span>`).join('');
  const ticks = [];
  for (let minute = open; minute <= open + span; minute += 60) {
    const edge = minute === open ? ' first' : minute + 60 > open + span ? ' last' : '';
    ticks.push(`<span class="tv-tick${edge}" style="left:${at(minute)}">${formatHour(minute)}</span>`);
  }
  return `
    <div class="tv-row tv-ruler"><span class="tv-label"></span><div class="tv-track">${ticks.join('')}${marker}</div></div>
    ${rooms.map(room => `
      <div class="tv-row">
        <span class="tv-label">${esc(room.name)}</span>
        <div class="tv-track">${services}${bookingsByRoom.get(room.id).map(booking => {
          const start = toMinutes(booking.start);
          const end = toMinutes(booking.end);
          // Under an hour there is no room for the time; the name gets it all.
          const short = end - start < 60;
          return `<span class="tv-booking${short ? ' short' : ''}" style="left:${at(start)};width:${width(start, end)}" title="${esc(`${booking.name}, ${formatTime(start)} to ${formatTime(end)}`)}">
            <b>${esc(booking.name)}</b>${short ? '' : `<small>${formatTime(start)}</small>`}</span>`;
        }).join('')}${marker}</div>
      </div>`).join('')}`;
}

// ---------- Start ----------

// A tapped day shows for two minutes after the last tap, then today again.
$('#days').addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  chosen = button.dataset.date;
  clearTimeout(returnTimer);
  returnTimer = setTimeout(() => {
    chosen = null;
    render();
  }, RETURN_MS);
  render();
});

if (demo) {
  schedule = demoSchedule();
} else {
  try {
    const cached = JSON.parse(readStored(CACHE_KEY));
    if (valid(cached)) {
      schedule = cached;
      savedAt = Number(cached.savedAt) || Date.parse(cached.generatedAt) || 0;
    }
  } catch { /* no usable copy */ }
  load();
  addEventListener('online', () => load());
}
render();

// Offline support: the page and its last copy still open without a connection.
try {
  navigator.serviceWorker?.register('/sw.js').catch(() => {});
} catch { /* not allowed here */ }

// Keep the clock, "now" marker and room states current.
setInterval(render, 30000);
setInterval(() => {
  $('#clock').textContent = formatTime(nowIn(timeZone()).minutes);
}, 5000);
