// Admin page: unlock with the PIN, then see every reservation on the open
// days, add reservations or holds, cancel, end early, restore, keep private
// notes, and remove old records. Every change goes through a Cloud Function.

import { connect, errorMessage } from '../shared/firebase.js';
import { escapeHtml as esc, formatTime, formatRange, formatDay, formatHour, inSentence, listOf, weekdayName, monthDay, toMinutes, toTime, hasText } from '../shared/format.js';
import { unitsOf, unitName, slotStarts, serviceAt, validRange, earlierEnds, earliestStart } from '../shared/availability.js';
import { paint } from '../shared/dom.js';

const SESSION_KEY = 'srs-admin-session';
const REFRESH_MS = 15000;
const HOLD = 'blocked';
const STATUS_LABELS = { approved: 'Confirmed', cancelled: 'Cancelled', overridden: 'Replaced', pending: 'Pending', declined: 'Declined' };

const $ = selector => document.querySelector(selector);
const root = $('#admin');

let api = null;
let schedule = null; // { config, days, bookings } from adminSchedule
let notes = {};
let notesLoadedFor = '';
let refreshTimer = null;
let expiryTimer = null;
let busy = false;
// panel: the open row form, { id, kind: 'end' | 'restore' | 'note', values },
// where `values` keeps what the Admin picked or typed across refreshes.
const view = { date: null, type: 'room', panel: null };
let form = blankForm();

// ---------- Session ----------

function session() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return saved?.token && saved.expiresAt > Date.now() ? saved : null;
  } catch {
    return null;
  }
}

function saveSession(value) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch { /* storage blocked */ }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

async function call(name, payload = {}) {
  api ??= await connect();
  return api.call(name, { sessionToken: session()?.token, ...payload });
}

async function unlock(pin) {
  busy = true;
  renderLock();
  try {
    api ??= await connect();
    const result = await api.call('adminStartSession', { pin });
    saveSession({ token: result.sessionToken, expiresAt: result.expiresAt });
    busy = false;
    await openWorkspace();
  } catch (error) {
    busy = false;
    renderLock(errorMessage(error, 'Admin could not connect. Check your connection and try again.'));
  }
}

async function openWorkspace() {
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => lock('Your Admin session ended. Enter the PIN again.'), Math.max(0, session().expiresAt - Date.now()));
  $('#lock').hidden = false;
  root.innerHTML = '<p class="card">Loading the schedule…</p>';
  await load();
}

async function lock(reason = '') {
  const token = session()?.token;
  clearSession();
  clearTimeout(refreshTimer);
  clearTimeout(expiryTimer);
  schedule = null;
  notes = {};
  notesLoadedFor = '';
  view.panel = null;
  form = blankForm();
  $('#lock').hidden = true;
  renderLock(reason);
  if (token && api) api.call('adminEndSession', { sessionToken: token }).catch(() => {});
}

// ---------- Loading ----------

async function load() {
  clearTimeout(refreshTimer);
  if (!session()) return;
  try {
    const result = await call('adminSchedule');
    if (!result?.config || !Array.isArray(result.days)) throw new Error('Unexpected schedule format');
    schedule = result;
    if (!schedule.days.some(day => day.date === view.date)) view.date = schedule.days[0]?.date || null;
    await loadNotes();
    render();
  } catch (error) {
    if (String(error?.code).includes('permission-denied')) {
      lock(errorMessage(error, 'Your Admin session ended. Enter the PIN again.'));
      return;
    }
    message(errorMessage(error, 'The schedule could not load. Retrying…'), true);
  }
  refreshTimer = setTimeout(load, REFRESH_MS);
}

async function loadNotes() {
  const ids = schedule.bookings.map(booking => booking.id).sort();
  const key = ids.join(',');
  if (key === notesLoadedFor) return;
  notes = ids.length ? (await call('adminNoteAction', { action: 'read', bookingIds: ids })).notes : {};
  notesLoadedFor = key;
}

