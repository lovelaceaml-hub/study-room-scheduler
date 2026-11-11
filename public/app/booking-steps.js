// What each step of the booking sheet shows. booking.js keeps the draft and
// decides which step is on screen; this file only turns them into markup.

import { escapeHtml as esc, formatTime, formatRange, formatDuration, formatDay, inSentence } from '../shared/format.js';
import { startChoices, endChoices, earliestStart, takeoverEffect } from '../shared/availability.js';
import { purposeLabel, detailLabel, placeLabel, unitLabel } from './text.js';
import { summaryHtml, disabledAttr } from './parts.js';
import { ICONS } from './icons.js';

const TAKEOVER_LABEL = 'Priority override';
const FORCE_LABEL = 'Force override';
export const PASSED = 'This start time has passed. Close this and choose a later time.';
// These steps show the error just above their main button.
export const INLINE_ERROR_STEPS = ['names', 'confirm', 'force'];

// `ctx` is the sheet as booking.js holds it: `draft`, `saving`, `saved` and
// `errorField` as they are now, and state(), config(), day(), rows(),
// currentError() and startPassed().
export function createSteps(ctx) {
  const { state, config, day, rows } = ctx;

  const errorLine = () => {
    const message = ctx.currentError();
    return message ? `<p class="form-error" id="booking-error" role="alert">${esc(message)}</p>` : '';
  };
  const invalid = field => ctx.errorField === field ? ' aria-invalid="true" aria-describedby="booking-error"' : '';
  const heading = (text, hint = '') => `<h2 id="booking-title" tabindex="-1">${text}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}`;
  const disabled = () => disabledAttr(state(), ctx.saving);

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
      const choices = day() ? startChoices(config(), rows(), day(), ctx.draft.type, ctx.draft.purpose, null, earliestStart(config(), ctx.draft.date), ctx.draft.force) : [];
      if (!choices.length) {
        return heading('Start time', ctx.draft.force
          ? 'No times on this day, even with Force override. Close this and choose another day, or go back and choose something else.'
          : 'No open times on this day. Close this and choose another day, or go back and choose something else.') + forceOffer();
      }
      return heading('Start time', ctx.draft.force ? 'Times marked Force override are held by someone else.' : 'Only open times are shown.')
        + `<div class="times">${choices.map(choice => timeButton('start', choice.start, choice)).join('')}</div>` + forceOffer();
    },

    end: () => {
      if (ctx.startPassed()) return heading('End time', PASSED);
      const choices = day() ? endChoices(config(), rows(), day(), ctx.draft.type, ctx.draft.start, ctx.draft.purpose, ctx.draft.fixed ? ctx.draft.unit : null, ctx.draft.force) : [];
      if (!choices.length) {
        return heading('End time', ctx.draft.fixed
          ? 'This time is no longer open. Close this and choose another time.'
          : 'This start time is no longer open. Go back and choose another.') + forceOffer();
      }
      return heading('End time', `Starting at ${formatTime(ctx.draft.start)}.${ctx.draft.force ? ' Times marked Force override are held by someone else.' : ''}`)
        + `<div class="times">${choices.map(choice => timeButton('end', choice.end, choice, formatDuration(choice.end - ctx.draft.start))).join('')}</div>` + forceOffer();
    },

    names: () => {
      const label = detailLabel(config(), ctx.draft.purpose);
      const max = config().purposes[ctx.draft.purpose].detailMax;
      const long = max > 120;
      return heading('Your details', `Others see a short form of your name (like “B John”) and the ${inSentence(label)} on the schedule.`) + `
        <form class="form" data-form="names" novalidate>
          <label for="booking-name">Your name</label>
          <input id="booking-name" name="name" data-key="name" maxlength="${config().nameMax ?? 120}" autocomplete="name" value="${esc(ctx.draft.name)}" required${invalid('name')}>
          <label for="booking-detail">${esc(label)}</label>
          ${long
            ? `<textarea id="booking-detail" name="reservedFor" data-key="detail" maxlength="${max}" rows="3" required${invalid('detail')}>${esc(ctx.draft.reservedFor)}</textarea>`
            : `<input id="booking-detail" name="reservedFor" data-key="detail" maxlength="${max}" autocomplete="off" value="${esc(ctx.draft.reservedFor)}" required${invalid('detail')}>`}
          ${errorLine()}
          <button type="submit" class="primary" data-key="continue"${disabled()}>Continue</button>
        </form>`;
    },

    confirm: () => heading('Confirm reservation') + summary(ctx.draft.unit) + (ctx.draft.forced ? forceNote() : ctx.draft.takeover ? takeoverNote() : '')
      + (state().demo ? '<p class="hint">Demo mode: this practice reservation disappears when you close the page.</p>' : '') + errorLine()
      + (ctx.draft.forced
        ? `<button type="button" class="primary danger" data-action="force-step" data-key="force-step"${disabled()}>${FORCE_LABEL}</button>`
        : `<button type="button" class="primary" data-action="confirm" data-key="confirm"${disabled()} aria-busy="${ctx.saving}">${ctx.saving ? '<span class="spinner" aria-hidden="true"></span>Reserving…' : 'Confirm reservation'}</button>`),

    // The warning a Force override must get past. It names who loses what.
    force: () => heading('Are you sure?', 'This replaces another person’s reservation. Only do this if you know they no longer need it.')
      + forceNote() + errorLine() + `
      <div class="actions">
        <button type="button" class="primary danger" data-action="confirm" data-key="confirm"${disabled()} aria-busy="${ctx.saving}">${ctx.saving ? '<span class="spinner" aria-hidden="true"></span>Reserving…' : 'Yes, override and reserve'}</button>
        <button type="button" class="text-button" data-action="back" data-key="force-back"${ctx.saving ? ' disabled' : ''}>No, go back</button>
      </div>`,

    done: () => `<div class="done-mark" aria-hidden="true">${ICONS.check}</div>` + heading('Reservation confirmed', 'To cancel or end early, open My reservations.') + summary(ctx.saved.unit) + `
      <button type="button" class="primary" data-action="show" data-key="show">See it on the schedule</button>
      <button type="button" class="text-button" data-action="mine" data-key="mine">My reservations</button>
      <button type="button" class="text-button" data-action="again" data-key="again">Reserve something else</button>`
  };

  // Who the takeover affects and what happens to each, as the server will do it.
  function effectLines() {
    const kind = inSentence(config().resources[ctx.draft.type].label);
    const preview = day() ? takeoverEffect(config(), rows(), day(), ctx.draft.type, ctx.draft.start, ctx.draft.end, ctx.draft.purpose, ctx.draft.unit, undefined, ctx.draft.force) : null;
    const affected = preview?.affected || [];
    const lines = affected.map(({ row, effect, toEnd }) => {
      const whose = row.mine ? 'Your reservation there' : `${row.name}’s reservation there`;
      if (effect === 'shortened') return `${whose} (${formatRange(row.start, row.end)}) will end at ${formatTime(toEnd)}.`;
      if (effect === 'moved') return `${whose} will move to another ${kind}.`;
      if (effect === 'released') return `${whose} will lose this ${kind}, because no other ${kind} is free.`;
      return `${whose} will be replaced, because no other ${kind} is free.`;
    });
    if (affected.some(item => !item.row.mine)) lines.push('They see why in My reservations.');
    return lines;
  }

  function takeoverNote() {
    const kind = inSentence(config().resources[ctx.draft.type].label);
    const place = unitLabel(config(), ctx.draft.unit) || `a ${kind}`;
    return `<div class="takeover-note" role="note">
      <p><strong>${TAKEOVER_LABEL}.</strong> Every ${esc(kind)} is taken at this time, so you get ${esc(place)}.</p>
      ${effectLines().map(line => `<p>${esc(line)}</p>`).join('')}
    </div>`;
  }

  function forceNote() {
    const place = unitLabel(config(), ctx.draft.unit) || `This ${inSentence(config().resources[ctx.draft.type].label)}`;
    return `<div class="takeover-note force-note" role="alert">
      <p><strong>${FORCE_LABEL}.</strong> ${esc(place)} is held by someone else at this time.</p>
      ${effectLines().map(line => `<p>${esc(line)}</p>`).join('')}
    </div>`;
  }

  // The button that turns Force override on for the time lists.
  function forceOffer() {
    if (ctx.draft.force) return '';
    return `<div class="force-offer">
      <p class="hint">Is the time you need taken? If you know that reservation is no longer needed, you can take its place.</p>
      <button type="button" class="secondary danger" data-action="force" data-key="force"${disabled()}>${FORCE_LABEL}</button>
    </div>`;
  }

  function timeButton(kind, minutes, { takeover, force }, detail = '') {
    const mark = force ? FORCE_LABEL : takeover ? TAKEOVER_LABEL : '';
    const label = `${formatTime(minutes)}${detail ? `, ${detail}` : ''}${mark ? `, ${mark}` : ''}`;
    return `<button type="button" class="time${force ? ' force' : takeover ? ' takeover' : ''}" data-${kind}="${minutes}" data-key="${kind}-${minutes}" aria-label="${esc(label)}"${disabled()}>
      ${formatTime(minutes)}${detail ? ` <small>${esc(detail)}</small>` : ''}${mark ? ` <small class="takeover-label">${mark}</small>` : ''}
    </button>`;
  }

  function summary(unit) {
    return summaryHtml([
      ['Day', formatDay(ctx.draft.date)],
      ['Time', formatRange(ctx.draft.start, ctx.draft.end)],
      ['Where', placeLabel(config(), ctx.draft.type, unit)],
      ['For', purposeLabel(config(), ctx.draft.purpose)],
      ['Your name', ctx.draft.name],
      [detailLabel(config(), ctx.draft.purpose), ctx.draft.reservedFor]
    ]);
  }

  return { html: step => STEPS[step](), errorLine };
}
