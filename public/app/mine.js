// My reservations: everything booked from this device on the open days,
// with Cancel and End early. The address gets ?view=mine while it is open,
// so the link can be shared and the browser's Back button closes it.

import { escapeHtml as esc, formatTime, formatRange, formatDay, formatDuration, nowIn, toMinutes } from '../shared/format.js';
import { earlierEnds } from '../shared/availability.js';
import { cancel, endEarly, canBook, refresh } from './store.js';
import { createSheet } from './sheet.js';
import { statusLabel, purposeLabel, detailLabel, placeLabel, noticeText } from './text.js';
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

  function open({ view = 'list', id = null, push = true } = {}) {
    screen = { view, id };
    error = '';
    if (push && new URLSearchParams(location.search).get('view') !== 'mine') {
      const params = new URLSearchParams(location.search);
      params.set('view', 'mine');
      history.pushState({ mine: true }, '', `?${params}`);
    }
    sheet.open();
    render({ focus: 'h2' });
  }

  function close() {
    sheet.close();
  }

  function clearAddress() {
    screen = { view: 'list' };
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

  function update() {
    if (!sheet.isOpen || busy) return;
    if (screen.view !== 'list' && !find(screen.id)) screen = { view: 'list' };
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
        <button type="button" class="icon-button" data-action="back" data-key="back" aria-label="Back"${screen.view === 'list' ? ' hidden' : ''}>${ICONS.back}</button>
        <span class="sheet-step">My reservations</span>
        <button type="button" class="icon-button" data-action="close" data-key="close" aria-label="Close">${ICONS.close}</button>
      </div>
      ${connectionHtml()}
      <section class="step">${body}</section>
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    `, { focus });
  }

  const heading = (text, hint = '') => `<h2 id="mine-title" tabindex="-1">${text}</h2>${hint ? `<p class="hint">${hint}</p>` : ''}`;
  const disabled = () => canBook(getState()) && !busy ? '' : ' disabled';

  function connectionHtml() {
    const { status } = getState();
    if (canBook(getState()) || status === 'connecting') return '';
    const text = status === 'offline' ? 'You’re offline.' : 'The schedule is not connected.';
    return `<div class="sheet-status" role="status">${text} Cancel and End early come back when it reconnects. <button type="button" class="text-button" data-action="retry" data-key="retry">Try again</button></div>`;
  }

  function loadingHtml() {
    return heading('My reservations', 'Loading…');
  }

  function listHtml() {
    const all = getState().mine.slice().sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
    const active = all.filter(item => item.status === 'approved');
    const inactive = all.filter(item => item.status !== 'approved');
    if (!all.length) {
      return heading('My reservations', 'Reservations you make on this device show up here.')
        + `<button type="button" class="primary" data-action="reserve" data-key="reserve"${disabled()}>Reserve</button>`;
    }
    const group = (title, items) => items.length
      ? `<h3 class="group-title">${title}</h3><ul class="cards">${items.map(cardHtml).join('')}</ul>`
      : '';
    return heading('My reservations', 'Made on this device.') + group('Active', active) + group('Cancelled or replaced', inactive);
  }

  function cardHtml(item) {
    const notice = noticeText(config(), item);
    const meta = [placeLabel(config(), item.type, item.unit), purposeLabel(config(), item.purpose), item.reservedFor ? `${detailLabel(config(), item.purpose)}: ${item.reservedFor}` : ''].filter(Boolean);
    const actions = [
      item.status === 'overridden' ? `<button type="button" class="secondary" data-action="reserve" data-key="reserve-${esc(item.id)}"${disabled()}>Reserve another time</button>` : '',
      item.canEndEarly ? `<button type="button" class="secondary" data-action="end" data-id="${esc(item.id)}" data-key="end-${esc(item.id)}"${disabled()}>End early</button>` : '',
      item.canCancel ? `<button type="button" class="secondary danger" data-action="cancel" data-id="${esc(item.id)}" data-key="cancel-${esc(item.id)}"${disabled()}>Cancel</button>` : ''
    ].filter(Boolean).join('');
    return `<li class="card">
      <p class="card-head"><b>${esc(formatDay(item.date))}</b><span class="badge status-${esc(item.status)}">${esc(statusLabel(item.status))}</span></p>
      <p class="card-time">${esc(formatRange(item.start, item.end))}</p>
      <p class="card-meta">${meta.map(value => `<span>${esc(value)}</span>`).join('')}</p>
      ${item.endedEarlyFrom ? `<p class="card-note">Ended early. It was booked until ${esc(formatTime(item.endedEarlyFrom))}.</p>` : ''}
      ${notice ? `<p class="card-note takeover-note" role="note">${esc(notice)}</p>` : ''}
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </li>`;
  }

  function summaryHtml(item) {
    const items = [
      ['Day', formatDay(item.date)],
      ['Time', formatRange(item.start, item.end)],
      ['Where', placeLabel(config(), item.type, item.unit)],
      ['For', purposeLabel(config(), item.purpose)]
    ];
    return `<dl class="summary">${items.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  function cancelHtml(item) {
    return heading('Cancel this reservation?', 'Its time opens for others right away.') + summaryHtml(item) + `
      <div class="actions">
        <button type="button" class="primary danger" data-action="cancel-confirm" data-key="cancel-confirm"${disabled()} aria-busy="${busy}">${busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
        <button type="button" class="text-button" data-action="back" data-key="keep">Keep it</button>
      </div>`;
  }

  function endHtml(item) {
    const ends = earlierEnds(config(), item.start, item.end);
    const now = nowIn(config().timeZone);
    // The latest option already reached today reads "Now".
    const reached = item.date === now.date ? ends.filter(end => toMinutes(end) <= now.minutes).pop() : null;
    return heading('End early', 'Choose the new end time. The time after it opens for others.') + `
      <div class="times">${ends.map(end => `
        <button type="button" class="time${end === reached ? ' now' : ''}" data-action="end-pick" data-end="${end}" data-key="end-${end}"${disabled()}
          aria-label="${esc(`End at ${formatTime(end)}${end === reached ? ', now' : ''}, frees ${formatDuration(toMinutes(item.end) - toMinutes(end))}`)}">
          ${end === reached ? '<small class="now-label">Now</small>' : ''}${formatTime(end)}<small>Frees ${formatDuration(toMinutes(item.end) - toMinutes(end))}</small>
        </button>`).join('')}</div>`;
  }

  function endConfirmHtml(item, end) {
    return heading(`End at ${formatTime(end)}?`, `You keep ${formatRange(item.start, end)}. ${formatRange(end, item.end)} opens for others.`)
      + summaryHtml(item) + `
      <div class="actions">
        <button type="button" class="primary" data-action="end-confirm" data-key="end-confirm"${disabled()} aria-busy="${busy}">${busy ? 'Saving…' : 'End early'}</button>
        <button type="button" class="text-button" data-action="back" data-key="end-back">Back</button>
      </div>`;
  }

  // ---------- Actions ----------

  async function run(action, success) {
    busy = true;
    sheet.locked = true;
    error = '';
    render();
    try {
      await action();
      screen = { view: 'list' };
      announce(success);
    } catch (failure) {
      error = failure.message;
    } finally {
      busy = false;
      sheet.locked = false;
      render({ focus: 'h2' });
    }
  }

  dialog.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const { action, id, end } = button.dataset;
    if (action === 'close') close();
    else if (action === 'back') back();
    else if (action === 'retry') refresh();
    else if (action === 'reserve') {
      close();
      onReserve();
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
      run(() => cancel(item.id), 'Reservation cancelled. Its time is open for others.');
    } else if (action === 'end-confirm') {
      const item = find(screen.id);
      run(() => endEarly(item.id, screen.end), `Reservation now ends at ${formatTime(screen.end)}.`);
    }
  });

  addEventListener('popstate', () => {
    const wanted = new URLSearchParams(location.search).get('view') === 'mine';
    if (wanted && !sheet.isOpen) open({ push: false });
    else if (!wanted && sheet.isOpen) sheet.close();
  });

  return { open, update };
}