// Runs a change, shows the result, and reloads the schedule. `success` is the
// message to show, or a function that builds it from the action's result.
async function change(action, success) {
  if (busy) return false;
  busy = true;
  render();
  try {
    const result = await action();
    message(typeof success === 'function' ? success(result) : success);
    view.panel = null;
    notesLoadedFor = '';
    return true;
  } catch (error) {
    message(errorMessage(error, 'The change was not saved. Check your connection and try again.'), true);
    return false;
  } finally {
    busy = false;
    await load();
  }
}

function message(text, isError = false) {
  const item = document.createElement('p');
  item.className = `message${isError ? ' error' : ''}`;
  item.textContent = text;
  $('#messages').append(item);
  setTimeout(() => item.remove(), 8000);
}

// ---------- Schedule helpers ----------

const config = () => schedule.config;
const day = () => schedule.days.find(item => item.date === view.date);
const bookingsToday = () => schedule.bookings.filter(booking => booking.date === view.date);
const booking = id => schedule.bookings.find(item => item.id === id);
const types = () => Object.keys(config().resources);
const neededTypes = record => types().filter(type => record.needs?.[type]);

function purposeLabel(purpose) {
  if (purpose === HOLD) return 'Hold';
  return config().purposes[purpose]?.label || 'Other';
}

function detailLabel(purpose) {
  return purpose === HOLD ? 'Reason (private)' : config().purposes[purpose]?.detailLabel || 'Details';
}

function places(record) {
  return neededTypes(record).map(type => unitName(config(), record.assignments?.[type]) || config().resources[type].label).join(', ');
}

// The active booking holding `unitId` during start–end (minutes), if any.
function holderOf(unitId, date, start, end, excludeId = null) {
  return schedule.bookings.find(record => record.id !== excludeId && record.status === 'approved' && record.date === date
    && Object.values(record.assignments || {}).includes(unitId)
    && toMinutes(record.start) < end && start < toMinutes(record.end)) || null;
}

// ---------- Markup ----------

function renderLock(error = '') {
  clearTimeout(refreshTimer);
  root.innerHTML = `
    <form class="card lock" data-form="unlock">
      <h2>Admin is locked</h2>
      <p class="hint">Enter the Admin PIN to manage reservations.</p>
      <label class="visually-hidden" for="pin">Admin PIN</label>
      <div class="pin-row">
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" required>
        <button type="submit" class="primary"${busy ? ' disabled' : ''}>${busy ? 'Checking…' : 'Unlock'}</button>
      </div>
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    </form>`;
  $('#pin')?.focus();
}

function render() {
  if (!schedule) return;
  if (!root.querySelector('[data-region]')) {
    root.innerHTML = `
      <div class="days" data-region="days" role="group" aria-label="Day"></div>
      <div class="columns">
        <section class="card" aria-labelledby="list-title" data-region="list"></section>
        <section class="card" aria-labelledby="map-title" data-region="map"></section>
      </div>
      <section class="card" aria-labelledby="add-title" data-region="add"></section>
      <section class="card" aria-labelledby="old-title">
        <h2 id="old-title">Old records</h2>
        <p class="hint">Removes reservations dated more than 8 weeks ago, with their notes.</p>
        <button type="button" class="secondary danger" data-action="remove-old">Remove old records</button>
      </section>`;
  }
  const region = name => root.querySelector(`[data-region="${name}"]`);
  if (!schedule.days.length) {
    paint(region('days'), '<p class="hint">No days are open for reservations right now.</p>');
    paint(region('list'), '');
    paint(region('map'), '');
    paint(region('add'), '');
    return;
  }
  paint(region('days'), schedule.days.map(item => `
    <button type="button" class="day-button" data-date="${item.date}" data-key="day-${item.date}" aria-pressed="${item.date === view.date}">
      <b>${esc(weekdayName(item.date))}</b> ${esc(monthDay(item.date))}
    </button>`).join(''));
  paint(region('list'), listHtml());
  paint(region('map'), mapHtml());
  paint(region('add'), addHtml());
}

