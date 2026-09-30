// The sheet that opens when someone taps a reservation on the schedule. The
// person who made it can also cancel it or end it early from here.

import { escapeHtml as esc, formatRange, formatDay } from '../shared/format.js';
import { unitName } from '../shared/availability.js';
import { cancel, canBook } from './store.js';
import { createSheet } from './sheet.js';
import { purposeLabel, detailLabel, HOLD } from './text.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';

export function createDetailsSheet({ getState, onEndEarly }) {
  const dialog = document.getElementById('details-sheet');
  const sheet = createSheet(dialog, { onClose: () => { selected = null; } });
  let selected = null; // { id, type }
  let confirming = false;
  let busy = false;
  let error = '';

  const row = () => selected && getState().bookings.find(item => item.id === selected.id && item.type === selected.type);
  const ownReservation = () => selected && getState().mine.find(item => item.id === selected.id);

  function open(id, type) {
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
        <span class="sheet-step">${booking.mine ? 'Your reservation' : 'Reservation'}</span>
        <button type="button" class="icon-button" data-action="close" data-key="close" aria-label="Close">${ICONS.close}</button>
      </div>
      <h2 id="details-title" tabindex="-1">${esc(unitName(config, booking.unit))}</h2>
      <dl class="summary">${items.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      ${actionsHtml()}
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    `, { focus });
  }

  function actionsHtml() {
    const mine = ownReservation();
    if (!mine) return '';
    const disabled = canBook(getState()) && !busy ? '' : ' disabled';
    if (confirming) {
      return `<p class="hint">Cancel this reservation? Its time opens for others right away.</p>
        <div class="actions">
          <button type="button" class="primary danger" data-action="cancel-confirm" data-key="cancel-confirm"${disabled} aria-busy="${busy}">${busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
          <button type="button" class="text-button" data-action="cancel-keep" data-key="cancel-keep">Keep it</button>
        </div>`;
    }
    return `<div class="actions">
      ${mine.canEndEarly ? `<button type="button" class="secondary" data-action="end-early" data-key="end-early"${disabled}>End early</button>` : ''}
      ${mine.canCancel ? `<button type="button" class="secondary danger" data-action="cancel" data-key="cancel"${disabled}>Cancel reservation</button>` : ''}
    </div>`;
  }

  async function confirmCancel() {
    busy = true;
    sheet.locked = true;
    error = '';
    render();
    try {
      await cancel(selected.id);
      busy = false;
      sheet.locked = false;
      sheet.close();
      announce('Reservation cancelled. Its time is open for others.');
    } catch (failure) {
      busy = false;
      sheet.locked = false;
      error = failure.message;
      render();
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
