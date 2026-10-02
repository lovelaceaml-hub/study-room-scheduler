// The booking sheet. From the Reserve button the day and kind on screen are
// already chosen, so the steps are: what for, start, end, names, confirm
// (with "Reserve something else", what comes first). From a tapped open time
// the unit and start are chosen too, so it skips to what for, end, names,
// confirm.

import {
  escapeHtml as esc, formatTime, formatRange, formatDuration, formatDay, hasText, inSentence, readStored, toTime
} from '../shared/format.js';
import { rangeChoice, startChoices, endChoices, earliestStart, takeoverEffect } from '../shared/availability.js';
import { book, canBook, refresh, newRequestId, NAME_KEY } from './store.js';
import { createSheet } from './sheet.js';
import { purposeLabel, detailLabel, placeLabel, unitLabel, connectionText } from './text.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';

const TAKEOVER_LABEL = 'Priority override';
const NOT_OPEN = 'This time is no longer open. Go back and choose another time.';
const PASSED = 'This start time has passed. Close this and choose a later time.';
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
  // The id sent with this draft, kept while the draft stays the same so a
  // retry is recognised by the server.
  let request = null; // { key, id }
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
  const steps = () => draft.fixed ? ['purpose', 'end', 'names', 'confirm']
    : draft.typeGiven ? ['purpose', 'start', 'end', 'names', 'confirm']
    : ['type', 'purpose', 'start', 'end', 'names', 'confirm'];

  // `preset`: { date, type } from the Reserve button, { date } from "Reserve
  // something else", or { date, type, unit, start } from a tapped time.
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
    if (step === 'start') Object.assign(draft, { start: null, end: null, takeover: false });
    if (step === 'end') Object.assign(draft, { end: null, takeover: false });
    if (!draft.fixed && (step === 'start' || step === 'end')) draft.unit = null;
    render({ focus: 'h2' });
  }

  // A time that has begun cannot be reserved.
  function startPassed() {
    return draft.start != null && draft.start < earliestStart(config(), draft.date);
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
    if (['start', 'end', 'confirm'].includes(step) || readyChanged || !day()) render();
  }

  // Keeps the confirmation in line with the schedule: the unit the server
  // would give now, and a warning when a takeover appeared, went away or
  // moved to another unit. Returns false when the member must look again.
  function followSchedule() {
    const choice = currentChoice();
    if (!choice) return true;
    if (choice.takeover !== draft.takeover || (choice.takeover && choice.unit !== draft.unit)) {
      Object.assign(draft, { unit: choice.unit, takeover: choice.takeover });
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
      <section class="step">${STEPS[step]()}</section>
      ${INLINE_ERROR_STEPS.includes(step) ? '' : errorLine()}
    `, { focus });
  }

  function bannerHtml() {
    if (canBook(state())) return '';
    const problem = connectionText(state().status);
    if (problem?.action === 'reload') {
      return `<div class="sheet-status" role="status"><span>${esc(problem.text)}</span> <button type="button" class="text-button" data-action="reload" data-key="reload">Reload</button></div>`;
    }
    return '<div class="sheet-status" role="status"><span>The schedule is reconnecting. Your choices are kept.</span> <button type="button" class="text-button" data-action="retry" data-key="retry">Try again</button></div>';
  }

  // The message under the current step: a start that has passed or a time
  // that is no longer open outranks the last error.
  function currentError() {
    if (saving || !['names', 'confirm'].includes(step)) return error;
    if (startPassed()) return PASSED;
    if (step === 'confirm' && day() && !currentChoice()) return NOT_OPEN;
    return error;
  }

  // These steps show the error just above their main button.
  const INLINE_ERROR_STEPS = ['names', 'confirm'];
  const errorLine = () => {
    const message = currentError();
    return message ? `<p class="form-error" id="booking-error" role="alert">${esc(message)}</p>` : '';
  };
  const invalid = field => errorField === field ? ' aria-invalid="true" aria-describedby="booking-error"' : '';
  const heading = (text, hint = '') => `<h2 id="booking-title" tabindex="-1">${text}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}`;
  const disabled = () => canBook(state()) && !saving ? '' : ' disabled';

  const STEPS = {
    type: () => heading('What do you need?') + `<div class="choices">${Object.entries(config().resources).map(([type, resource]) => `
      <button type="button" class="choice" data-type="${type}" data-key="type-${type}"${disabled()}>
        <span class="choice-icon">${ICONS[type] || ''}</span><b>${esc(resource.label)}</b><span class="choice-arrow" aria-hidden="true">›</span>
      </button>`).join('')}</div>`,

    purpose: () => heading('What is it for?', 'Contact and New Member reservations have priority.') + `<div class="choices">${Object.entries(config().purposes).map(([id, purpose]) => `
      <button type="button" class="choice" data-purpose="${id}" data-key="purpose-${id}"${disabled()}>
        <span class="dot purpose-${id}" aria-hidden="true"></span><b>${esc(purpose.label)}</b><span class="choice-arrow" aria-hidden="true">›</span>
      </button>`).join('')}</div>`,

    start: () => {
      const choices = day() ? startChoices(config(), rows(), day(), draft.type, draft.purpose, null, earliestStart(config(), draft.date)) : [];
      if (!choices.length) return heading('Start time', 'No open times on this day. Close this and choose another day, or go back and choose something else.');
      return heading('Start time', 'Only open times are shown.') + `<div class="times">${choices.map(choice => timeButton('start', choice.start, choice.takeover)).join('')}</div>`;
    },

    end: () => {
      if (startPassed()) return heading('End time', PASSED);
      const choices = day() ? endChoices(config(), rows(), day(), draft.type, draft.start, draft.purpose, draft.fixed ? draft.unit : null) : [];
      if (!choices.length) {
        return heading('End time', draft.fixed
          ? 'This time is no longer open. Close this and choose another time.'
          : 'This start time is no longer open. Go back and choose another.');
      }
      return heading('End time', `Starting at ${formatTime(draft.start)}.`)
        + `<div class="times">${choices.map(choice => timeButton('end', choice.end, choice.takeover, formatDuration(choice.end - draft.start))).join('')}</div>`;
    },

    names: () => {
      const label = detailLabel(config(), draft.purpose);
      const max = config().purposes[draft.purpose].detailMax;
      const long = max > 120;
      return heading('Your details', `Others see a short form of your name (like “B John”) and the ${inSentence(label)} on the schedule.`) + `
        <form class="form" data-form="names" novalidate>
          <label for="booking-name">Your name</label>
          <input id="booking-name" name="name" data-key="name" maxlength="${config().nameMax ?? 120}" autocomplete="name" value="${esc(draft.name)}" required${invalid('name')}>
          <label for="booking-detail">${esc(label)}</label>
          ${long
            ? `<textarea id="booking-detail" name="reservedFor" data-key="detail" maxlength="${max}" rows="3" required${invalid('detail')}>${esc(draft.reservedFor)}</textarea>`
            : `<input id="booking-detail" name="reservedFor" data-key="detail" maxlength="${max}" autocomplete="off" value="${esc(draft.reservedFor)}" required${invalid('detail')}>`}
          ${errorLine()}
          <button type="submit" class="primary" data-key="continue"${disabled()}>Continue</button>
        </form>`;
    },

    confirm: () => heading('Confirm reservation') + summary(draft.unit) + (draft.takeover ? takeoverNote() : '')
      + (state().demo ? '<p class="hint">Demo mode: this practice reservation disappears when you close the page.</p>' : '') + errorLine() + `
      <button type="button" class="primary" data-action="confirm" data-key="confirm"${disabled()} aria-busy="${saving}">${saving ? '<span class="spinner" aria-hidden="true"></span>Reserving…' : 'Confirm reservation'}</button>`,

    done: () => `<div class="done-mark" aria-hidden="true">${ICONS.check}</div>` + heading('Reservation confirmed', 'To cancel or end early, open My reservations.') + summary(saved.unit) + `
      <button type="button" class="primary" data-action="show" data-key="show">See it on the schedule</button>
      <button type="button" class="text-button" data-action="mine" data-key="mine">My reservations</button>
      <button type="button" class="text-button" data-action="again" data-key="again">Reserve something else</button>`
  };

  // Who the takeover affects and what happens to each, as the server will do it.
  function takeoverNote() {
    const kind = inSentence(config().resources[draft.type].label);
    const place = unitLabel(config(), draft.unit) || `a ${kind}`;
    const preview = day() ? takeoverEffect(config(), rows(), day(), draft.type, draft.start, draft.end, draft.purpose, draft.unit) : null;
    const affected = preview?.affected || [];
    const lines = affected.map(({ row, effect, toEnd }) => {
      const whose = row.mine ? 'Your reservation there' : `${row.name}’s reservation there`;
      if (effect === 'shortened') return `${whose} (${formatRange(row.start, row.end)}) will end at ${formatTime(toEnd)}.`;
      if (effect === 'moved') return `${whose} will move to another ${kind}.`;
      if (effect === 'released') return `${whose} will lose this ${kind}, because no other ${kind} is free.`;
      return `${whose} will be replaced, because no other ${kind} is free.`;
    });
    if (affected.some(item => !item.row.mine)) lines.push('They see why in My reservations.');
    return `<div class="takeover-note" role="note">
      <p><strong>${TAKEOVER_LABEL}.</strong> Every ${esc(kind)} is taken at this time, so you get ${esc(place)}.</p>
      ${lines.map(line => `<p>${esc(line)}</p>`).join('')}
    </div>`;
  }

  function timeButton(kind, minutes, takeover, detail = '') {
    const label = `${formatTime(minutes)}${detail ? `, ${detail}` : ''}${takeover ? `, ${TAKEOVER_LABEL}` : ''}`;
    return `<button type="button" class="time${takeover ? ' takeover' : ''}" data-${kind}="${minutes}" data-key="${kind}-${minutes}" aria-label="${esc(label)}"${disabled()}>
      ${formatTime(minutes)}${detail ? `<small>${esc(detail)}</small>` : ''}${takeover ? `<small class="takeover-label">${TAKEOVER_LABEL}</small>` : ''}
    </button>`;
  }

  function summary(unit) {
    const items = [
      ['Day', formatDay(draft.date)],
      ['Time', formatRange(draft.start, draft.end)],
      ['Where', placeLabel(config(), draft.type, unit)],
      ['For', purposeLabel(config(), draft.purpose)],
      ['Your name', draft.name],
      [detailLabel(config(), draft.purpose), draft.reservedFor]
    ];
    return `<dl class="summary">${items.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  // ---------- Actions ----------

  // The best unit for the whole range right now, honoring a tapped unit.
  function currentChoice(end = draft.end) {
    if (!day()) return null;
    return rangeChoice(config(), rows(), day(), draft.type, draft.start, end, draft.purpose, draft.fixed ? draft.unit : null);
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
      takeoverUnit: draft.takeover ? draft.unit : null
    };
    // The same reservation keeps its request id through every retry, even when
    // the unit or takeover changes (a lost answer may have taken the free
    // unit itself), so the server answers a retry with the first result
    // instead of booking twice. Reusing an id is always safe: the server
    // either made that reservation or made nothing.
    const { takeover, takeoverUnit, ...what } = sending;
    const key = JSON.stringify(what);
    if (request?.key !== key) request = { key, id: newRequestId() };
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
    if (choice) Object.assign(draft, { unit: choice.unit, takeover: choice.takeover });
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
    else if (action === 'show') {
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
      Object.assign(draft, { unit: choice.unit, takeover: choice.takeover });
      go('names');
    }
  });

  return { open, update };
}
