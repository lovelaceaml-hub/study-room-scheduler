// The booking sheet. From the Reserve button the steps are: what, what for,
// start, end, names, confirm. From a tapped open time the unit and start are
// already chosen, so it skips to what for, end, names, confirm.

import {
  escapeHtml as esc, formatTime, formatRange, formatDuration, formatDay, hasText, readStored, toTime
} from '../shared/format.js';
import { rangeChoice, startChoices, endChoices, unitName } from '../shared/availability.js';
import { book, canBook, refresh, NAME_KEY } from './store.js';
import { createSheet } from './sheet.js';
import { purposeLabel, detailLabel, placeLabel } from './text.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';

const TAKEOVER_LABEL = 'Priority override';

export function createBookingSheet({ getState, onShow, onOpenMine }) {
  const dialog = document.getElementById('booking-sheet');
  const sheet = createSheet(dialog);
  let draft = null;
  let step = '';
  let past = [];
  let saving = false;
  let error = '';
  let saved = null;

  const state = () => getState();
  const config = () => state().config;
  const day = () => state().days.find(item => item.date === draft.date) || null;
  const rows = () => state().bookings.filter(row => row.type === draft.type);
  const steps = () => draft.fixed ? ['purpose', 'end', 'names', 'confirm'] : ['type', 'purpose', 'start', 'end', 'names', 'confirm'];

  // `preset`: { date } from the Reserve button, or { date, type, unit, start } from a tapped time.
  function open(preset = {}) {
    const current = state();
    if (!canBook(current) || !current.days.length) return;
    const fixed = Boolean(preset.unit);
    draft = {
      date: preset.date || current.days[0].date,
      type: preset.type || null,
      unit: preset.unit || null,
      fixed,
      start: preset.start ?? null,
      end: null,
      purpose: null,
      takeover: false,
      name: readStored(NAME_KEY) || '',
      reservedFor: ''
    };
    past = [];
    error = '';
    saved = null;
    step = fixed ? 'purpose' : 'type';
    sheet.open();
    render({ focus: 'h2' });
  }

  function go(next) {
    past.push(step);
    step = next;
    error = '';
    render({ focus: 'h2' });
  }

  function back() {
    if (!past.length || saving) return;
    step = past.pop();
    error = '';
    if (step === 'start') Object.assign(draft, { start: null, end: null, takeover: false });
    if (step === 'end') Object.assign(draft, { end: null, takeover: false });
    if (!draft.fixed && (step === 'start' || step === 'end')) draft.unit = null;
    render({ focus: 'h2' });
  }

  // Called on every schedule refresh. Only the steps that list open times,
  // and the confirmation, depend on it.
  function update() {
    if (!sheet.isOpen || saving) return;
    if (!day()) {
      error = 'This day is no longer open for reservations. Close this and choose another day.';
    }
    if (['start', 'end', 'confirm'].includes(step) || !canBook(state()) || error) render();
  }

  // ---------- Markup ----------

  function render({ focus = null } = {}) {
    const index = steps().indexOf(step);
    const title = step === 'done' ? 'Done' : `Step ${index + 1} of ${steps().length}`;
    const chips = step === 'done' ? [] : [
      formatDay(draft.date),
      draft.type ? (draft.fixed ? unitName(config(), draft.unit) : config().resources[draft.type].label) : '',
      draft.start != null ? formatTime(draft.start) : ''
    ].filter(Boolean);
    sheet.render(`
      <div class="sheet-bar">
        <button type="button" class="icon-button" data-action="back" aria-label="Back"${past.length && step !== 'done' ? '' : ' hidden'}>${ICONS.back}</button>
        <span class="sheet-step">${title}</span>
        <button type="button" class="icon-button" data-action="close" aria-label="Close">${ICONS.close}</button>
      </div>
      ${chips.length ? `<p class="chips">${chips.map(chip => `<span>${esc(chip)}</span>`).join('')}</p>` : ''}
      ${!canBook(state()) && step !== 'done' ? '<div class="sheet-status" role="status">The schedule is reconnecting. Your choices are kept. <button type="button" class="text-button" data-action="retry">Try again</button></div>' : ''}
      <section class="step">${STEPS[step]()}</section>
      ${INLINE_ERROR_STEPS.includes(step) ? '' : errorLine()}
    `, { focus, scrollTop: Boolean(focus) });
  }

  // These steps show the error just above their main button.
  const INLINE_ERROR_STEPS = ['names', 'confirm'];
  const errorLine = () => error ? `<p class="form-error" role="alert">${esc(error)}</p>` : '';
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
      const choices = day() ? startChoices(config(), rows(), day(), draft.type, draft.purpose) : [];
      if (!choices.length) return heading('Start time', 'No open times on this day. Close this and choose another day, or go back and choose something else.');
      return heading('Start time', 'Only open times are shown.') + `<div class="times">${choices.map(choice => timeButton('start', choice.start, choice.takeover)).join('')}</div>`;
    },

    end: () => {
      const choices = day() ? endChoices(config(), rows(), day(), draft.type, draft.start, draft.purpose, draft.fixed ? draft.unit : null) : [];
      if (!choices.length) return heading('End time', 'This start time is no longer open. Go back and choose another.');
      return heading('End time', `Starting at ${formatTime(draft.start)}.`)
        + `<div class="times">${choices.map(choice => timeButton('end', choice.end, choice.takeover, formatDuration(choice.end - draft.start))).join('')}</div>`;
    },

    names: () => {
      const label = detailLabel(config(), draft.purpose);
      const max = config().purposes[draft.purpose].detailMax;
      const long = max > 120;
      return heading(draft.purpose === 'other' ? 'What is it for?' : 'Who is it for?', `Others can see your first name and the ${label.toLowerCase()} on the schedule.`) + `
        <form class="form" data-form="names" novalidate>
          <label for="booking-name">Your name</label>
          <input id="booking-name" name="name" data-key="name" maxlength="120" autocomplete="name" value="${esc(draft.name)}" required>
          <label for="booking-detail">${esc(label)}</label>
          ${long
            ? `<textarea id="booking-detail" name="reservedFor" data-key="detail" maxlength="${max}" rows="3" required>${esc(draft.reservedFor)}</textarea>`
            : `<input id="booking-detail" name="reservedFor" data-key="detail" maxlength="${max}" autocomplete="off" value="${esc(draft.reservedFor)}" required>`}
          ${errorLine()}
          <button type="submit" class="primary"${disabled()}>Continue</button>
        </form>`;
    },

    confirm: () => heading('Confirm reservation') + summary(draft.unit) + (draft.takeover
      ? '<p class="takeover-note" role="note"><strong>Priority override.</strong> This time is held by a lower-priority reservation. That person is moved to another unit if one is free; otherwise their reservation is released.</p>'
      : '') + (state().demo ? '<p class="hint">Demo mode: this practice reservation disappears when you close the page.</p>' : '') + errorLine() + `
      <button type="button" class="primary" data-action="confirm"${disabled()} aria-busy="${saving}">${saving ? 'Reserving…' : 'Confirm reservation'}</button>`,

    done: () => `<div class="done-mark" aria-hidden="true">${ICONS.check}</div>` + heading('Reservation confirmed', 'To cancel or end early, open My reservations.') + summary(saved.unit) + `
      <button type="button" class="primary" data-action="show">See it on the schedule</button>
      <button type="button" class="text-button" data-action="mine">My reservations</button>
      <button type="button" class="text-button" data-action="again">Reserve something else</button>`
  };

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

  async function confirm() {
    const choice = currentChoice();
    if (!choice) {
      error = 'This time is no longer open. Go back and choose another time.';
      render();
      return;
    }
    if (choice.takeover !== draft.takeover) {
      Object.assign(draft, { unit: choice.unit, takeover: choice.takeover });
      error = 'The schedule changed while you were deciding. Check the details and confirm again.';
      render();
      return;
    }
    saving = true;
    sheet.locked = true;
    error = '';
    render();
    try {
      const result = await book({
        date: draft.date,
        type: draft.type,
        unit: draft.fixed ? draft.unit : null,
        start: toTime(draft.start),
        end: toTime(draft.end),
        purpose: draft.purpose,
        name: draft.name,
        reservedFor: draft.reservedFor,
        takeover: choice.takeover
      });
      saved = { id: result.id, unit: result.unit };
      past = [];
      step = 'done';
      announce('Reservation confirmed.');
    } catch (failure) {
      error = failure.message;
    } finally {
      saving = false;
      sheet.locked = false;
      render({ focus: step === 'done' ? 'h2' : null });
    }
  }

  function saveNames(form) {
    const name = form.elements.name.value.trim();
    const reservedFor = form.elements.reservedFor.value.trim();
    Object.assign(draft, { name, reservedFor });
    if (!hasText(name)) return showFieldError(form.elements.name, 'Enter your name.');
    if (!hasText(reservedFor)) return showFieldError(form.elements.reservedFor, `Enter the ${detailLabel(config(), draft.purpose).toLowerCase()}.`);
    const choice = currentChoice();
    if (choice) Object.assign(draft, { unit: choice.unit, takeover: choice.takeover });
    go('confirm');
  }

  function showFieldError(field, message) {
    error = message;
    render();
    dialog.querySelector(`#${field.id}`)?.focus();
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
