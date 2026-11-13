// Member app: the day schedule, plus the sheets for booking, reservation
// details and My reservations.

import { escapeHtml as esc, formatTime, formatHour, formatRange, formatDay, inSentence, weekdayName, monthDay, toMinutes, nowIn } from '../shared/format.js';
import { unitsOf, slotStarts, serviceAt, occupancyIndex, occupant, earliestStart } from '../shared/availability.js';
import { subscribe, refresh, canBook } from './store.js';
import { createBookingSheet } from './booking.js';
import { createDetailsSheet } from './details.js';
import { createMineSheet } from './mine.js';
import { purposeLabel, unitLabel, connectionText, ACTION_LABELS, HOLD } from './text.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';
import { paint } from '../shared/dom.js';

redirectOldLinks();

const $ = selector => document.querySelector(selector);
const view = { date: null, type: 'room', highlight: null };
let state = null;
let lastGrid = null;

const booking = createBookingSheet({
  getState: () => state,
  onShow: showOnSchedule,
  onOpenMine: () => mine.open()
});
const details = createDetailsSheet({
  getState: () => state,
  onEndEarly: id => mine.open({ view: 'end', id }),
  // Force override from someone's reservation: its unit, from its start or
  // from now if it is under way.
  onForce: held => booking.open({
    date: held.date,
    type: held.type,
    unit: held.unit,
    start: Math.max(toMinutes(held.start), earliestStart(state.config, held.date)),
    force: true
  })
});
const mine = createMineSheet({
  getState: () => state,
  // From an empty list, the day and kind on screen; from a replaced card, its own.
  onReserve: preset => booking.open(preset || { date: view.date, type: view.type })
});

// ---------- Rendering ----------

function render() {
  const { config, days } = state;
  const ready = canBook(state);
  $('#status-pill').textContent = { connecting: 'Connecting', live: 'Live', demo: 'Demo', offline: 'Offline', error: 'Not connected', slow: 'Not connected', outdated: 'Out of date' }[state.status];
  $('#reserve').disabled = !ready || !days.length;
  paint($('#notice'), noticeHtml());
  paint($('#mine-link'), avatarHtml());
  if (!config) return;

  const today = nowIn(config.timeZone).date;
  paint($('#dates'), days.map(day => dateCard(day.date, today)).join(''));
  paint($('#types'), Object.entries(config.resources).map(([type, resource]) => `<button type="button" class="type-button" data-type="${type}" data-key="type-${type}" aria-pressed="${type === view.type}">
    ${ICONS[type] || ''}<span>${esc(resource.plural)}</span></button>`).join(''));

  const units = unitsOf(config, view.type);
  $('.board').style.setProperty('--units', units.length);
  $('.board').style.setProperty('--slots', slotStarts(config).length);
  paint($('#unit-headings'), `<span>Time</span>${units.map(unit => `<span>${esc(unit.name)}${unit.note ? `<small>${esc(unit.note)}</small>` : ''}</span>`).join('')}`);
  const day = days.find(item => item.date === view.date);
  $('#day-caption').textContent = day ? formatDay(day.date) : '';
  $('#hint').textContent = !ready || !day ? '' : hasTimeLeft(day) ? 'Choose an open time to reserve it.' : 'No more open times on this day.';
  if (!lastGrid || lastGrid.config !== config || lastGrid.days !== days || lastGrid.bookings !== state.bookings
      || lastGrid.date !== view.date || lastGrid.type !== view.type || lastGrid.ready !== ready
      || lastGrid.highlight !== view.highlight) {
    paint($('#grid'), gridHtml());
    lastGrid = { config, days, bookings: state.bookings, date: view.date, type: view.type, ready, highlight: view.highlight };
  }
  placeNowLine();
  paint($('#legend'), legendHtml());
  showChosenDay();
  updateDaySteps();
}

// One day in the day picker: weekday, date and month (or "Today"), with a dot
// when one of your reservations is on it.
function dateCard(date, today) {
  const mine = state.bookings.some(item => item.mine && item.date === date);
  const month = monthDay(date).split(' ')[0];
  return `<button type="button" class="date-button" data-date="${date}" data-key="date-${date}" aria-pressed="${date === view.date}">
    ${mine ? '<i class="date-dot" aria-hidden="true"></i><span class="visually-hidden">Has your reservation,</span>' : ''}
    <span class="date-top"><span class="date-week">${esc(weekdayName(date).slice(0, 3))}</span>
    <b class="date-number">${Number(date.slice(8))}</b></span>
    <span class="date-month">${date === today ? 'Today' : esc(month)}</span></button>`;
}

