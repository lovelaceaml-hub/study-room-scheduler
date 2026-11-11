// My reservations: everything booked from this device on the open days,
// with Cancel and End early. The address gets ?view=mine while it is open,
// so the link can be shared and the browser's Back button closes it.

import { escapeHtml as esc, formatTime, formatRange, formatDay, formatDuration, nowIn, toMinutes } from '../shared/format.js';
import { cancel, endEarly, refresh } from './store.js';
import { createSheet } from './sheet.js';
import { statusLabel, purposeLabel, placeLabel, noticeText, reservationActions } from './text.js';
import { summaryHtml as summaryList, disabledAttr, connectionBanner } from './parts.js';
import { ICONS } from './icons.js';
import { announce } from './announce.js';

export function createMineSheet({ getState, onReserve }) {
  const dialog = document.getElementById('mine-sheet');
  const sheet = createSheet(dialog, {
    onEscape: () => (screen.view === 'list' ? close() : back()),
    onClose: clearAddress,
    fallbackFocus: '#mine-link'
  });
  let screen = { view: 'list' }; // list | cancel (id) | end (id) | end-confirm (id, end)
  let busy = false;
  let error = '';

  const config = () => getState().config;
  const find = id => getState().mine.find(item => item.id === id) || null;
  const actionsOf = item => reservationActions(config(), item);

  function open({ view = 'list', id = null, push = true } = {}) {
    if (!busy) {
      screen = { view, id };
      error = '';
    }
    if (push && new URLSearchParams(location.search).get('view') !== 'mine') {
      const params = new URLSearchParams(location.search);
      params.set('view', 'mine');
      history.pushState({ mine: true }, '', `?${params}`);
    }
    sheet.open();
    if (!busy) checkScreen();
    render({ focus: 'h2' });
  }

  function close() {
    sheet.close();
  }

  function clearAddress() {
    if (!busy) screen = { view: 'list' };
    const params = new URLSearchParams(location.search);
    if (params.get('view') !== 'mine') return;
    if (history.state?.mine) history.back();
    else {
      params.delete('view');
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
    }
  }

  function back() {
    if (busy) return;
    error = '';
    const from = screen;
    screen = from.view === 'end-confirm' ? { view: 'end', id: from.id } : { view: 'list' };
    render({ focus: screen.view === 'list' ? `[data-key="${from.view === 'cancel' ? 'cancel' : 'end'}-${CSS.escape(from.id)}"]` : 'h2' });
  }

  // The reservation on screen is gone (cancelled on another device, say).
  function showList() {
    error = '';
    screen = { view: 'list' };
    render({ focus: 'h2' });
  }

  // A Cancel or End early screen only stays while that action is still
  // possible: a reservation that was cancelled, replaced or has finished
  // meanwhile goes back to the list.
  function checkScreen() {
    if (screen.view === 'list' || !config()) return;
    const item = find(screen.id);
    const actions = item && actionsOf(item);
    if (!actions?.active || actions.ended) screen = { view: 'list' };
    else if (screen.view === 'cancel' && !actions.canCancel) screen = { view: 'list' };
    else if (screen.view === 'end' && !actions.earlyEnds.length) screen = { view: 'list' };
    else if (screen.view === 'end-confirm' && !actions.earlyEnds.includes(screen.end)) {
      screen = actions.earlyEnds.length ? { view: 'end', id: screen.id } : { view: 'list' };
    }
  }

  function update() {
    if (!sheet.isOpen || busy) return;
    checkScreen();
    render();
  }

  // ---------- Markup ----------

  function render({ focus = null } = {}) {
    const reservation = find(screen.id);
    const body = !getState().config ? loadingHtml()
      : screen.view === 'cancel' ? cancelHtml(reservation)
      : screen.view === 'end' ? endHtml(reservation)
      : screen.view === 'end-confirm' ? endConfirmHtml(reservation, screen.end)
      : listHtml();
    sheet.render(`
      <div class="sheet-bar">
        <button type="button" class="icon-button" data-action="back" data-key="back" aria-label="Back"${screen.view === 'list' || busy ? ' hidden' : ''}>${ICONS.back}</button>
        <span class="sheet-step">${busy ? 'Saving…' : 'My reservations'}</span>
        <button type="button" class="icon-button" data-action="close" data-key="close" aria-label="Close"${busy ? ' disabled' : ''}>${ICONS.close}</button>
      </div>
      ${connectionHtml()}
      <section class="step">${body}</section>
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    `, { focus });
  }

  const heading = (text, hint = '') => `<h2 id="mine-title" tabindex="-1">${text}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}`;
  const disabled = () => disabledAttr(getState(), busy);

  function connectionHtml() {
    const { status } = getState();
    if (status === 'connecting') return '';
    const text = status === 'offline' ? 'You’re offline.' : 'The schedule is not connected.';
    return connectionBanner(getState(), `${text} Cancel and End early come back when it reconnects.`);
  }

  function loadingHtml() {
    return heading('My reservations', 'Loading…');
  }

  function listHtml() {
    const all = getState().mine.slice().sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
    if (!all.length) {
      return heading('My reservations', 'Reservations you make on this device show up here.')
        + `<button type="button" class="primary" data-action="reserve" data-key="reserve"${disabled()}>Reserve</button>`;
    }
    const active = [];
    const finished = [];
    const inactive = [];
    for (const item of all) {
      const { active: approved, ended } = actionsOf(item);
      (!approved ? inactive : ended ? finished : active).push(item);
    }
    const group = (title, items) => items.length
      ? `<h3 class="group-title">${title}</h3><ul class="cards">${items.map(cardHtml).join('')}</ul>`
      : '';
    return heading('My reservations', 'Made on this device.') + group('Active', active) + group('Finished', finished) + group('Cancelled or replaced', inactive);
  }

  function cardHtml(item) {
    const { ended, earlyEnds, canCancel, byAdmin } = actionsOf(item);
    const notice = noticeText(config(), item);
    const purpose = purposeLabel(config(), item.purpose);
    const meta = `${placeLabel(config(), item.type, item.unit)} · ${item.reservedFor ? `${purpose}: ${item.reservedFor}` : purpose}`;
    const actions = [
      item.status === 'overridden' ? `<button type="button" class="secondary" data-action="reserve" data-date="${esc(item.date)}" data-type="${esc(item.type)}" data-key="reserve-${esc(item.id)}"${disabled()}>Reserve another time</button>` : '',
      earlyEnds.length ? `<button type="button" class="secondary" data-action="end" data-id="${esc(item.id)}" data-key="end-${esc(item.id)}"${disabled()}>End early</button>` : '',
      canCancel ? `<button type="button" class="secondary danger" data-action="cancel" data-id="${esc(item.id)}" data-key="cancel-${esc(item.id)}"${disabled()}>Cancel</button>` : ''
    ].filter(Boolean).join('');
    const status = ended ? 'finished' : item.status;
    return `<li class="card">
      <p class="card-head"><b>${esc(formatDay(item.date))}</b><span class="badge status-${esc(status)}">${esc(statusLabel(item.status, ended))}</span></p>
      <p class="card-time">${esc(formatRange(item.start, item.end))}</p>
      <p class="card-meta"><span>${esc(meta)}</span></p>
      ${item.endedEarlyFrom ? `<p class="card-note">Ended early. It was booked until ${esc(formatTime(item.endedEarlyFrom))}.</p>` : ''}
      ${item.status === 'cancelled' && byAdmin ? '<p class="card-note">Cancelled by Admin.</p>' : ''}
      ${notice ? `<p class="card-note takeover-note" role="note">${esc(notice)}</p>` : ''}
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </li>`;
  }

  function summaryHtml(item) {
    return summaryList([
      ['Day', formatDay(item.date)],
      ['Time', formatRange(item.start, item.end)],
      ['Where', placeLabel(config(), item.type, item.unit)],
      ['For', purposeLabel(config(), item.purpose)]
    ]);
  }

  function cancelHtml(item) {
    return heading('Cancel this reservation?', 'Its time opens for others right away.') + summaryHtml(item) + `
      <div class="actions">
        <button type="button" class="primary danger" data-action="cancel-confirm" data-key="cancel-confirm"${disabled()} aria-busy="${busy}">${busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
        <button type="button" class="text-button" data-action="back" data-key="keep"${busy ? ' disabled' : ''}>Keep it</button>
      </div>`;
  }

  // The ends the server allows now. While the reservation is under way the
  // first of them reads "Soonest": a time that has begun cannot be freed, so
  // it is the end of the half hour now under way.
  function endHtml(item) {
    const { earlyEnds } = actionsOf(item);
    const clock = nowIn(config().timeZone);
    const underWay = item.date === clock.date && toMinutes(item.start) <= clock.minutes;
    const soonest = underWay ? earlyEnds[0] : null;
    return heading('End early', 'Choose the new end time. The time after it opens for others.') + `
      <div class="times">${earlyEnds.map(end => `
        <button type="button" class="time${end === soonest ? ' now' : ''}" data-action="end-pick" data-end="${esc(end)}" data-key="end-${esc(end)}"${disabled()}
          aria-label="${esc(`${end === soonest ? 'Soonest, ' : ''}${formatTime(end)}, frees ${formatDuration(toMinutes(item.end) - toMinutes(end))}`)}">
          ${end === soonest ? '<small class="now-label">Soonest</small> ' : ''}${formatTime(end)} <small>Frees ${formatDuration(toMinutes(item.end) - toMinutes(end))}</small>
        </button>`).join('')}</div>`;
  }

  function endConfirmHtml(item, end) {
    return heading(`End at ${formatTime(end)}?`, `You keep ${formatRange(item.start, end)}. ${formatRange(end, item.end)} opens for others.`)
      + summaryHtml(item) + `
      <div class="actions">
        <button type="button" class="primary" data-action="end-confirm" data-key="end-confirm"${disabled()} aria-busy="${busy}">${busy ? 'Saving…' : 'End early'}</button>
        <button type="button" class="text-button" data-action="back" data-key="end-back"${busy ? ' disabled' : ''}>Back</button>
      </div>`;
  }

  // ---------- Actions ----------

  async function run(action, success) {
    busy = true;
    sheet.locked = true;
    error = '';
    render();
    let failure = null;
    try {
      await action();
      screen = { view: 'list' };
    } catch (problem) {
      failure = problem;
    }
    busy = false;
    sheet.locked = false;
    if (!sheet.isOpen) {
      // A second Back closed the sheet while saving. A failure opens it
      // again on the list, unless another sheet is open by now.
      screen = { view: 'list' };
      if (failure && !document.querySelector('dialog[open]')) {
        open({ view: 'list' });
        error = failure.message;
        render({ focus: 'h2' });
      } else announce(failure ? failure.message : success);
      return;
    }
    if (failure) error = failure.message;
    else announce(success);
    checkScreen();
    render({ focus: 'h2' });
  }

  dialog.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const { action, id, end, date, type } = button.dataset;
    if (action === 'close') close();
    else if (action === 'back') back();
    else if (action === 'retry') refresh();
    else if (action === 'reload') location.reload();
    else if (action === 'reserve') {
      close();
      onReserve(date ? { date, type } : null);
    } else if (action === 'cancel') {
      screen = { view: 'cancel', id };
      render({ focus: 'h2' });
    } else if (action === 'end') {
      screen = { view: 'end', id };
      render({ focus: 'h2' });
    } else if (action === 'end-pick') {
      screen = { view: 'end-confirm', id: screen.id, end };
      render({ focus: 'h2' });
    } else if (action === 'cancel-confirm') {
      const item = find(screen.id);
      if (!item) return showList();
      run(() => cancel(item.id), 'Reservation cancelled. Its time is open for others.');
    } else if (action === 'end-confirm') {
      const item = find(screen.id);
      if (!item) return showList();
      run(() => endEarly(item.id, screen.end), `Reservation now ends at ${formatTime(screen.end)}.`);
    }
  });

  addEventListener('popstate', () => {
    const wanted = new URLSearchParams(location.search).get('view') === 'mine';
    if (wanted && !sheet.isOpen) open({ push: false });
    else if (!wanted && sheet.isOpen && !busy) sheet.close();
  });

  return { open, update };
}