function listHtml() {
  const items = bookingsToday().sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.name.localeCompare(b.name));
  return `<h2 id="list-title">Reservations on ${esc(formatDay(view.date))}</h2>
    ${items.length ? `<ul class="entries">${items.map(entryHtml).join('')}</ul>` : '<p class="hint">No reservations on this day.</p>'}`;
}

function entryHtml(record) {
  const active = record.status === 'approved';
  const detail = record.reservedFor || record.purposeOther || '';
  const panel = view.panel?.id === record.id ? view.panel.kind : null;
  const disabled = busy ? ' disabled' : '';
  const actions = active ? [
    earlierEnds(config(), record.start, record.end).length ? `<button type="button" class="secondary" data-action="open-end" data-id="${esc(record.id)}" data-key="end-${esc(record.id)}"${disabled}>End early</button>` : '',
    `<button type="button" class="secondary danger" data-action="cancel" data-id="${esc(record.id)}" data-key="cancel-${esc(record.id)}"${disabled}>Cancel</button>`
  ] : [
    `<button type="button" class="secondary" data-action="open-restore" data-id="${esc(record.id)}" data-key="restore-${esc(record.id)}"${disabled}>Restore</button>`
  ];
  actions.push(`<button type="button" class="secondary" data-action="open-note" data-id="${esc(record.id)}" data-key="note-${esc(record.id)}"${disabled}>${notes[record.id] ? 'Edit note' : 'Add note'}</button>`);
  return `<li class="entry${active ? '' : ' inactive'}">
    <p class="entry-time">${esc(formatRange(record.start, record.end))}</p>
    <p class="entry-name"><b>${esc(record.name || 'No name')}</b> <span class="badge status-${esc(record.status)}">${esc(STATUS_LABELS[record.status] || record.status)}</span></p>
    <p class="entry-meta">${[places(record), purposeLabel(record.purpose), detail ? `${detailLabel(record.purpose)}: ${detail}` : '', record.ownerUid ? 'Made by a member' : 'Added by Admin'].filter(Boolean).map(esc).join(' · ')}</p>
    ${record.endedEarlyFrom ? `<p class="entry-meta">Ended early; it was booked until ${esc(formatTime(record.endedEarlyFrom))}.</p>` : ''}
    ${notes[record.id] ? `<p class="entry-note">Note: ${esc(notes[record.id])}</p>` : ''}
    <div class="entry-actions">${actions.filter(Boolean).join('')}</div>
    ${panel ? `<div class="entry-panel">${PANELS[panel](record, view.panel.values)}</div>` : ''}
  </li>`;
}