// The round My reservations button: your initials from your latest
// reservation on this device, or a person icon before you have one.
function avatarHtml() {
  const latest = [...state.mine].filter(item => item.name).sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`))[0];
  const initials = latest ? latest.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() : '';
  return `<span class="visually-hidden">My reservations</span>${initials ? `<span aria-hidden="true">${esc(initials)}</span>` : ICONS.person}`;
}

// The arrows beside the days scroll the row; each is off when there is
// nothing more that way.
function updateDaySteps() {
  const row = $('#dates');
  const max = row.scrollWidth - row.clientWidth;
  $('#days-back').disabled = row.scrollLeft <= 2;
  $('#days-next').disabled = row.scrollLeft >= max - 2;
}

// Keeps the chosen day in view in the day row, without scrolling the page.
let shownDay = null;
function showChosenDay() {
  if (shownDay === view.date) return;
  const row = $('#dates');
  const card = row.querySelector('[aria-pressed="true"]');
  if (!card || !row.clientWidth) return;
  shownDay = view.date;
  const box = row.getBoundingClientRect();
  const place = card.getBoundingClientRect();
  if (place.left < box.left) row.scrollLeft -= box.left - place.left + 8;
  else if (place.right > box.right) row.scrollLeft += place.right - box.right + 8;
}

function stepDays(direction) {
  const row = $('#dates');
  row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function noticeHtml() {
  if (state.status === 'connecting') return '<p><span class="spinner" aria-hidden="true"></span>Loading the schedule…</p>';
  if (state.status === 'demo') return '<p>Demo mode: a sample schedule with made-up names. Practice reservations disappear when you close this page.</p>';
  const problem = connectionText(state.status);
  if (problem) return `<p>${esc(problem.text)}</p><button type="button" class="text-button" data-action="${problem.action}">${ACTION_LABELS[problem.action]}</button>`;
  return state.days.length ? '' : '<p>No days are open for reservations right now.</p>';
}

// True while `day` still has a start time that has not begun.
function hasTimeLeft(day) {
  const earliest = earliestStart(state.config, day.date);
  return slotStarts(state.config).some(minute => minute >= earliest && !serviceAt(day, minute));
}

// The first day with time left to reserve, so late on a booking day the page
// opens on the next one.
function defaultDate() {
  if (!state.config) return state.days[0]?.date || null;
  return (state.days.find(hasTimeLeft) || state.days[0])?.date || null;
}

function gridHtml() {
  const { config, days, bookings } = state;
  const day = days.find(item => item.date === view.date);
  if (!day) return '';
  const ready = canBook(state);
  const earliest = earliestStart(config, day.date);
  const units = unitsOf(config, view.type);
  const open = toMinutes(config.open);
  const slot = config.slotMinutes;
  const row = minute => (minute - open) / slot + 1;
  const rows = bookings.filter(item => item.type === view.type);
  const occupancy = occupancyIndex(rows, slot);
  let html = `<div class="time-rail" aria-hidden="true"></div><div class="now-line" aria-hidden="true" hidden></div>`;

  const slots = slotStarts(config).length;
  for (let minute = open; minute <= toMinutes(config.close); minute += 60) {
    const last = minute === toMinutes(config.close);
    html += `<span class="hour${last ? ' last' : ''}" style="grid-row:${last ? slots : row(minute)}" aria-hidden="true">${formatHour(minute)}</span>`;
  }
  const close = toMinutes(config.close);
  units.forEach((unit, index) => {
    const column = index + 2;
    for (let minute = open; minute < close;) {
      const held = occupant(occupancy, day.date, unit.id, minute);
      if (serviceAt(day, minute)) {
        minute += slot;
      } else if (held) {
        let end = minute + slot;
        while (end < close && !serviceAt(day, end) && occupant(occupancy, day.date, unit.id, end) === held) end += slot;
        html += bookingBlock(held, unit, column, row(minute), (end - minute) / slot);
        minute = end;
      } else {
        html += ready && minute >= earliest
          ? `<button type="button" class="open-slot" data-unit="${unit.id}" data-start="${minute}" data-key="slot-${unit.id}-${minute}"
          style="grid-column:${column};grid-row:${row(minute)}" aria-label="Open, reserve ${esc(unitLabel(config, unit.id))} at ${formatTime(minute)}, ${esc(formatDay(day.date))}">Open</button>`
          : `<span class="closed-slot" style="grid-column:${column};grid-row:${row(minute)}" aria-hidden="true"></span>`;
        minute += slot;
      }
    }
  });
  for (const service of day.services) {
    const start = toMinutes(service.start);
    html += `<div class="service" style="grid-row:${row(start)} / span ${(toMinutes(service.end) - start) / slot}">
      <span>${esc(service.label)}</span><small>${formatRange(service.start, service.end)}</small></div>`;
  }
  return html;
}

// The red line across the schedule at the current time, shown only on today
// while the building is open. It moves on its own, without redrawing the grid.
function placeNowLine() {
  const line = document.querySelector('#grid .now-line');
  if (!line || !state?.config) return;
  const { config } = state;
  const clock = nowIn(config.timeZone);
  const open = toMinutes(config.open);
  const close = toMinutes(config.close);
  const shown = view.date === clock.date && clock.minutes >= open && clock.minutes <= close;
  line.hidden = !shown;
  if (shown) line.style.setProperty('--now', (clock.minutes - open) / config.slotMinutes);
}

setInterval(placeNowLine, 20000);

function bookingBlock(held, unit, column, row, span) {
  const purpose = purposeLabel(state.config, held.purpose);
  // The label starts with the words shown, in the order shown, so voice
  // control and screen readers match what is on screen. "Yours" comes before
  // the purpose because small blocks hide the purpose.
  const label = `${held.name}, ${held.mine ? 'yours, ' : ''}${held.purpose === HOLD ? '' : `${purpose}, `}${unitLabel(state.config, unit.id)}, ${formatRange(held.start, held.end)}`;
  const classes = ['booking', `purpose-${held.purpose}`, span === 1 ? 'short' : '', held.mine ? 'mine' : '', held.id === view.highlight ? 'highlight' : ''];
  return `<button type="button" class="${classes.filter(Boolean).join(' ')}" data-booking="${esc(held.id)}" data-type="${held.type}" data-key="booking-${esc(held.id)}-${held.type}"
    style="grid-column:${column};grid-row:${row} / span ${span}" aria-label="${esc(label)}">
    <span class="booking-name">${esc(held.name)}</span>
    ${held.mine ? '<span class="booking-mine">Yours</span>' : ''}
    ${held.purpose === HOLD ? '' : `<span class="booking-purpose">${esc(purpose)}</span>`}
  </button>`;
}

function legendHtml() {
  const purposes = Object.entries(state.config.purposes).map(([id, purpose]) => `<span><i class="dot purpose-${id}"></i>${esc(purpose.label)}</span>`);
  return `${purposes.join('')}<span><i class="dot purpose-${HOLD}"></i>Reserved</span>`;
}

// ---------- Events ----------

$('#dates').addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  view.date = button.dataset.date;
  render();
  announce(`Showing ${formatDay(view.date)}.`);
});

$('#days-back').addEventListener('click', () => stepDays(-1));
$('#days-next').addEventListener('click', () => stepDays(1));
$('#dates').addEventListener('scroll', updateDaySteps, { passive: true });
addEventListener('resize', updateDaySteps);

$('#types').addEventListener('click', event => {
  const button = event.target.closest('[data-type]');
  if (!button) return;
  view.type = button.dataset.type;
  render();
  announce(`Showing ${inSentence(state.config.resources[view.type].plural)}.`);
});

$('#grid').addEventListener('click', event => {
  const held = event.target.closest('[data-booking]');
  if (held) {
    details.open(held.dataset.booking, held.dataset.type);
    return;
  }
  const open = event.target.closest('.open-slot');
  if (open) booking.open({ date: view.date, type: view.type, unit: open.dataset.unit, start: Number(open.dataset.start) });
});

$('#notice').addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'retry') refresh();
  else if (action === 'reload') location.reload();
});

// The day and kind on screen are the ones being reserved.
$('#reserve').addEventListener('click', () => booking.open({ date: view.date, type: view.type }));

$('#mine-link').addEventListener('click', event => {
  event.preventDefault();
  mine.open();
});

// After booking: show the new reservation on the schedule and focus it.
function showOnSchedule({ date, type, id }) {
  view.date = date;
  view.type = type;
  view.highlight = id;
  render();
  setTimeout(() => {
    if (view.highlight !== id) return;
    view.highlight = null;
    render();
  }, 6000);
  const block = document.querySelector(`[data-booking="${CSS.escape(id)}"]`);
  block?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  block?.focus({ preventScroll: true });
}

// Links from older versions of the app.
function redirectOldLinks() {
  const params = new URLSearchParams(location.search);
  if (params.has('tv')) location.replace(`/tv.html${location.search}`);
  else if (params.get('tab') === 'admin') location.replace('/admin/');
  else if (params.get('tab') === 'mine') history.replaceState(null, '', '?view=mine');
}

// ---------- Start ----------

subscribe(next => {
  const wasReady = state ? canBook(state) : null;
  state = next;
  if (!state.days.some(day => day.date === view.date)) view.date = defaultDate();
  render();
  booking.update();
  details.update();
  mine.update();
  if (wasReady !== null && wasReady !== canBook(state)) {
    announce(canBook(state) ? 'Schedule connected.' : 'The schedule is not connected. Reservations are paused.');
  }
});

if (new URLSearchParams(location.search).get('view') === 'mine') mine.open({ push: false });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
