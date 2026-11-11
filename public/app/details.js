// The sheet that opens when someone taps a reservation on the schedule. The
// person who made it can also cancel it or end it early from here.

import { escapeHtml as esc, formatRange, formatDay, toMinutes } from '../shared/format.js';
import { earliestStart } from '../shared/availability.js';
import { cancel } from './store.js';
import { createSheet } from './sheet.js';
import { purposeLabel, detailLabel, placeLabel, reservationActions, HOLD } from './text.js';
import { summaryHtml, disabledAttr } from './parts.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';

export function createDetailsSheet({ getState, onEndEarly, onForce }) {
  const dialog = document.getElementById('details-sheet');
  let selected = null; // { id, type }
  let confirming = false;
  let busy = false;
  let error = '';
  // While cancelling, the selection outlives a forced close so the result can be shown.
  const sheet = createSheet(dialog, { onClose: () => { if (!busy) selected = null; } });

  const row = () => selected && getState().bookings.find(item => item.id === selected.id && item.type === selected.type);
  const ownReservation = () => selected && getState().mine.find(item => item.id === selected.id);

  function open(id, type) {
    if (busy) {
      // Still cancelling the last one: show it rather than another.
      if (row()) {
        sheet.open();
        render({ focus: 'h2' });
      }
      return;
    }
    selected = { id, type };
    confirming = false;
    error = '';
    sheet.open();
    render({ focus: 'h2' });
  }

  // On refresh: redraw, or close when the reservation is gone.
  function update() {
    if (!sheet.isOpen || busy) return;
    if (!row()) sheet.close();
    else render();
  }

  function render({ focus = null } = {}) {
    const booking = row();
    if (!booking) return;
    const { config } = getState();
    const hold = booking.purpose === HOLD;
    const items = [
      ['Day', formatDay(booking.date)],
      ['Time', formatRange(booking.start, booking.end)],
      ['Name', booking.name],
      ...(hold ? [] : [['For', purposeLabel(config, booking.purpose)]]),
      ...(booking.reservedFor ? [[detailLabel(config, booking.purpose), booking.reservedFor]] : [])
    ];
    sheet.render(`
      <div class="sheet-bar">
        <span class="sheet-step">${busy ? 'Saving…' : booking.mine ? 'Your reservation' : 'Reservation'}</span>
        <button type="button" class="icon-button" data-action="close" data-key="close" aria-label="Close"${busy ? ' disabled' : ''}>${ICONS.close}</button>
      </div>
      <h2 id="details-title" tabindex="-1">${esc(placeLabel(config, booking.type, booking.unit))}</h2>
      ${summaryHtml(items)}
      ${actionsHtml()}
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    `, { focus });
  }

  function actionsHtml() {
    const mine = ownReservation();
    if (!mine) return forceHtml();
    const { ended, earlyEnds, canCancel } = reservationActions(getState().config, mine);
    if (ended) return '<p class="hint">This reservation has finished.</p>';
    const disabled = disabledAttr(getState(), busy);
    if (confirming) {
      return `<p class="hint">Cancel this reservation? Its time opens for others right away.</p>
        <div class="actions">
          <button type="button" class="primary danger" data-action="cancel-confirm" data-key="cancel-confirm"${disabled} aria-busy="${busy}">${busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
          <button type="button" class="text-button" data-action="cancel-keep" data-key="cancel-keep"${busy ? ' disabled' : ''}>Keep it</button>
        </div>`;
    }
    return `<div class="actions">
      ${earlyEnds.length ? `<button type="button" class="secondary" data-action="end-early" data-key="end-early"${disabled}>End early</button>` : ''}
      ${canCancel ? `<button type="button" class="secondary danger" data-action="cancel" data-key="cancel"${disabled}>Cancel reservation</button>` : ''}
    </div>`;
  }

  // Someone else's reservation can be taken with a Force override, for when
  // the person no longer needs it and left it in place. Not once only its
  // last half hour is left: a time that has begun cannot be freed.
  function forceHtml() {
    const booking = row();
    const { config } = getState();
    if (booking.purpose === HOLD || earliestStart(config, booking.date) >= toMinutes(booking.end)) return '';
    const disabled = disabledAttr(getState(), busy);
    return `<div class="force-offer">
      <p class="hint">No longer needed? If you know this reservation is not needed any more, you can take its place.</p>
      <button type="button" class="secondary danger" data-action="force" data-key="force"${disabled}>Force override</button>
    </div>`;
  }

  async function confirmCancel() {
    busy = true;
    sheet.locked = true;
    error = '';
    render();
    let failure = null;
    try {
      await cancel(selected.id);
    } catch (problem) {
      failure = problem;
    }
    busy = false;
    sheet.locked = false;
    if (!failure) {
      sheet.close();
      selected = null;
      // Closed by a second Back meanwhile: the block that had focus is gone.
      if (document.activeElement === document.body) document.getElementById('reserve')?.focus({ preventScroll: true });
      announce('Reservation cancelled. Its time is open for others.');
      return;
    }
    // Gone from the schedule meanwhile (cancelled or replaced elsewhere):
    // nothing is left to show, so say what happened.
    if (!row()) {
      sheet.close();
      selected = null;
      announce(failure.message);
      return;
    }
    error = failure.message;
    // A second Back closed the sheet while cancelling: open it on the error.
    if (!sheet.isOpen && !document.querySelector('dialog[open]')) sheet.open();
    if (sheet.isOpen) render({ focus: dialog.contains(document.activeElement) ? null : 'h2' });
    else {
      selected = null;
      announce(failure.message);
    }
  }

  dialog.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'close') sheet.close();
    else if (action === 'end-early') {
      const id = selected.id;
      sheet.close();
      onEndEarly(id);
    } else if (action === 'force') {
      const booking = row();
      sheet.close();
      onForce(booking);
    } else if (action === 'cancel') {
      confirming = true;
      render({ focus: '[data-action="cancel-confirm"]' });
    } else if (action === 'cancel-keep') {
      confirming = false;
      render({ focus: '[data-action="cancel"]' });
    } else if (action === 'cancel-confirm') confirmCancel();
  });

  return { open, update };
}