const PANELS = {
  end(record, values) {
    const ends = earlierEnds(config(), record.start, record.end);
    const chosen = values.end || ends[0];
    return `<form data-form="end" data-id="${esc(record.id)}">
      <label for="end-${esc(record.id)}">New end time</label>
      <select id="end-${esc(record.id)}" name="end" data-key="end-select">${ends.map(end => `<option value="${end}"${end === chosen ? ' selected' : ''}>${formatTime(end)}</option>`).join('')}</select>
      <div class="panel-buttons"><button type="submit" class="primary" data-key="panel-save"${busy ? ' disabled' : ''}>Save</button><button type="button" class="text-button" data-action="close-panel" data-key="panel-close">Close</button></div>
    </form>`;
  },

  restore(record, values) {
    const start = toMinutes(record.start);
    const end = toMinutes(record.end);
    const choices = neededTypes(record).map(type => {
      const free = unitsOf(config(), type).filter(unit => !holderOf(unit.id, record.date, start, end, record.id));
      const wanted = [values[type], record.assignments?.[type]].find(id => free.some(unit => unit.id === id));
      return { type, free, selected: wanted || free[0]?.id };
    });
    const blocked = choices.filter(choice => !choice.free.length);
    return `<form data-form="restore" data-id="${esc(record.id)}">
      ${choices.map(choice => choice.free.length ? `
        <label for="restore-${choice.type}">${esc(config().resources[choice.type].label)}</label>
        <select id="restore-${choice.type}" name="${choice.type}" data-key="restore-${choice.type}">${choice.free.map(unit => `<option value="${unit.id}"${unit.id === choice.selected ? ' selected' : ''}>${esc(unit.name)}</option>`).join('')}</select>` : '').join('')}
      ${blocked.length ? `<p class="form-error">No ${listOf(blocked.map(choice => inSentence(config().resources[choice.type].label)))} is free at that time.</p>` : ''}
      <div class="panel-buttons"><button type="submit" class="primary" data-key="panel-save"${busy || blocked.length ? ' disabled' : ''}>Restore</button><button type="button" class="text-button" data-action="close-panel" data-key="panel-close">Close</button></div>
    </form>`;
  },

  note(record, values) {
    return `<form data-form="note" data-id="${esc(record.id)}">
      <label for="note-${esc(record.id)}">Private note (only Admin sees it)</label>
      <textarea id="note-${esc(record.id)}" name="note" rows="3" maxlength="1000" data-key="note-text">${esc(values.note ?? notes[record.id] ?? '')}</textarea>
      <div class="panel-buttons"><button type="submit" class="primary" data-key="panel-save"${busy ? ' disabled' : ''}>Save note</button><button type="button" class="text-button" data-action="close-panel" data-key="panel-close">Close</button></div>
    </form>`;
  }
};

function mapHtml() {
  const current = day();
  const units = unitsOf(config(), view.type);
  const open = toMinutes(config().open);
  const slot = config().slotMinutes;
  const cells = [];
  for (const [index, unit] of units.entries()) {
    for (let minute = open; minute < toMinutes(config().close);) {
      const row = (minute - open) / slot + 2;
      if (serviceAt(current, minute)) { minute += slot; continue; }
      const holder = holderOf(unit.id, current.date, minute, minute + 1);
      if (!holder) { minute += slot; continue; }
      let end = minute + slot;
      while (holderOf(unit.id, current.date, end, end + 1) === holder && !serviceAt(current, end)) end += slot;
      cells.push(`<span class="map-booking purpose-${esc(holder.purpose)}" style="grid-column:${index + 2};grid-row:${row} / span ${(end - minute) / slot}">${esc(holder.name)}</span>`);
      minute = end;
    }
  }
  const services = current.services.map(service => `<span class="map-service" style="grid-row:${(toMinutes(service.start) - open) / slot + 2} / span ${(toMinutes(service.end) - toMinutes(service.start)) / slot}">${esc(service.label)}</span>`);
  const hours = slotStarts(config()).filter(minute => minute % 60 === 0).map(minute => `<span class="map-hour" style="grid-row:${(minute - open) / slot + 2}">${formatHour(minute)}</span>`);
  return `<h2 id="map-title">Day view</h2>
    <div class="map-types" role="group" aria-label="Show">${Object.entries(config().resources).map(([type, resource]) => `
      <button type="button" class="type-button" data-map-type="${type}" data-key="map-${type}" aria-pressed="${type === view.type}">${esc(resource.plural)}</button>`).join('')}</div>
    <div class="map" style="--units:${units.length};--slots:${slotStarts(config()).length}" aria-label="Confirmed reservations for ${esc(inSentence(config().resources[view.type].plural))}">
      <span class="map-corner"></span>${units.map((unit, index) => `<span class="map-unit" style="grid-column:${index + 2}">${esc(unit.name)}</span>`).join('')}
      ${hours.join('')}${services.join('')}${cells.join('')}
    </div>`;
}

// ---------- Add a booking ----------

function blankForm() {
  return { name: '', purpose: 'contact', reservedFor: '', start: '', end: '', units: [], note: '' };
}

function formStarts() {
  const current = day();
  const earliest = earliestStart(config(), current.date);
  return slotStarts(config()).filter(minute => minute >= earliest && !serviceAt(current, minute));
}

