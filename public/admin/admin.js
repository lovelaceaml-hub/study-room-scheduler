// Admin page: unlock with the PIN, then see every reservation on the open
// days, add reservations or holds, cancel, end early, restore, keep private
// notes, and remove old records. Every change goes through a Cloud Function.
// The session (PIN, token, when the page locks) lives in session.js.

import { errorMessage } from '../shared/firebase.js';
import { escapeHtml as esc, formatTime, formatRange, formatDay, formatHour, inSentence, listOf, weekdayName, monthDay, nowIn, toMinutes, toTime, hasText, readStored, writeStored } from '../shared/format.js';
import { unitsOf, unitName, findUnit, slotStarts, serviceAt, validRange, earliestStart, hasEnded, earlyEndChoices } from '../shared/availability.js';
import { paint } from '../shared/dom.js';
import * as admin from './session.js';

const REFRESH_MS = 15000;
const HIDE_CANCELLED_KEY = 'srs-admin-hide-cancelled';
const STATUS_LABELS = { approved: 'Confirmed', cancelled: 'Cancelled', overridden: 'Replaced', pending: 'Pending', declined: 'Declined' };
// Used when the server does not send a value (an older server during a deploy).
const DEFAULTS = {
  hold: 'blocked', nameMax: 120, detailMax: 240, holdReasonMax: 240, noteMax: 1000, keepDays: 56,
  sessionMinutes: 20, timeZone: 'America/Los_Angeles'
};

const $ = selector => document.querySelector(selector);
const root = $('#admin');

let schedule = null; // { config, days, bookings } from adminSchedule
let notes = {};
let notesFor = ''; // older servers send notes separately: the ids they were read for
let rules = null; // the last config's time zone and session length, kept after a lock
let loading = null; // the schedule load in flight: { epoch, promise }
let refreshTimer = null;
// Bumped when a change starts and when it ends. A load that saw another
// value started before the change finished, so its result is dropped.
let changeMark = 0;
let busy = null; // the change being sent: 'add', 'remove-old' or 'row'
let unlocking = false;
let built = false;
let loadedAt = 0; // when the schedule last loaded, on this device's clock
let offline = false; // the last load failed
let confirmingRemove = false;
const filled = new WeakSet();
// panel: the open row form, { id, kind: 'end' | 'restore' | 'note' | 'cancel', values },
// where `values` keeps what the Admin picked or typed across refreshes.
const view = { date: null, type: 'room', panel: null, search: '' };
let hideCancelled = readStored(HIDE_CANCELLED_KEY) === '1';
let form = blankForm();

// ---------- Rules ----------

const config = () => schedule.config;
const setting = name => {
  const value = (schedule?.config || rules)?.[name];
  return value === undefined || value === null || value === '' ? DEFAULTS[name] : value;
};
const holdId = () => setting('hold');
const timeZone = () => setting('timeZone');
const types = () => Object.keys(config().resources);
const isUnit = (type, id) => unitsOf(config(), type).some(unit => unit.id === id);

function detailMax(purpose) {
  if (purpose === holdId()) return setting('holdReasonMax');
  return config().purposes[purpose]?.detailMax || DEFAULTS.detailMax;
}

// '3:42 PM' on the church's clock for a moment on this device's clock.
function clockTime(ms) {
  return formatTime(nowIn(timeZone(), new Date(ms)).minutes);
}

function keepText() {
  const days = Number(setting('keepDays'));
  if (days % 7) return `${days} day${days === 1 ? '' : 's'}`;
  return `${days / 7} week${days === 7 ? '' : 's'}`;
}

