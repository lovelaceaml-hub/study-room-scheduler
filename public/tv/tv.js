// Lobby TV: which study rooms are free now, and the day's room timeline.
// It reads the public lobby schedule (public names only), refreshes every
// minute, and keeps the last copy so a dropped connection still shows the day.

import { escapeHtml as esc, formatTime, formatHour, formatLongDay, listOf, weekdayName, monthDay, nowIn, toMinutes, readStored, writeStored } from '../shared/format.js';
import { DEMO_CONFIG, demoDay, demoDays, demoRows, demoToday } from '../shared/demo.js';

const SCHEDULE_URL = 'https://us-west1-lvz-rooms.cloudfunctions.net/publicLobbySchedule';
const CACHE_KEY = 'srs-tv-schedule';
const REFRESH_MS = 60000;
const RETRY_MS = [3000, 6000, 12000, 30000, 60000];

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';

let schedule = null; // { generatedAt, config, days, bookings }
let selected = params.get('date');
let failures = 0;
let timer = null;

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

async function load() {
  clearTimeout(timer);
  try {
    const response = await fetch(SCHEDULE_URL, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!valid(payload)) throw new Error('Unexpected schedule format');
    schedule = payload;
    writeStored(CACHE_KEY, JSON.stringify(payload));
    failures = 0;
    setConnection('live');
    timer = setTimeout(load, REFRESH_MS);
  } catch {
    setConnection(schedule ? 'stale' : 'offline');
    timer = setTimeout(load, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
    failures += 1;
  }
  render();
}

function setConnection(status) {
  $('#connection').dataset.status = status;
  $('#connection-label').textContent = { live: 'Live', stale: 'Reconnecting', offline: 'Not connected', demo: 'Sample schedule' }[status];
  const updated = schedule && status !== 'demo' ? new Date(schedule.generatedAt) : null;
  $('#updated').textContent = updated ? `Updated ${updated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
}

// ---------- Markup ----------

function render() {
  const timeZone = schedule?.config.timeZone || 'America/Los_Angeles';
  const now = nowIn(timeZone);
  $('#clock').textContent = formatTime(now.minutes);
  if (!schedule) {
    $('#board').innerHTML = '<p class="tv-empty">Loading the schedule…</p>';
    return;
  }
  // Show today unless another listed day was chosen.
  if (!schedule.days.some(day => day.date === selected)) selected = schedule.days.find(day => day.date === now.date)?.date || schedule.days[0]?.date;
  const day = schedule.days.find(item => item.date === selected);
  $('#day-label').textContent = day ? formatLongDay(day.date) : '';
  $('#days').innerHTML = schedule.days.map(item => `
    <button type="button" class="tv-day-button" data-date="${item.date}" aria-pressed="${item.date === selected}">
      ${item.date === now.date ? 'Today' : `${esc(weekdayName(item.date).slice(0, 3))}, ${esc(monthDay(item.date))}`}
    </button>`).join('');
  if (!day?.scheduled) {
    $('#board').innerHTML = `<section class="tv-empty"><h2>No room schedule ${day?.date === now.date ? 'today' : 'on this day'}</h2>
      <p>Rooms can be reserved on ${esc(listOf(schedule.days.filter(item => item.scheduled).map(item => weekdayName(item.date)))) || 'the next booking day'}.</p></section>`;
    return;
  }
  const rooms = schedule.config.resources.room.units;
  const bookings = schedule.bookings.filter(booking => booking.date === day.date);
  const isToday = day.date === now.date;
  $('#board').innerHTML = `
    <section class="tv-rooms" aria-label="Rooms ${isToday ? 'right now' : 'on this day'}">
      ${rooms.map(room => roomCard(room, bookings.filter(booking => booking.room === room.id), day, isToday ? now.minutes : null)).join('')}
    </section>
    <section class="tv-timeline" aria-label="Room timeline">
      ${timeline(rooms, bookings, day, isToday ? now.minutes : null)}
    </section>`;
}

function roomCard(room, bookings, day, now) {
  const config = schedule.config;
  const sorted = bookings.slice().sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const range = booking => `${formatTime(booking.start)} to ${formatTime(booking.end)}`;
  let state;
  let detail;
  if (now === null) {
    state = sorted.length ? `${sorted.length} reservation${sorted.length === 1 ? '' : 's'}` : 'Open all day';
    detail = sorted.length ? `First: ${sorted[0].name}, ${range(sorted[0])}` : '';
  } else {
    const current = sorted.find(booking => toMinutes(booking.start) <= now && now < toMinutes(booking.end));
    const next = sorted.find(booking => toMinutes(booking.start) > now);
    const service = day.services.find(item => toMinutes(item.start) <= now && now < toMinutes(item.end));
    const nextText = next ? `Next: ${next.name}, ${range(next)}` : '';
    if (now >= toMinutes(config.close)) [state, detail] = ['Closed for today', ''];
    else if (now < toMinutes(config.open)) [state, detail] = [`Opens at ${formatTime(config.open)}`, nextText];
    else if (current) [state, detail] = ['In use', `${current.name} until ${formatTime(current.end)}${next ? `. ${nextText}` : ''}`];
    else if (service) [state, detail] = [service.label, `Open after ${formatTime(service.end)}${next ? `. ${nextText}` : ''}`];
    else [state, detail] = ['Open now', nextText || `Open until ${formatTime(config.close)}`];
  }
  const busy = state === 'In use';
  return `<article class="tv-room${busy ? ' busy' : ''}">
    <h2>${esc(room.name)}</h2>
    <p class="tv-room-state">${esc(state)}</p>
    ${detail ? `<p class="tv-room-detail">${esc(detail)}</p>` : ''}
  </article>`;
}

function timeline(rooms, bookings, day, now) {
  const config = schedule.config;
  const open = toMinutes(config.open);
  const span = toMinutes(config.close) - open;
  const at = minute => `${((minute - open) / span * 100).toFixed(3)}%`;
  const width = (start, end) => `${((end - start) / span * 100).toFixed(3)}%`;
  const marker = now !== null && now >= open && now <= open + span ? `<span class="tv-now" style="left:${at(now)}" aria-hidden="true"></span>` : '';
  const services = day.services.map(service => `<span class="tv-service" style="left:${at(toMinutes(service.start))};width:${width(toMinutes(service.start), toMinutes(service.end))}" title="${esc(service.label)}"></span>`).join('');
  const ticks = [];
  for (let minute = open; minute <= open + span; minute += 60) ticks.push(`<span class="tv-tick" style="left:${at(minute)}">${formatHour(minute)}</span>`);
  return `
    <div class="tv-row tv-ruler"><span class="tv-label"></span><div class="tv-track">${ticks.join('')}${marker}</div></div>
    ${rooms.map(room => `
      <div class="tv-row">
        <span class="tv-label">${esc(room.name)}</span>
        <div class="tv-track">${services}${bookings.filter(booking => booking.room === room.id).map(booking => {
          const start = toMinutes(booking.start);
          const end = toMinutes(booking.end);
          return `<span class="tv-booking" style="left:${at(start)};width:${width(start, end)}" title="${esc(`${booking.name}, ${formatTime(start)} to ${formatTime(end)}`)}">
            <b>${esc(booking.name)}</b><small>${formatTime(start).replace(' ', ' ')}</small></span>`;
        }).join('')}${marker}</div>
      </div>`).join('')}`;
}

// ---------- Start ----------

$('#days').addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  selected = button.dataset.date;
  const url = new URL(location.href);
  url.searchParams.set('date', selected);
  history.replaceState(null, '', url);
  render();
});

if (demo) {
  schedule = demoSchedule();
  setConnection('demo');
  render();
} else {
  try {
    const cached = JSON.parse(readStored(CACHE_KEY));
    if (valid(cached)) schedule = cached;
  } catch { /* no usable copy */ }
  render();
  load();
  addEventListener('online', load);
}
// Keep the clock, "now" marker and room states current.
setInterval(render, 30000);
setInterval(() => {
  $('#clock').textContent = formatTime(nowIn(schedule?.config.timeZone || 'America/Los_Angeles').minutes);
}, 5000);