function formEnds() {
  const start = toMinutes(form.start);
  if (!Number.isFinite(start)) return [];
  const ends = [];
  for (let end = start + config().slotMinutes; end <= toMinutes(config().close); end += config().slotMinutes) {
    if (validRange(config(), day(), start, end)) ends.push(end);
  }
  return ends;
}

function addHtml() {
  const starts = formStarts();
  const ends = formEnds();
  const start = toMinutes(form.start);
  const end = toMinutes(form.end);
  const timed = Number.isFinite(start) && Number.isFinite(end);
  const purposes = [...Object.keys(config().purposes), HOLD];
  const unitRows = timed ? types().map(type => `
    <fieldset class="unit-choices">
      <legend>${esc(config().resources[type].plural)}</legend>
      ${unitsOf(config(), type).map(unit => {
        const holder = holderOf(unit.id, view.date, start, end);
        return `<label class="unit-choice${holder ? ' taken' : ''}">
          <input type="checkbox" name="unit" value="${unit.id}" data-key="unit-${unit.id}"${form.units.includes(unit.id) ? ' checked' : ''}${holder ? ' disabled' : ''}>
          ${esc(unit.name)}${holder ? ` <small>${esc(holder.name)}</small>` : ''}
        </label>`;
      }).join('')}
    </fieldset>`).join('') : '<p class="hint">Choose a start and end time to see which units are free.</p>';
  return `<h2 id="add-title">Add a reservation on ${esc(formatDay(view.date))}</h2>
    <p class="hint">Reservations added here are active right away. Use Hold to keep a unit free without showing a name.</p>
    <form class="add-form" data-form="add">
      <div class="field"><label for="add-name">Name</label>
        <input id="add-name" name="name" maxlength="120" value="${esc(form.name)}" data-key="add-name" required></div>
      <div class="field"><label for="add-purpose">For</label>
        <select id="add-purpose" name="purpose" data-key="add-purpose">${purposes.map(id => `<option value="${id}"${id === form.purpose ? ' selected' : ''}>${esc(purposeLabel(id))}</option>`).join('')}</select></div>
      <div class="field"><label for="add-detail">${esc(detailLabel(form.purpose))}</label>
        <input id="add-detail" name="reservedFor" maxlength="240" value="${esc(form.reservedFor)}" data-key="add-detail"></div>
      <div class="field"><label for="add-start">Start</label>
        <select id="add-start" name="start" data-key="add-start"><option value="">Choose</option>${starts.map(minute => `<option value="${toTime(minute)}"${toTime(minute) === form.start ? ' selected' : ''}>${formatTime(minute)}</option>`).join('')}</select></div>
      <div class="field"><label for="add-end">End</label>
        <select id="add-end" name="end" data-key="add-end"${ends.length ? '' : ' disabled'}><option value="">Choose</option>${ends.map(minute => `<option value="${toTime(minute)}"${toTime(minute) === form.end ? ' selected' : ''}>${formatTime(minute)}</option>`).join('')}</select></div>
      <div class="units">${unitRows}</div>
      <div class="field wide"><label for="add-note">Private note (optional)</label>
        <textarea id="add-note" name="note" rows="2" maxlength="1000" data-key="add-note">${esc(form.note)}</textarea></div>
      <button type="submit" class="primary"${busy ? ' disabled' : ''}>${busy ? 'Saving…' : 'Add reservation'}</button>
    </form>`;
}

async function submitAdd() {
  const assignments = {};
  for (const id of form.units) {
    const type = types().find(item => unitsOf(config(), item).some(unit => unit.id === id));
    if (assignments[type]) {
      message(`Choose one ${inSentence(config().resources[type].label)} per reservation. Add a second reservation for another.`, true);
      return;
    }
    assignments[type] = id;
  }
  if (!hasText(form.name)) return message('Enter a name.', true);
  if (!form.start || !form.end) return message('Choose a start and end time.', true);
  if (!form.units.length) return message('Choose at least one unit.', true);
  const booking = { date: view.date, start: form.start, end: form.end, name: form.name, purpose: form.purpose, reservedFor: form.reservedFor, note: form.note, assignments };
  const saved = await change(() => call('adminBookingAction', { action: 'add', booking }), `Reservation added for ${form.name.trim()}.`);
  if (saved) {
    form = blankForm();
    render();
  }
}

