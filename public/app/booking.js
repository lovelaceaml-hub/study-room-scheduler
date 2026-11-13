// The booking sheet. From the Reserve button the day and kind on screen are
// already chosen, so the steps are: what for, start, end, names, confirm
// (with "Reserve something else", what comes first). From a tapped open time
// the unit and start are chosen too, so it skips to what for, end, names,
// confirm. What each step shows is in booking-steps.js.

import { escapeHtml as esc, formatTime, formatDay, hasText, inSentence, readStored, toTime } from '../shared/format.js';
import { rangeChoice, earliestBookableStart } from '../shared/availability.js';
import { book, canBook, refresh, newRequestId, NAME_KEY } from './store.js';
import { createSheet } from './sheet.js';
import { createSteps, PASSED, INLINE_ERROR_STEPS } from './booking-steps.js';
import { connectionBanner } from './parts.js';
import { detailLabel, placeLabel } from './text.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';

const NOT_OPEN = 'This time is no longer open. Go back and choose another time.';
const CHANGED = 'The schedule changed while you were deciding. Check the details and confirm again.';

export function createBookingSheet({ getState, onShow, onOpenMine }) {
  const dialog = document.getElementById('booking-sheet');
  let draft = null;
  let step = '';
  let past = [];
  let saving = false;
  let error = '';
  let errorField = null; // 'name' | 'detail' when a field caused the error
  let saved = null;
  let wasReady = true;
  // The id sent with this draft, kept while the draft stays the same (after
  // a lost answer, while its time and place stay the same) so a retry is
  // recognised by the server.
  let request = null; // { key, place, id }
  // After a lost answer: the ids of this device's reservations before it was
  // sent, so a reservation that appears later is recognised as this one.
  let unconfirmed = null;

  const sheet = createSheet(dialog, {
    // Escape and Android Back go back one step.
    onEscape: () => (past.length && step !== 'done' ? back() : sheet.close()),
    // After the first step only the X closes, so a stray tap keeps the draft.
    closeOnOutside: () => !past.length || step === 'done'
  });

  const state = () => getState();
  const config = () => state().config;
  const day = () => state().days.find(item => item.date === draft.date) || null;
  const rows = () => state().bookings.filter(row => row.type === draft.type);
  // A Force override adds a warning step after the confirmation.
  const steps = () => (draft.fixed ? ['purpose', 'end', 'names', 'confirm']
    : draft.typeGiven ? ['purpose', 'start', 'end', 'names', 'confirm']
    : ['type', 'purpose', 'start', 'end', 'names', 'confirm']).concat(draft.forced ? ['force'] : []);
  const markup = createSteps({
    state, config, day, rows, currentError, startPassed,
    get draft() { return draft; },
    get saving() { return saving; },
    get saved() { return saved; },
    get errorField() { return errorField; }
  });

  // `preset`: { date, type } from the Reserve button, { date } from "Reserve
  // something else", { date, type, unit, start } from a tapped time, or the
  // same with `force: true` from "Force override" on someone's reservation.
  function open(preset = {}) {
    // Still saving the last one: show it rather than starting over.
    if (saving) {
      sheet.open();
      render({ focus: 'h2' });
      return;
    }
    const current = state();
    if (!canBook(current) || !current.days.length) return;
    const date = current.days.some(item => item.date === preset.date) ? preset.date : current.days[0].date;
    const type = Object.hasOwn(current.config.resources, preset.type ?? '') ? preset.type : null;
    const fixed = Boolean(type && preset.unit);
    draft = {
      date,
      type,
      unit: fixed ? preset.unit : null,
      fixed,
      typeGiven: Boolean(type),
      start: fixed ? preset.start ?? null : null,
      end: null,
      purpose: null,
      takeover: false,
      // `force`: taken times are offered as Force overrides. `forced`: the
      // chosen time is one, so the warning step must be confirmed.
      force: preset.force === true,
      forced: false,
      name: readStored(NAME_KEY) || '',
      reservedFor: ''
    };
    past = [];
    error = '';
    errorField = null;
    saved = null;
    wasReady = true;
    request = null;
    unconfirmed = null;
    step = steps()[0];
    sheet.open();
    render({ focus: 'h2' });
  }

  function go(next) {
    past.push(step);
    step = next;
    error = '';
    errorField = null;
    render({ focus: 'h2' });
  }

  function back() {
    if (!past.length || saving) return;
    step = past.pop();
    error = '';
    errorField = null;
    if (step === 'start') Object.assign(draft, { start: null, end: null, takeover: false, forced: false });
    if (step === 'end') Object.assign(draft, { end: null, takeover: false, forced: false });
    if (!draft.fixed && (step === 'start' || step === 'end')) draft.unit = null;
    render({ focus: 'h2' });
  }

  // A time that has begun cannot be reserved.
  function startPassed() {
    return draft.start != null && draft.start < earliestBookableStart(config(), draft.date);
  }

  // Called on every schedule refresh. Only the steps that list open times
  // and the confirmation depend on the schedule; the others are redrawn only
  // when the connection changes, so typing is never interrupted.
  function update() {
    if (!sheet.isOpen || saving) return;
    // An answer was lost: once the schedule shows the reservation was made
    // after all, say so instead of offering to book it again.
    const made = unconfirmed ? madeSince(unconfirmed) : null;
    if (made) {
      succeed({ id: made.id, unit: made.unit });
      render();
      return;
    }
    const ready = canBook(state());
    const readyChanged = ready !== wasReady;
    wasReady = ready;
    if (!day()) error = 'This day is no longer open for reservations. Close this and choose another day.';
    else if (step === 'confirm') followSchedule();
    else if (step === 'force' && !followSchedule()) step = past.pop();
    if (['start', 'end', 'confirm', 'force'].includes(step) || readyChanged || !day()) render();
  }

  // Keeps the confirmation in line with the schedule: the unit the server
  // would give now, and a warning when a takeover appeared, went away or
  // moved to another unit. Returns false when the member must look again.
  function followSchedule() {
    const choice = currentChoice();
    if (!choice) return true;
    if (choice.takeover !== draft.takeover || choice.force !== draft.forced || (choice.takeover && choice.unit !== draft.unit)) {
      Object.assign(draft, { unit: choice.unit, takeover: choice.takeover, forced: choice.force });
      error = CHANGED;
      return false;
    }
    draft.unit = choice.unit;
    return true;
  }

  // ---------- Markup ----------

  function render({ focus = null } = {}) {
    const index = steps().indexOf(step);
    const title = saving ? 'Saving…' : step === 'done' ? 'Done' : `Step ${index + 1} of ${steps().length}`;
    const chips = step === 'done' ? [] : [
      formatDay(draft.date),
      draft.type ? (draft.fixed ? placeLabel(config(), draft.type, draft.unit) : config().resources[draft.type].label) : '',
      draft.start != null ? formatTime(draft.start) : ''
    ].filter(Boolean);
    const showBack = past.length && step !== 'done' && !saving;
    sheet.render(`
      <div class="sheet-bar">
        <button type="button" class="icon-button" data-action="back" data-key="back" aria-label="Back"${showBack ? '' : ' hidden'}>${ICONS.back}</button>
        <span class="sheet-step">${title}</span>
        <button type="button" class="icon-button" data-action="close" data-key="close" aria-label="Close"${saving ? ' disabled' : ''}>${ICONS.close}</button>
      </div>
      ${chips.length ? `<p class="chips">${chips.map(chip => `<span>${esc(chip)}</span>`).join('')}</p>` : ''}
      ${step === 'done' ? '' : bannerHtml()}
      <section class="step">${markup.html(step)}</section>
      ${INLINE_ERROR_STEPS.includes(step) ? '' : markup.errorLine()}
    `, { focus });
  }

  const bannerHtml = () => connectionBanner(state(), 'The schedule is reconnecting. Your choices are kept.');

  // The message under the current step: a start that has passed or a time
  // that is no longer open outranks the last error.
  function currentError() {
    if (saving || !['names', 'confirm', 'force'].includes(step)) return error;
    if (startPassed()) return PASSED;
    if (step !== 'names' && day() && !currentChoice()) return NOT_OPEN;
    return error;
  }

  // ---------- Actions ----------

  // The best unit for the whole range right now, honoring a tapped unit.
  function currentChoice(end = draft.end) {
    if (!day()) return null;
    return rangeChoice(config(), rows(), day(), draft.type, draft.start, end, draft.purpose, draft.fixed ? draft.unit : null, undefined, draft.force);
  }

  // Why the draft cannot be sent as it stands, or ''. Brings the takeover
  // preview up to date as a side effect.
  function problem() {
    if (startPassed()) return PASSED;
    if (!currentChoice()) return NOT_OPEN;
    return followSchedule() ? '' : CHANGED;
  }

  async function confirm() {
    if (saving) return;
    const stop = problem();
    if (stop) {
      error = stop;
      render();
      return;
    }
    const sending = {
      date: draft.date,
      type: draft.type,
      unit: draft.fixed ? draft.unit : null,
      start: toTime(draft.start),
      end: toTime(draft.end),
      purpose: draft.purpose,
      name: draft.name,
      reservedFor: draft.reservedFor,
      takeover: draft.takeover,
      takeoverUnit: draft.takeover ? draft.unit : null,
      force: draft.forced
    };
    // The same reservation keeps its request id through every retry, even when
    // the unit or takeover changes (a lost answer may have taken the free
    // unit itself), so the server answers a retry with the first result
    // instead of booking twice. After a lost answer it is kept even when the
    // names change, since the server may already hold the reservation under
    // the first ones. Reusing an id is always safe: the server either made
    // that reservation or made nothing.
    const { takeover, takeoverUnit, force, ...what } = sending;
    const { name, reservedFor, ...when } = what;
    const key = JSON.stringify(what);
    const place = JSON.stringify(when);
    const same = request && (request.key === key || (unconfirmed && request.place === place));
    request = same ? { ...request, key } : { key, place, id: newRequestId() };
    const before = unconfirmed || new Set(state().mine.map(item => item.id));
    saving = true;
    sheet.locked = true;
    error = '';
    render();
    try {
      const result = await book({ ...sending, requestId: request.id });
      succeed({ id: result.id, unit: result.unit });
    } catch (failure) {
      // The answer was lost, but the reservation may have been made anyway.
      const made = failure.lost ? madeSince(before) : null;
      if (made) succeed({ id: made.id, unit: made.unit });
      else {
        if (failure.lost) unconfirmed = before;
        error = problem() || failure.message;
      }
    } finally {
      saving = false;
      sheet.locked = false;
      finishSave();
    }
  }

  function succeed(result) {
    saved = result;
    past = [];
    step = 'done';
    request = null;
    unconfirmed = null;
    error = '';
    announce('Reservation confirmed.');
  }

  // A reservation on this device for exactly the draft's time that was not
  // there before it was sent.
  function madeSince(before) {
    return state().mine.find(item => !before.has(item.id) && item.status === 'approved'
      && item.date === draft.date && item.type === draft.type
      && item.start === toTime(draft.start) && item.end === toTime(draft.end)) || null;
  }

  // Shows the outcome. A second Back while saving closed the sheet, so it
  // opens again on the result, unless another sheet is open by now.
  function finishSave() {
    if (!sheet.isOpen) {
      if (document.querySelector('dialog[open]')) {
        if (step !== 'done') announce(error);
        return;
      }
      sheet.open();
    }
    wasReady = canBook(state());
    render({ focus: step === 'done' || !dialog.contains(document.activeElement) ? 'h2' : null });
  }

  function saveNames(form) {
    const name = form.elements.name.value.trim();
    const reservedFor = form.elements.reservedFor.value.trim();
    Object.assign(draft, { name, reservedFor });
    if (!hasText(name)) return showFieldError('name', 'Enter your name.');
    if (!hasText(reservedFor)) return showFieldError('detail', `Enter the ${inSentence(detailLabel(config(), draft.purpose))}.`);
    const choice = currentChoice();
    if (choice) Object.assign(draft, { unit: choice.unit, takeover: choice.takeover, forced: choice.force });
    go('confirm');
  }

  function showFieldError(field, message) {
    error = message;
    errorField = field;
    render();
    dialog.querySelector(`[data-key="${field}"]`)?.focus();
  }

  dialog.addEventListener('input', event => {
    if (event.target.name === 'name') draft.name = event.target.value;
    if (event.target.name === 'reservedFor') draft.reservedFor = event.target.value;
  });

  dialog.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.dataset.form === 'names' && !saving) saveNames(event.target);
  });

  dialog.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action === 'close') sheet.close();
    else if (action === 'back') back();
    else if (action === 'retry') refresh();
    else if (action === 'reload') location.reload();
    else if (action === 'confirm') confirm();
    else if (action === 'force') {
      draft.force = true;
      render({ focus: 'h2' });
    } else if (action === 'force-step') {
      if (problem()) render();
      else go('force');
    } else if (action === 'show') {
      sheet.close();
      onShow({ date: draft.date, type: draft.type, id: saved.id });
    } else if (action === 'mine') {
      sheet.close();
      onOpenMine();
    } else if (action === 'again') {
      sheet.close();
      open({ date: draft.date });
    } else if (target.dataset.type) {
      draft.type = target.dataset.type;
      go('purpose');
    } else if (target.dataset.purpose) {
      draft.purpose = target.dataset.purpose;
      go(draft.fixed ? 'end' : 'start');
    } else if (target.dataset.start) {
      draft.start = Number(target.dataset.start);
      go('end');
    } else if (target.dataset.end) {
      draft.end = Number(target.dataset.end);
      const choice = currentChoice();
      if (!choice) {
        error = 'That end time is no longer open. Choose another.';
        render();
        return;
      }
      Object.assign(draft, { unit: choice.unit, takeover: choice.takeover, forced: choice.force });
      go('names');
    }
  });

  return { open, update };
}