// The first date Remove old records keeps, as 'Aug 8'.
function cutoffText() {
  const cutoff = new Date(`${nowIn(timeZone()).date}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(setting('keepDays')));
  return monthDay(cutoff.toISOString().slice(0, 10));
}

// ---------- Records ----------

const day = () => schedule.days.find(item => item.date === view.date);
const bookingsOnDay = () => schedule.bookings.filter(record => record.date === view.date);
const booking = id => schedule.bookings.find(item => item.id === id);
const displayName = record => String(record.name || '').trim() || 'No name';
const named = record => String(record.name || '').trim();
const whose = record => (named(record) ? `${named(record)}'s reservation` : 'The reservation');

// The types a record needs. Older records may lack `needs`.
function neededTypes(record) {
  return types().filter(type => record.needs?.[type] || isUnit(type, record.assignments?.[type]));
}

// Needed types with no unit; the server sends this as `missing`.
function missingOf(record) {
  if (Array.isArray(record.missing)) return types().filter(type => record.missing.includes(type));
  if (record.status !== 'approved') return [];
  return neededTypes(record).filter(type => !isUnit(type, record.assignments?.[type]));
}

function restorable(record) {
  if (typeof record.restorable === 'boolean') return record.restorable;
  return record.status !== 'approved' || missingOf(record).length > 0;
}

const byMember = record => (typeof record.byMember === 'boolean' ? record.byMember : Boolean(record.ownerUid));

function purposeLabel(purpose) {
  if (purpose === holdId()) return 'Hold';
  return config().purposes[purpose]?.label || 'Other';
}

function detailLabel(purpose) {
  return purpose === holdId() ? 'Reason (private)' : config().purposes[purpose]?.detailLabel || 'Details';
}

function places(record) {
  return neededTypes(record)
    .map(type => unitName(config(), record.assignments?.[type]) || `No ${inSentence(config().resources[type].label)}`)
    .join(', ');
}

// The confirmed record holding `unitId` during start to end (minutes), if any.
function holderOf(unitId, date, start, end, excludeId = null) {
  return schedule.bookings.find(record => record.id !== excludeId && record.status === 'approved' && record.date === date
    && Object.values(record.assignments || {}).includes(unitId)
    && toMinutes(record.start) < end && start < toMinutes(record.end)) || null;
}

// What a priority reservation did to this one, in a sentence.
function noticeText(record) {
  const notice = record.notice;
  if (!notice || record.status === 'cancelled') return '';
  const by = config().purposes[notice.byPurpose]?.label || 'priority';
  const type = findUnit(config(), notice.fromUnit)?.type;
  const noun = type ? inSentence(config().resources[type].label) : 'unit';
  if (notice.kind === 'moved') return `Moved from ${unitName(config(), notice.fromUnit) || `another ${noun}`} for a ${by} reservation.`;
  if (notice.kind === 'shortened') {
    const was = shortenedFrom(record);
    return `Shortened for a ${by} reservation${was ? `; it was booked until ${formatTime(was)}` : ''}.`;
  }
  if (notice.kind === 'released') return `Replaced by a ${by} reservation; no other ${noun} was free.`;
  return '';
}

// The end a priority reservation cut short. Ending early later is a
// separate line, so the two times are never mixed up.
function shortenedFrom(record) {
  return record.notice?.kind === 'shortened' ? record.notice.fromEnd || null : null;
}

// ---------- Lock screen ----------

function renderLock(error = '') {
  clearTimeout(refreshTimer);
  built = false;
  root.innerHTML = `
    <form class="card lock" data-form="unlock">
      <h2>Admin is locked</h2>
      <p class="hint">Enter the Admin PIN to manage reservations.</p>
      <label class="visually-hidden" for="pin">Admin PIN</label>
      <div class="pin-row">
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" required>
        <button type="submit" class="primary" data-role="unlock">Unlock</button>
      </div>
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    </form>`;
  showUnlocking();
  $('#pin').focus();
}

function showUnlocking() {
  const button = root.querySelector('[data-role="unlock"]');
  if (!button) return;
  button.textContent = unlocking ? 'Checking…' : 'Unlock';
  if (unlocking) button.setAttribute('aria-disabled', 'true');
  else button.removeAttribute('aria-disabled');
}

function showLockButton(unlocked) {
  $('#lock').hidden = !unlocked;
  $('#lock-time').hidden = !unlocked;
  if (unlocked) showDeadline();
}

function showDeadline() {
  const deadline = admin.deadline();
  $('#lock-time').textContent = deadline ? `Locks at ${clockTime(deadline)}` : '';
}

async function unlock(pin) {
  if (unlocking) return;
  unlocking = true;
  showUnlocking();
  try {
    await admin.start(pin);
  } catch (error) {
    unlocking = false;
    renderLock(errorMessage(error, 'Admin could not connect. Check your connection and try again.'));
    return;
  }
  unlocking = false;
  openWorkspace();
}

function openWorkspace() {
  if (!admin.session()) {
    renderLock('Admin could not start. Reload the page and try again.');
    return;
  }
  showLockButton(true);
  built = false;
  offline = false;
  root.innerHTML = '<p class="card" data-role="loading">Loading the schedule…</p>';
  refresh();
}

// True when something typed or picked would be lost without keeping it.
function hasDraft() {
  return [form.name, form.reservedFor, form.note, form.start].some(Boolean)
    || ['end', 'restore', 'note'].includes(view.panel?.kind);
}

// Back to the PIN. `keep` keeps what was being typed (an automatic lock); a
// manual Lock clears it. Either way the schedule, notes and messages with
// full names leave the page.
function lockScreen({ reason = '', keep = false } = {}) {
  clearTimeout(refreshTimer);
  if (schedule?.config) rules = { timeZone: schedule.config.timeZone, sessionMinutes: schedule.config.sessionMinutes };
  schedule = null;
  notes = {};
  notesFor = '';
  busy = null;
  unlocking = false;
  offline = false;
  confirmingRemove = false;
  $('#messages').replaceChildren();
  if (keep) {
    if (view.panel?.kind === 'cancel') view.panel = null;
  } else {
    form = blankForm();
    Object.assign(view, { date: null, type: 'room', panel: null, search: '' });
  }
  showLockButton(false);
  renderLock(reason);
}

function expired() {
  const kept = hasDraft() ? ' What you typed is kept.' : '';
  lockScreen({ reason: `Admin locked after ${setting('sessionMinutes')} minutes without changes. Enter the PIN to continue.${kept}`, keep: true });
}

function sessionEnded(error) {
  return String(error?.code || '').replace(/^functions\//, '') === 'permission-denied';
}

function endedByServer(error) {
  const kept = hasDraft() ? ' What you typed is kept.' : '';
  admin.drop();
  lockScreen({ reason: `${errorMessage(error, 'Your Admin session ended. Enter the PIN again.')}${kept}`, keep: true });
}

// ---------- Loading ----------

// One load at a time; a second request joins the one in flight. A load from
// before a Lock is never joined: its result is thrown away, so after the PIN
// a new one starts.
function refresh() {
  const epoch = admin.currentEpoch();
  if (loading?.epoch !== epoch) {
    const current = { epoch, promise: load().finally(() => { if (loading === current) loading = null; }) };
    loading = current;
  }
  return loading.promise;
}

async function load() {
  clearTimeout(refreshTimer);
  const epoch = admin.currentEpoch();
  const mark = changeMark;
  try {
    const result = await admin.call('adminSchedule');
    if (!result?.config || !Array.isArray(result.days) || !Array.isArray(result.bookings)) throw new Error('Unexpected schedule format');
    const read = await notesOf(result);
    if (epoch !== admin.currentEpoch() || mark !== changeMark) return;
    schedule = result;
    [notes, notesFor] = read;
    loadedAt = Date.now();
    offline = false;
    if (!schedule.days.some(item => item.date === view.date)) view.date = schedule.days[0]?.date || null;
    render();
  } catch (error) {
    if (error instanceof admin.Stale || epoch !== admin.currentEpoch()) return;
    if (sessionEnded(error)) {
      endedByServer(error);
      return;
    }
    if (mark !== changeMark) return;
    offline = true;
    render();
  } finally {
    if (epoch === admin.currentEpoch() && admin.session()) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, REFRESH_MS);
    }
  }
}

// [notes by id, ids they were read for]. Rows carry their note; an older
// server sends notes through a separate call instead.
async function notesOf(result) {
  if (result.bookings.every(record => typeof record.note === 'string')) {
    return [Object.fromEntries(result.bookings.filter(record => record.note).map(record => [record.id, record.note])), ''];
  }
  const ids = [...new Set(result.bookings.map(record => record.id))].sort();
  const key = ids.join(',');
  if (key === notesFor) return [notes, key];
  const read = {};
  for (let index = 0; index < ids.length; index += 400) {
    const answer = await admin.call('adminNoteAction', { action: 'read', bookingIds: ids.slice(index, index + 400) });
    Object.assign(read, answer?.notes || {});
  }
  return [read, key];
}

// Runs a change, shows the result, and loads the schedule fresh.
// `closes` is the row panel to close when it works; `focus` is the data-key
// to move to afterwards (also from inside `focusFrom`); `done` runs with the
// result when it works.
async function change({ kind = 'row', run, success, closes = null, focus = null, focusFrom = null, done = null }) {
  if (busy) return false;
  const epoch = admin.currentEpoch();
  busy = kind;
  changeMark += 1;
  render();
  let saved = false;
  try {
    const result = await run();
    if (epoch !== admin.currentEpoch()) return false;
    if (closes && view.panel === closes) view.panel = null;
    done?.(result);
    message(typeof success === 'function' ? success(result) : success);
    saved = true;
  } catch (error) {
    if (error instanceof admin.Stale || epoch !== admin.currentEpoch()) return false;
    if (sessionEnded(error)) {
      endedByServer(error);
      return false;
    }
    message(errorMessage(error, 'The change was not saved. Check your connection and try again.'), true);
  } finally {
    if (epoch === admin.currentEpoch()) {
      // A load that started before this change finished is dropped; this
      // one starts after it.
      changeMark += 1;
      notesFor = '';
      await loading?.promise;
      await refresh();
      if (epoch === admin.currentEpoch()) {
        busy = null;
        render();
        if (saved) settleFocus(focus, focusFrom);
      }
    }
  }
  return saved;
}

// After a change, focus goes to a control that is still there, never the
// page itself.
function settleFocus(key, from = null) {
  const active = document.activeElement;
  const moved = active && active !== document.body && active.isConnected && !(from && active.closest(from));
  if (moved) return;
  const target = (key && root.querySelector(`[data-key="${CSS.escape(key)}"]`)) || $('#list-title');
  target?.focus();
}

function message(text, isError = false) {
  const item = document.createElement('p');
  item.className = `message${isError ? ' error' : ''}`;
  item.textContent = text;
  $('#messages').append(item);
  setTimeout(() => item.remove(), 8000);
}

// ---------- Markup ----------

const region = name => root.querySelector(`[data-region="${name}"]`);
const part = name => root.querySelector(`[data-role="${name}"]`);

// The parts that never change while unlocked are drawn once, so a refresh
// never replaces a text field someone is typing in.
function build() {
  root.innerHTML = `
    <p class="connection" data-role="connection" role="status" hidden></p>
    <div class="days" data-region="days" role="group" aria-label="Day"></div>
    <p class="jump" data-role="jump"><a href="#add-title" data-action="jump-add">Add a reservation</a></p>
    <div class="columns" data-role="day">
      <section class="card" aria-labelledby="list-title">
        <h2 id="list-title" tabindex="-1"></h2>
        <div class="list-tools">
          <div class="field"><label for="list-search">Search this day</label>
            <input id="list-search" type="search" autocomplete="off" data-key="list-search"
              aria-describedby="list-shown" placeholder="Name, contact, purpose or unit"></div>
          <label class="check"><input type="checkbox" id="hide-cancelled" data-key="hide-cancelled"> Hide cancelled</label>
        </div>
        <p class="hint" id="list-shown" data-role="list-empty" aria-live="polite"></p>
        <ul class="entries" data-role="entries"></ul>
      </section>
      <section class="card" aria-labelledby="map-title">
        <h2 id="map-title">Day view</h2>
        <div data-region="map"></div>
        <p class="map-legend" data-region="legend"></p>
      </section>
    </div>
    <section class="card" aria-labelledby="add-title" data-role="add">
      <h2 id="add-title" tabindex="-1"></h2>
      <p class="hint">Reservations added here are active right away. Use Hold to keep a unit free without showing a name.</p>
      <form class="add-form" data-form="add">
        <div class="field"><label for="add-name">Name</label>
          <input id="add-name" name="name" autocomplete="off" data-key="add-name" required></div>
        <div class="field" data-region="add-purpose"></div>
        <div class="field"><label for="add-detail" data-role="detail-label"></label>
          <input id="add-detail" name="reservedFor" autocomplete="off" data-key="add-detail"></div>
        <div class="field" data-region="add-start"></div>
        <div class="field" data-region="add-end"></div>
        <div class="units" data-region="add-units"></div>
        <div class="field wide"><label for="add-note">Private note (optional)</label>
          <textarea id="add-note" name="note" rows="2" data-key="add-note"></textarea></div>
        <button type="submit" class="primary" data-role="add-submit" data-busy>Add reservation</button>
      </form>
    </section>
    <section class="card" aria-labelledby="old-title">
      <h2 id="old-title">Old records</h2>
      <p class="hint" data-role="old-hint"></p>
      <div class="old" data-region="old"></div>
    </section>`;
  $('#add-name').value = form.name;
  $('#add-detail').value = form.reservedFor;
  $('#add-note').value = form.note;
  $('#list-search').value = view.search;
  $('#hide-cancelled').checked = hideCancelled;
  built = true;
}

function render() {
  if (!schedule) {
    const card = part('loading');
    if (card) card.textContent = offline ? 'The schedule could not load. Retrying…' : 'Loading the schedule…';
    return;
  }
  if (!built) build();
  showDeadline();
  const line = part('connection');
  line.hidden = !offline;
  line.textContent = offline ? `Not connected. Showing the schedule from ${clockTime(loadedAt)}.` : '';
  const open = schedule.days.length > 0;
  for (const name of ['jump', 'day', 'add']) part(name).hidden = !open;
  paint(region('days'), open ? schedule.days.map(item => `
    <button type="button" class="day-button" data-date="${esc(item.date)}" data-key="day-${esc(item.date)}" aria-pressed="${item.date === view.date}">
      <b>${esc(weekdayName(item.date))}</b> ${esc(monthDay(item.date))}
    </button>`).join('') : '<p class="hint">No days are open for reservations right now.</p>');
  if (open) {
    renderList();
    paint(region('map'), mapHtml());
    paint(region('legend'), legendHtml());
    renderAdd();
  }
  renderOld();
  showBusy();
}

// Change buttons look and act disabled while a change is being sent. They
// keep focus (aria-disabled), so focus never falls back to the page.
function showBusy() {
  for (const button of root.querySelectorAll('[data-busy]')) {
    if (busy) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }
  const submit = part('add-submit');
  if (submit) submit.textContent = busy === 'add' ? 'Saving…' : 'Add reservation';
}

// ---------- Reservation list ----------

// Lowercase, without accents, so "jose" finds "José".
const folded = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

// What the search looks through: the names, contact or member, purpose and units.
function searchText(record) {
  return folded([record.name, record.reservedFor, record.purposeOther, purposeLabel(record.purpose), places(record)].join(' '));
}

// The record with an open panel always stays, so a filter never loses what
// is being typed there.
function shown(record, words) {
  if (view.panel?.id === record.id) return true;
  if (hideCancelled && record.status === 'cancelled') return false;
  const text = searchText(record);
  return words.every(word => text.includes(word));
}

function renderList() {
  $('#list-title').textContent = `Reservations on ${formatDay(view.date)}`;
  const all = bookingsOnDay();
  const words = folded(view.search).split(/\s+/).filter(Boolean);
  const items = all.filter(record => shown(record, words)).sort((a, b) => toMinutes(a.start) - toMinutes(b.start)
    || String(a.name || '').localeCompare(String(b.name || '')));
  if (view.panel && !items.some(record => record.id === view.panel.id)) view.panel = null;
  const status = part('list-empty');
  const text = !all.length ? 'No reservations on this day.'
    : !items.length ? 'No reservations on this day match.'
      : items.length < all.length ? `Showing ${items.length} of ${all.length}.` : '';
  if (status.textContent !== text) status.textContent = text;
  status.hidden = !text;
  const list = part('entries');
  // Each row is kept and only its changed parts are redrawn, so an open
  // panel (and a note being typed there) survives a refresh.
  const rows = new Map([...list.children].map(item => [item.dataset.row, item]));
  let previous = null;
  for (const record of items) {
    let item = rows.get(record.id);
    if (item) {
      rows.delete(record.id);
    } else {
      item = document.createElement('li');
      item.dataset.row = record.id;
      const body = document.createElement('div');
      const panel = document.createElement('div');
      panel.className = 'entry-panel';
      item.append(body, panel);
    }
    const place = previous ? previous.nextSibling : list.firstChild;
    if (item !== place) list.insertBefore(item, place);
    item.className = `entry${record.status === 'approved' ? '' : ' inactive'}`;
    const html = panelHtml(record);
    paint(item.firstChild, entryHtml(record));
    paint(item.lastChild, html);
    item.lastChild.hidden = !html;
    fillNote(item.lastChild, record);
    previous = item;
  }
  for (const item of rows.values()) item.remove();
}

// The ends End early may offer. The server sends them (`earlyEnds`, already
// without passed ends) and says when a reservation has `ended`; an older
// server does not, so the page works them out on its own clock.
function endChoices(record) {
  if (record.status !== 'approved') return [];
  const ended = typeof record.ended === 'boolean' ? record.ended : hasEnded(config(), record.date, record.end);
  if (ended) return [];
  if (Array.isArray(record.earlyEnds)) {
    return record.earlyEnds.filter(end => toMinutes(record.start) < toMinutes(end) && toMinutes(end) < toMinutes(record.end));
  }
  return earlyEndChoices(config(), record.date, record.start, record.end);
}

function entryHtml(record) {
  const active = record.status === 'approved';
  const open = view.panel?.id === record.id ? view.panel.kind : null;
  const detail = record.reservedFor || record.purposeOther || '';
  const missing = missingOf(record);
  const note = notes[record.id];
  const id = esc(record.id);
  const opener = (action, label, danger = false) => (open === action.slice(5) ? '' : `<button type="button" class="secondary${danger ? ' danger' : ''}" data-action="${action}" data-id="${id}" data-key="${action}-${id}">${label}</button>`);
  const actions = active ? [
    endChoices(record).length ? opener('open-end', 'End early') : '',
    missing.length && restorable(record) ? opener('open-restore', 'Choose a new unit') : '',
    opener('open-cancel', 'Cancel', true)
  ] : [restorable(record) && neededTypes(record).length ? opener('open-restore', 'Restore') : ''];
  actions.push(opener('open-note', note ? 'Edit note' : 'Add note'));
  // "Room 1 · Contact: Sample Person", as members see it in My reservations.
  const meta = [places(record), detail ? `${purposeLabel(record.purpose)}: ${detail}` : purposeLabel(record.purpose), byMember(record) ? 'Made by a member' : 'Added by Admin'];
  const notice = noticeText(record);
  const endedEarly = record.endedEarlyFrom && record.endedEarlyFrom !== shortenedFrom(record) ? record.endedEarlyFrom : null;
  return `<p class="entry-time">${esc(formatRange(record.start, record.end))}</p>
    <p class="entry-name"><b>${esc(displayName(record))}</b> <span class="badge status-${esc(record.status)}">${esc(STATUS_LABELS[record.status] || record.status || 'Unknown')}</span></p>
    <p class="entry-meta">${meta.filter(Boolean).map(esc).join(' · ')}</p>
    ${notice ? `<p class="entry-meta entry-notice">${esc(notice)}</p>` : ''}
    ${endedEarly ? `<p class="entry-meta">Ended early; it was booked until ${esc(formatTime(endedEarly))}.</p>` : ''}
    ${record.status === 'cancelled' && record.byAdmin ? '<p class="entry-meta">Cancelled by Admin.</p>' : ''}
    ${note ? `<p class="entry-note">Note: ${esc(note)}</p>` : ''}
    <div class="entry-actions">${actions.filter(Boolean).join('')}</div>`;
}

function panelHtml(record) {
  if (view.panel?.id !== record.id) return '';
  const html = PANELS[view.panel.kind]?.(record, view.panel.values) ?? '';
  if (!html) view.panel = null;
  return html;
}

const closeButton = '<button type="button" class="text-button" data-action="close-panel" data-key="panel-close">Close</button>';

const PANELS = {
  end(record, values) {
    const ends = endChoices(record);
    if (!ends.length) return '';
    const chosen = ends.includes(values.end) ? values.end : ends[0];
    return `<form data-form="end" data-id="${esc(record.id)}">
      <label for="end-select">New end time</label>
      <select id="end-select" name="end" data-key="end-select">${ends.map(end => `<option value="${end}"${end === chosen ? ' selected' : ''}>${formatTime(end)}</option>`).join('')}</select>
      <div class="panel-buttons"><button type="submit" class="primary" data-key="panel-save" data-busy>Save end time</button>${closeButton}</div>
    </form>`;
  },

  // A cancelled or replaced reservation gets units for everything it needs;
  // a confirmed one that lost a unit gets just the missing ones.
  restore(record, values) {
    const start = toMinutes(record.start);
    const end = toMinutes(record.end);
    const wanted = record.status === 'approved' ? missingOf(record) : neededTypes(record);
    if (!wanted.length) return '';
    const choices = wanted.map(type => {
      const free = unitsOf(config(), type).filter(unit => !holderOf(unit.id, record.date, start, end, record.id));
      const selected = [values[type], record.assignments?.[type]].find(id => free.some(unit => unit.id === id)) || free[0]?.id;
      return { type, free, selected };
    });
    const blocked = choices.filter(choice => !choice.free.length);
    return `<form data-form="restore" data-id="${esc(record.id)}">
      ${choices.map(choice => choice.free.length ? `
        <label for="restore-${esc(choice.type)}">${esc(config().resources[choice.type].label)}</label>
        <select id="restore-${esc(choice.type)}" name="${esc(choice.type)}" data-key="restore-${esc(choice.type)}">${choice.free.map(unit => `<option value="${esc(unit.id)}"${unit.id === choice.selected ? ' selected' : ''}>${esc(unit.name)}</option>`).join('')}</select>` : '').join('')}
      ${blocked.length ? `<p class="form-error">No ${esc(listOf(blocked.map(choice => inSentence(config().resources[choice.type].label))))} is free at that time.</p>` : ''}
      <div class="panel-buttons"><button type="submit" class="primary" data-key="panel-save"${blocked.length ? ' disabled' : ' data-busy'}>Restore</button>${closeButton}</div>
    </form>`;
  },

  // The note's text is filled in once (fillNote), not drawn here, so a
  // refresh never redraws the field while someone types in it.
  note(record) {
    return `<form data-form="note" data-id="${esc(record.id)}">
      <label for="note-text">Private note (only Admin sees it)</label>
      <textarea id="note-text" name="note" rows="3" maxlength="${esc(setting('noteMax'))}" data-key="note-text"></textarea>
      <div class="panel-buttons"><button type="submit" class="primary" data-key="panel-save" data-busy>Save note</button>${closeButton}</div>
    </form>`;
  },

  cancel(record) {
    if (record.status !== 'approved') return '';
    const what = [places(record), formatDay(record.date), formatRange(record.start, record.end)].filter(Boolean).join(', ');
    return `<div class="confirm" role="group" aria-labelledby="panel-question">
      <h3 id="panel-question" tabindex="-1" data-key="panel-question">Cancel this reservation?</h3>
      <p>${esc(what)}. Its time opens for others right away. You can restore it later.</p>
      <div class="panel-buttons"><button type="button" class="primary danger" data-action="cancel" data-id="${esc(record.id)}" data-key="panel-yes" data-busy>Yes, cancel it</button><button type="button" class="text-button" data-action="close-panel" data-key="panel-close">Keep it</button></div>
    </div>`;
  }
};

function fillNote(panel, record) {
  const field = panel.querySelector('textarea[name="note"]');
  if (!field || filled.has(field)) return;
  filled.add(field);
  field.value = view.panel?.values.note ?? notes[record.id] ?? '';
}

// ---------- Day view ----------

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
      cells.push(`<span class="map-booking purpose-${esc(holder.purpose)}" style="grid-column:${index + 2};grid-row:${row} / span ${(end - minute) / slot}">${esc(displayName(holder))}</span>`);
      minute = end;
    }
  }
  const services = current.services.map(service => `<span class="map-service" style="grid-row:${(toMinutes(service.start) - open) / slot + 2} / span ${(toMinutes(service.end) - toMinutes(service.start)) / slot}">${esc(service.label)}</span>`);
  const hours = slotStarts(config()).filter(minute => minute % 60 === 0).map(minute => `<span class="map-hour" style="grid-row:${(minute - open) / slot + 2}">${formatHour(minute)}</span>`);
  return `<div class="map-types" role="group" aria-label="Show">${Object.entries(config().resources).map(([type, resource]) => `
      <button type="button" class="type-button" data-map-type="${esc(type)}" data-key="map-${esc(type)}" aria-pressed="${type === view.type}">${esc(resource.plural)}</button>`).join('')}</div>
    <div class="map" style="--units:${units.length};--slots:${slotStarts(config()).length}" role="group" aria-label="Confirmed reservations for ${esc(inSentence(config().resources[view.type]?.plural || ''))}">
      <span class="map-corner"></span>${units.map((unit, index) => `<span class="map-unit" style="grid-column:${index + 2}">${esc(unit.name)}</span>`).join('')}
      ${hours.join('')}${services.join('')}${cells.join('')}
    </div>`;
}