// ---------- Events ----------

root.addEventListener('submit', event => {
  event.preventDefault();
  const target = event.target;
  const id = target.dataset.id;
  const kind = target.dataset.form;
  if (kind === 'unlock') unlock(target.elements.pin.value);
  else if (kind === 'add') submitAdd();
  else if (kind === 'end') {
    const end = target.elements.end.value;
    change(() => call('adminBookingAction', { action: 'end-early', bookingId: id, end }), `${booking(id).name} now ends at ${formatTime(end)}.`);
  } else if (kind === 'restore') {
    const assignments = Object.fromEntries(neededTypes(booking(id)).map(type => [type, target.elements[type]?.value]));
    change(() => call('adminBookingAction', { action: 'restore', bookingId: id, assignments }), `${booking(id).name}'s reservation is confirmed again.`);
  } else if (kind === 'note') {
    change(() => call('adminNoteAction', { action: 'save', bookingId: id, note: target.elements.note.value }), 'Note saved.');
  }
});

root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (button.dataset.date) {
    view.date = button.dataset.date;
    view.panel = null;
    form = { ...blankForm(), name: form.name, purpose: form.purpose, reservedFor: form.reservedFor, note: form.note };
    render();
  } else if (button.dataset.mapType) {
    view.type = button.dataset.mapType;
    render();
  } else if (action?.startsWith('open-')) {
    view.panel = { id, kind: action.slice(5), values: {} };
    render();
    root.querySelector('.entry-panel select, .entry-panel textarea')?.focus();
  } else if (action === 'close-panel') {
    const { id: panelId, kind } = view.panel;
    view.panel = null;
    render();
    root.querySelector(`[data-key="${kind}-${CSS.escape(panelId)}"]`)?.focus();
  } else if (action === 'cancel') {
    const record = booking(id);
    if (confirm(`Cancel ${record.name}'s reservation, ${formatRange(record.start, record.end)}?`)) {
      change(() => call('adminBookingAction', { action: 'cancel', bookingId: id }), `${record.name}'s reservation was cancelled.`);
    }
  } else if (action === 'remove-old') {
    if (confirm('Delete reservations dated more than 8 weeks ago? This cannot be undone.')) removeOld();
  }
});

async function removeOld() {
  await change(async () => {
    let removed = 0;
    let result;
    do {
      result = await call('adminBookingAction', { action: 'remove-old' });
      removed += result.removed;
    } while (result.more);
    return removed;
  }, removed => removed ? `Removed ${removed} old record${removed === 1 ? '' : 's'}.` : 'There were no old records to remove.');
}

// Form fields update the drafts as the Admin types or picks, so a refresh
// never undoes a choice.
root.addEventListener('input', event => {
  const field = event.target;
  if (view.panel && field.closest('.entry-panel')) {
    view.panel.values[field.name] = field.value;
    return;
  }
  if (!field.closest('[data-form="add"]')) return;
  if (field.name === 'unit') {
    form.units = [...root.querySelectorAll('[data-form="add"] input[name="unit"]:checked')].map(input => input.value);
    return;
  }
  if (!(field.name in form)) return;
  form[field.name] = field.value;
  if (field.name === 'start') {
    form.end = '';
    form.units = [];
  }
  if (field.name === 'end') form.units = form.units.filter(id => !holderOf(id, view.date, toMinutes(form.start), toMinutes(form.end)));
  if (['purpose', 'start', 'end'].includes(field.name)) render();
});

$('#lock').addEventListener('click', () => lock());

// ---------- Start ----------

if (session()) openWorkspace();
else renderLock();