function legendHtml() {
  const items = [...Object.entries(config().purposes).map(([id, purpose]) => [id, purpose.label]), [holdId(), 'Hold']];
  return items.map(([id, label]) => `<span><i class="swatch purpose-${esc(id)}" aria-hidden="true"></i>${esc(label)}</span>`).join('');
}

// ---------- Add a reservation ----------

function blankForm() {
  return { name: '', purpose: 'contact', reservedFor: '', start: '', end: '', assignments: {}, note: '' };
}

function formStarts() {
  const current = day();
  const earliest = earliestStart(config(), current.date);
  return slotStarts(config()).filter(minute => minute >= earliest && !serviceAt(current, minute)
    && validRange(config(), current, minute, minute + config().slotMinutes));
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

// Only the choices that depend on the schedule are redrawn; the text fields
// are drawn once in build().
function renderAdd() {
  $('#add-title').textContent = `Add a reservation on ${formatDay(view.date)}`;
  const purposes = [...Object.keys(config().purposes), holdId()];
  if (!purposes.includes(form.purpose)) form.purpose = purposes[0];
  paint(region('add-purpose'), `<label for="add-purpose">For</label>
    <select id="add-purpose" name="purpose" data-key="add-purpose">${purposes.map(id => `<option value="${esc(id)}"${id === form.purpose ? ' selected' : ''}>${esc(purposeLabel(id))}</option>`).join('')}</select>`);
  part('detail-label').textContent = detailLabel(form.purpose);
  $('#add-name').maxLength = setting('nameMax');
  $('#add-detail').maxLength = detailMax(form.purpose);
  $('#add-note').maxLength = setting('noteMax');

  // A start that has passed since it was picked is no longer offered.
  const starts = formStarts();
  if (form.start && !starts.includes(toMinutes(form.start))) Object.assign(form, { start: '', end: '', assignments: {} });
  const ends = formEnds();
  if (form.end && !ends.includes(toMinutes(form.end))) Object.assign(form, { end: '', assignments: {} });
  paint(region('add-start'), `<label for="add-start">Start</label>
    <select id="add-start" name="start" data-key="add-start"><option value="">Choose</option>${starts.map(minute => `<option value="${toTime(minute)}"${toTime(minute) === form.start ? ' selected' : ''}>${formatTime(minute)}</option>`).join('')}</select>`);
  paint(region('add-end'), `<label for="add-end">End</label>
    <select id="add-end" name="end" data-key="add-end"${ends.length ? '' : ' disabled'}><option value="">Choose</option>${ends.map(minute => `<option value="${toTime(minute)}"${toTime(minute) === form.end ? ' selected' : ''}>${formatTime(minute)}</option>`).join('')}</select>`);
  paint(region('add-units'), unitsHtml());
}

// One list per type, so a reservation gets at most one unit of each.
function unitsHtml() {
  const start = toMinutes(form.start);
  const end = toMinutes(form.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '<p class="hint">Choose a start and end time to see which units are free.</p>';
  return types().map(type => {
    const resource = config().resources[type];
    if (form.assignments[type] && holderOf(form.assignments[type], view.date, start, end)) form.assignments[type] = '';
    const options = unitsOf(config(), type).map(unit => {
      const holder = holderOf(unit.id, view.date, start, end);
      return `<option value="${esc(unit.id)}"${unit.id === form.assignments[type] ? ' selected' : ''}${holder ? ' disabled' : ''}>${esc(unit.name)}${holder ? ` (taken by ${esc(displayName(holder))})` : ''}</option>`;
    }).join('');
    return `<div class="field"><label for="add-unit-${esc(type)}">${esc(resource.label)}</label>
      <select id="add-unit-${esc(type)}" name="unit-${esc(type)}" data-type="${esc(type)}" data-key="add-unit-${esc(type)}"><option value="">None</option>${options}</select></div>`;
  }).join('');
}

function setAddFields() {
  $('#add-name').value = form.name;
  $('#add-detail').value = form.reservedFor;
  $('#add-note').value = form.note;
}

async function submitAdd() {
  const assignments = Object.fromEntries(types().filter(type => form.assignments[type]).map(type => [type, form.assignments[type]]));
  if (!hasText(form.name)) return message('Enter a name.', true);
  if (!form.start || !form.end) return message('Choose a start and end time.', true);
  if (!Object.keys(assignments).length) return message('Choose at least one unit.', true);
  const sent = { ...form };
  const request = { date: view.date, start: form.start, end: form.end, name: form.name, purpose: form.purpose, reservedFor: form.reservedFor, note: form.note, assignments };
  await change({
    kind: 'add',
    run: () => admin.call('adminBookingAction', { action: 'add', booking: request }),
    success: `Reservation added for ${form.name.trim()}.`,
    focus: 'add-name',
    focusFrom: '[data-role="add-submit"]',
    // Clear what was sent, but not what was typed while it was sending.
    done() {
      const blank = blankForm();
      for (const key of ['name', 'purpose', 'reservedFor', 'note']) if (form[key] === sent[key]) form[key] = blank[key];
      Object.assign(form, { start: '', end: '', assignments: {} });
      setAddFields();
    }
  });
}

// ---------- Old records ----------

function renderOld() {
  part('old-hint').textContent = `Permanently deletes reservations dated more than ${keepText()} ago, and their private notes.`;
  paint(region('old'), confirmingRemove ? `
    <div class="confirm" role="group" aria-labelledby="old-question">
      <p id="old-question" tabindex="-1" data-key="old-question">Delete reservations dated before ${esc(cutoffText())} and their private notes? This cannot be undone.</p>
      <div class="panel-buttons"><button type="button" class="primary danger" data-action="remove-old-yes" data-key="remove-old-yes" data-busy>Yes, delete them</button><button type="button" class="text-button" data-action="remove-old-no" data-key="remove-old-no">Keep them</button></div>
    </div>` : `<button type="button" class="secondary danger" data-action="remove-old" data-key="remove-old" data-busy>${busy === 'remove-old' ? 'Removing…' : 'Remove old records'}</button>`);
}

// The server removes old records in batches; this keeps asking until none
// are left, and counts them all.
async function removeOld() {
  await change({
    kind: 'remove-old',
    focus: 'remove-old',
    async run() {
      let removed = 0;
      for (let batch = 0; batch < 100; batch += 1) {
        let result;
        try {
          result = await admin.call('adminBookingAction', { action: 'remove-old' });
        } catch (error) {
          if (!removed || error instanceof admin.Stale || sessionEnded(error)) throw error;
          throw Object.assign(new Error(`Removed ${removed} old record${removed === 1 ? '' : 's'}, then the connection dropped. Try again to remove the rest.`), { code: 'failed-precondition' });
        }
        const count = Number(result?.removed) || 0;
        removed += count;
        if (!result?.more || !count) break;
      }
      return removed;
    },
    success: removed => (removed ? `Removed ${removed} old record${removed === 1 ? '' : 's'}.` : 'There were no old records to remove.')
  });
}

// ---------- Events ----------

root.addEventListener('submit', event => {
  event.preventDefault();
  const target = event.target;
  const kind = target.dataset.form;
  if (kind === 'unlock') {
    unlock(target.elements.pin.value);
    return;
  }
  if (busy) return;
  const id = target.dataset.id;
  const record = id === undefined ? null : booking(id);
  if (kind === 'add') submitAdd();
  else if (!record) return;
  else if (kind === 'end') {
    const end = target.elements.end.value;
    change({
      run: () => admin.call('adminBookingAction', { action: 'end-early', bookingId: id, end }),
      success: `${named(record) || 'The reservation'} now ends at ${formatTime(end)}.`,
      closes: view.panel,
      focus: `open-note-${id}`
    });
  } else if (kind === 'restore') {
    const wanted = record.status === 'approved' ? missingOf(record) : neededTypes(record);
    const assignments = Object.fromEntries(wanted.map(type => [type, target.elements[type]?.value]));
    const names = Object.values(assignments).map(unit => unitName(config(), unit)).filter(Boolean);
    change({
      run: () => admin.call('adminBookingAction', { action: 'restore', bookingId: id, assignments }),
      success: record.status === 'approved' ? `${whose(record)} now has ${listOf(names)}.` : `${whose(record)} is confirmed again.`,
      closes: view.panel,
      focus: `open-note-${id}`
    });
  } else if (kind === 'note') {
    const note = target.elements.note.value;
    change({
      run: () => admin.call('adminNoteAction', { action: 'save', bookingId: id, note }),
      success: note.trim() ? 'Note saved.' : 'Note removed.',
      closes: view.panel,
      focus: `open-note-${id}`
    });
  }
});

root.addEventListener('click', event => {
  const target = event.target.closest('button, a[data-action]');
  if (!target || target.disabled) return;
  const { action, id } = target.dataset;
  if (action === 'jump-add') {
    event.preventDefault();
    $('#add-title').scrollIntoView({ block: 'start' });
    $('#add-name').focus({ preventScroll: true });
    return;
  }
  if (target.getAttribute('aria-disabled') === 'true') return;
  if (target.dataset.date) {
    view.date = target.dataset.date;
    view.panel = null;
    Object.assign(form, { start: '', end: '', assignments: {} });
    render();
  } else if (target.dataset.mapType) {
    view.type = target.dataset.mapType;
    render();
  } else if (action?.startsWith('open-')) {
    view.panel = { id, kind: action.slice(5), values: {} };
    render();
    const row = [...part('entries').children].find(item => item.dataset.row === id);
    row?.querySelector('.entry-panel :is(select, textarea, [tabindex="-1"], button:not([disabled]))')?.focus();
  } else if (action === 'close-panel') {
    const { id: panelId, kind } = view.panel || {};
    view.panel = null;
    render();
    root.querySelector(`[data-key="${CSS.escape(`open-${kind}-${panelId}`)}"]`)?.focus();
  } else if (action === 'cancel') {
    const record = booking(id);
    if (!record || busy) return;
    change({
      run: () => admin.call('adminBookingAction', { action: 'cancel', bookingId: id }),
      success: `${whose(record)} was cancelled.`,
      closes: view.panel,
      focus: `open-note-${id}`
    });
  } else if (action === 'remove-old') {
    confirmingRemove = true;
    render();
    root.querySelector('[data-key="old-question"]')?.focus();
  } else if (action === 'remove-old-no') {
    confirmingRemove = false;
    render();
    root.querySelector('[data-key="remove-old"]')?.focus();
  } else if (action === 'remove-old-yes') {
    if (busy) return;
    confirmingRemove = false;
    removeOld();
  }
});

// Form fields update the drafts as the Admin types or picks, so a refresh
// never undoes a choice.
root.addEventListener('input', event => {
  const field = event.target;
  if (field.id === 'list-search' || field.id === 'hide-cancelled') {
    if (field.id === 'list-search') view.search = field.value;
    else {
      hideCancelled = field.checked;
      writeStored(HIDE_CANCELLED_KEY, hideCancelled ? '1' : '0');
    }
    renderList();
    return;
  }
  if (field.closest('.entry-panel')) {
    if (view.panel) view.panel.values[field.name] = field.value;
    return;
  }
  if (!field.closest('[data-form="add"]')) return;
  if (field.dataset.type) {
    form.assignments[field.dataset.type] = field.value;
    return;
  }
  if (!(field.name in form)) return;
  form[field.name] = field.value;
  if (field.name === 'start') Object.assign(form, { end: '', assignments: {} });
  if (['purpose', 'start', 'end'].includes(field.name)) render();
});

$('#lock').addEventListener('click', () => {
  admin.end();
  lockScreen();
});

admin.on('expired', expired);
admin.on('deadline', showDeadline);

// ---------- Start ----------

if (admin.session()) openWorkspace();
else renderLock();
