import * as live from '../shared/live.js';
import {overrideUnitForRange, serviceBlocksFor, minutes as toMinutes, groupMyReservations, reservationResource, reservationStatusLabel, reservationPurposeLabel, endEarlyOptions, endEarlyNowOption, endedEarly, priorityNoticeText} from '../shared/model.js';

const {subscribe, submit, retry} = live;

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const visibleText = value => String(value || '').replace(/[\p{Z}\p{C}]/gu, '').length > 0;
const icons = {
  room: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 21V4h14v17M3 21h18M9 4v17M15 12h.01"/></svg>',
  whiteboard: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 21l2-4m8 4-2-4M7 9h10M7 12h6"/></svg>',
  tv: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-2-14 5 3-5 3z"/></svg>'
};
const types = {
  room: {label:'Study Rooms', single:'Study Room', short:'Room', count:4},
  whiteboard: {label:'Whiteboards', single:'Whiteboard', short:'Board', count:5},
  tv: {label:'TVs', single:'TV', short:'TV', count:3}
};
const purposes = {
  contact: {label:'Contact', hint:''},
  new: {label:'New Member', hint:''},
  other: {label:'Other', hint:''}
};
const reservedForLabels = {contact:'Contact Name', new:'Member Name', other:'Purpose'};
const priorityOverrideLabel = 'Priority override';
const documentKeys = new Map();
let documentKeyCount = 0;
let connection = {status:'loading', canBook:false, demo:false, error:''};
let days = [], bookings = [], dayIndex = 0, type = 'room';
let draft = {}, history = [], step = 'resource', returnFocus = null, lastBooking = null, detailBooking = null, detailReturnFocus = null;
let saving = false, draftError = '';
let actionPending = false, detailConfirm = '';
let myReservations = [], mineStep = {view:'list'}, mineBusy = false, mineError = '', mineOpener = null, mineFocus = '', mineDrawn = '';

const fmt = minutes => {
  const hours = Math.floor(minutes / 60);
  return ((hours + 11) % 12 + 1) + (minutes % 60 ? ':30' : ':00') + ' ' + (hours < 12 ? 'AM' : 'PM');
};
const hour = minutes => fmt(minutes).replace(':00', '');
const dateLabel = day => day?.label || 'Choose an available day';
const duration = (start, end) => {
  const minutes = end - start;
  return minutes < 60 ? minutes + ' min' : minutes % 60 ? Math.floor(minutes / 60) + ' hr 30 min' : minutes / 60 + ' hr';
};
const units = resource => Array.from({length:types[resource].count}, (_, index) => index + 1);
const services = day => !day ? [] : serviceBlocksFor(day);
const serviceAt = (day, minutes) => services(day).some(([start, end]) => minutes >= start && minutes < end);
const occupant = (day, resource, unit, minutes) => bookings.find(booking => booking.day === day?.key && booking.type === resource && booking.unit === unit && minutes >= booking.start && minutes < booking.end);
const isReady = () => connection.canBook && ['live','demo'].includes(connection.status) && days.length > 0;
const draftDay = () => days.find(day => day.key === draft.day) || draft.dayInfo;
const draftReady = () => isReady() && days.some(day => day.key === draft.day);
const isFree = (day, resource, unit, minutes) => Boolean(day) && minutes >= 600 && minutes < 1380 && !serviceAt(day, minutes) && !occupant(day, resource, unit, minutes);

function freeRange(day, resource, unit, start, end) {
  if (!day || !units(resource).includes(unit) || !Number.isInteger(start) || !Number.isInteger(end) || start % 30 || end % 30 || start >= end || start < 600 || end > 1380) return false;
  for (let minutes = start; minutes < end; minutes += 30) if (!isFree(day, resource, unit, minutes)) return false;
  return true;
}
const availableUnits = (day, resource, start, end) => units(resource).filter(unit => freeRange(day, resource, unit, start, end));
function rangeAvailability(day, resource, start, end, purpose, exactUnit = null) {
  const free = exactUnit === null ? availableUnits(day, resource, start, end) : freeRange(day, resource, exactUnit, start, end) ? [exactUnit] : [];
  if (free.length) return {unit:free[0], override:false};
  if (!day || !Number.isInteger(start) || !Number.isInteger(end) || start >= end || start < 600 || end > 1380) return null;
  for (let minutes = start; minutes < end; minutes += 30) if (serviceAt(day, minutes)) return null;
  const overrideUnit = overrideUnitForRange(resource, day.key, start, end, purpose, bookings, exactUnit);
  return overrideUnit === null ? null : {unit:overrideUnit, override:true};
}
function startOptions() {
  if (!draftReady()) return [];
  const exactUnit = draft.locked ? draft.unit : null;
  const result = [];
  for (let start = 600; start < 1380; start += 30) {
    const option = rangeAvailability(draftDay(), draft.type, start, start + 30, draft.purpose, exactUnit);
    if (option) result.push({start, ...option});
  }
  return result;
}
function endOptions() {
  if (!draftReady() || !Number.isInteger(draft.start) || !draft.purpose) return [];
  const exactUnit = draft.locked ? draft.unit : null;
  const result = [];
  for (let end = draft.start + 30; end <= 1380; end += 30) {
    const option = rangeAvailability(draftDay(), draft.type, draft.start, end, draft.purpose, exactUnit);
    if (!option) break;
    result.push({end, ...option});
  }
  return result;
}

function normalizeDay(value) {
  const date = new Date(value.key + 'T12:00:00Z');
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  return {key:value.key, label:value.label, dow:value.weekday, date,
    weekday:date.toLocaleDateString('en-US', {weekday:'long', timeZone:'UTC'}),
    month:date.toLocaleDateString('en-US', {month:'short', timeZone:'UTC'}),
    number:date.getUTCDate(), today:value.key === today};
}
function normalizeBooking(value) {
  if (!documentKeys.has(value.key)) documentKeys.set(value.key, 'entry-' + ++documentKeyCount);
  const purpose = value.purpose === 'new-member' ? 'new' : value.purpose;
  const blocked = value.blocked || purpose === 'blocked';
  const projectedName = publicProjection(value);
  return {id:documentKeys.get(value.key), key:value.key, bookingId:value.bookingId || value.id || value.key, day:value.day, type:value.type, unit:value.unit,
    start:value.start, end:value.end, name:blocked ? '' : projectedName,
    publicName:blocked ? '' : projectedName, purpose:blocked ? 'blocked' : purpose, reservedFor:typeof value.reservedFor==='string' ? value.reservedFor : '', blocked:Boolean(blocked), ownerDetail:authorizedOwnerDetail(value)};
}
function publicProjection(value) {
  const projected = value?.publicName ?? value?.displayName ?? value?.name;
  const text = String(projected ?? '').trim();
  return text || 'Reserved';
}
function authorizedOwnerDetail(value) {
  const detail = value?.ownerDetail ?? value?.ownerDetails ?? value?.detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  return detail.authorized === true || detail.ownerAuthorized === true || detail.authorizedForMember === true ? detail : null;
}
/* The shared state names these permissions canCancel and canEndEarly; older
   shapes are still accepted. */
function detailAllows(detail, action) {
  if (!detail || typeof detail !== 'object') return false;
  const owned = action === 'cancel' ? detail.canCancel : detail.canEndEarly;
  return owned === true || detail[action] === true || detail.permissions?.[action] === true || detail.actions?.[action] === true;
}
function reservedForValue(detail, booking) {
  if (!detail) return '';
  const value = booking?.purpose === 'other'
    ? detail.purposeOther ?? detail.purpose_other ?? detail.reservedFor ?? detail.reserved_for
    : detail.reservedFor ?? detail.reserved_for ?? detail.name;
  return String(value ?? '').trim();
}
function reservationPurpose(booking) {
  return booking?.blocked ? '' : purposes[booking?.purpose]?.label || 'Other';
}
function connectionCopy() {
  if (connection.status === 'offline') return {title:'Schedule unavailable.', text:'You are offline. Availability will be checked again before you reserve.'};
  if (connection.status === 'error') return {title:'Schedule unavailable.', text:connection.error || 'The schedule could not connect. Please try again.'};
  if (connection.status === 'loading') return {title:'Unfolding your day...', text:'Connecting to the live schedule.'};
  if (!isReady()) return {title:'Checking availability.', text:connection.error || 'Reservations will be available when the schedule is ready.'};
  return null;
}
function renderConnection() {
  const copy = connectionCopy(), note = $('#stateNote');
  note.hidden = !copy;
  note.innerHTML = copy ? `<div><b>${esc(copy.title)}</b><p>${esc(copy.text)}</p></div><button type="button" class="text-button" data-retry>Retry</button>` : '';
  $('#scheduleMode').textContent = connection.demo ? 'Fictional demo schedule' : connection.status === 'live' ? 'Live schedule' : 'Availability updating';
  $('#tapHint').textContent = isReady() ? 'Tap any open tile' : 'Checking availability';
  $('#footerNote').textContent = connection.demo ? 'Demo mode. Fictional names and simulated reservations only.' : 'LV Zion Study Rooms';
  $('#reserve').disabled = !isReady();
  updateDialogConnection();
}
function updateDialogConnection() {
  const node = $('#sheetConnection');
  const unavailable = $('#bookingDialog').open && step !== 'success' && !draftReady();
  node.hidden = !unavailable;
  if (unavailable) {
    const copy = connectionCopy();
    node.innerHTML = `<span>${esc(copy?.text || 'This date is no longer offered. Close this sheet and choose an available day.')}</span><button type="button" class="text-button" data-retry>Retry</button>`;
  } else node.innerHTML = '';
  $('#close').disabled = saving;
  $('#back').disabled = saving || !history.length || step === 'success';
  $('#sheetBody').querySelectorAll('[data-pick-resource],[data-purpose],[data-pick-start],[data-end],button[type="submit"],#confirm').forEach(button => button.disabled = saving || !draftReady());
  const confirm = $('#confirm');
  if (confirm) confirm.textContent = saving ? 'Reserving your space...' : connection.demo ? 'Confirm demo reservation' : 'Confirm reservation';
}
function renderDays() {
  $('#days').innerHTML = days.length ? days.map((day, index) => `<button type="button" class="ticket" data-day="${index}" aria-pressed="${index === dayIndex}" aria-label="${esc(dateLabel(day))}${day.today ? ', today' : ''}"><span class="date-number">${day.number}</span><span class="date-copy"><b>${esc(day.weekday)}</b><small>${esc(day.month)}${day.today ? ' · Today' : ''}</small></span></button>`).join('') : '<button type="button" class="ticket" disabled><span class="date-copy"><b>Connecting</b><small>Finding your days</small></span></button>';
}
function renderResources() {
  $('#resources').innerHTML = Object.entries(types).map(([key, resource]) => `<button type="button" class="resource" data-resource="${key}" aria-pressed="${type === key}" aria-label="Show ${resource.label}">${icons[key]}<span>${resource.label}</span></button>`).join('');
}
function renderSchedule() {
  const day = days[dayIndex], resource = types[type], element = $('#schedule');
  element.className = 'schedule' + (type === 'whiteboard' ? ' board-grid' : '') + (connection.status === 'loading' ? ' skeleton' : '');
  element.style.setProperty('--units', resource.count);
  element.setAttribute('aria-label', resource.label + ' schedule' + (day ? ' for ' + dateLabel(day) : ', loading'));
  element.setAttribute('aria-busy', String(connection.status === 'loading'));
  $('#dateCaption').textContent = day ? day.month + ' ' + day.number : '';
  let rail = '';
  for (let minutes = 600; minutes <= 1380; minutes += 60) rail += `<span class="time" style="top:calc(var(--row) * ${(minutes - 600) / 30})">${hour(minutes)}</span>`;
  const columns = units(type).map((unit, index) => {
    let html = '';
    for (let minutes = 600; minutes < 1380;) {
      if (serviceAt(day, minutes)) { minutes += 30; continue; }
      const booking = occupant(day, type, unit, minutes);
      if (booking) {
        const end = Math.min(booking.end, 1380), count = (end - minutes) / 30;
        const name = booking.blocked ? 'Reserved' : booking.name;
        const purpose = booking.blocked ? '' : purposes[booking.purpose]?.label || 'Other';
        html += `<button type="button" class="slot booked ${booking.purpose} ${count === 1 ? 'short' : ''} ${lastBooking?.key === booking.key ? 'new-booking' : ''}" data-booking="${esc(booking.key)}" id="${booking.id}" style="--s:${(minutes - 600) / 30};--n:${count}" aria-label="${resource.single} ${unit}, ${esc(name)}${purpose ? ', ' + purpose : ''}, ${fmt(minutes)} to ${fmt(end)}"><span class="booking-name">${esc(name)}</span>${purpose ? `<span class="purpose-tag">${purpose}</span>` : ''}</button>`;
        minutes = end;
      } else {
        html += isReady() ? `<button type="button" class="slot open" data-unit="${unit}" data-start="${minutes}" style="--s:${(minutes - 600) / 30};--n:1" aria-label="Reserve ${resource.single} ${unit} starting ${fmt(minutes)} on ${esc(dateLabel(day))}"><span class="plus" aria-hidden="true">+</span><span>Open</span></button>` : `<div class="slot waiting" style="--s:${(minutes - 600) / 30};--n:1" aria-label="${resource.single} ${unit}, availability not confirmed"><span aria-hidden="true">&#183;</span></div>`;
        minutes += 30;
      }
    }
    return `<div class="column" style="--i:${index}">${html}</div>`;
  }).join('');
  const bands = services(day).map(([start, end, label]) => `<div class="service" style="--s:${(start - 600) / 30};--n:${(end - start) / 30}"><span class="service-label">${label}</span><small>${fmt(start)} to ${fmt(end)}</small></div>`).join('');
  element.innerHTML = `<div class="grid-head"><span class="rail-title">Time</span>${units(type).map(unit => `<div class="unit-head" aria-label="${resource.single} ${unit}"><span class="unit-num">${unit}</span><span class="unit-kind">${resource.short}</span></div>`).join('')}</div><div class="timeline"><div class="rail">${rail}</div>${columns}${bands}</div>`;
}
function detailActionMarkup(action, label) {
  return detailAllows(detailBooking?.ownerDetail, action)
    ? `<button type="button" class="primary wide detail-action" data-detail-action="${action}">${label}</button>`
    : '';
}
function detailActionsHtml() {
  if (detailConfirm === 'cancel') return `<p class="detail-confirm">Cancel this reservation? The time opens for everyone right away.</p><div class="detail-actions"><button type="button" class="primary wide detail-action" data-detail-action="cancel-confirm">Yes, cancel reservation</button><button type="button" class="quiet-button" data-detail-action="cancel-keep">Keep it</button></div>`;
  const actions = `${detailActionMarkup('endEarly', 'End early')}${detailActionMarkup('cancel', 'Cancel')}`;
  return actions ? `<div class="detail-actions">${actions}</div>` : '';
}
function renderDetail(booking, open = false, focusSelector = '') {
  if (!booking) return;
  detailBooking = booking;
  const bookingDay = days.find(day => day.key === booking.day);
  const detail = booking.ownerDetail;
  const purpose = reservationPurpose(booking);
  const privateValue = reservedForValue(detail, booking) || booking.reservedFor || '';
  const privateLabel = reservedForLabels[booking.purpose] || 'Reserved for';
  const actionMarkup = detailActionsHtml();
  const ownerName = detail?.name || detail?.displayName || booking.publicName || '';
  const publicRows = `<div class="detail-row"><span>Day</span><b>${esc(bookingDay?.label || mineDateLabel(booking.day) || 'Reservation day')}</b></div><div class="detail-row"><span>Reservation</span><b>${fmt(booking.start)} to ${fmt(booking.end)}</b></div><div class="detail-row"><span>Public name</span><b>${esc(booking.blocked ? 'Reserved' : booking.publicName || booking.name)}</b></div>${purpose ? `<div class="detail-row"><span>Purpose</span><b>${esc(purpose)}</b></div>` : ''}${ownerName ? `<div class="detail-row detail-private"><span>Reserved</span><b>${esc(ownerName)}</b></div>` : ''}`;
  $('#detailBody').innerHTML = `<p class="crumb">${esc(types[booking.type]?.single || 'Reservation')} ${booking.unit}</p><h2 id="detailTitle" class="step-title" tabindex="-1">Reservation details</h2><div class="detail-card">${publicRows}${privateValue ? `<div class="detail-row detail-private"><span>${esc(privateLabel)}</span><b>${esc(privateValue)}</b></div>` : ''}</div>${actionMarkup}<p id="detailStatus" class="validation form-error" role="alert"></p>`;
  if (open && !$('#detailDialog').open) {
    detailReturnFocus = document.activeElement;
    $('#detailDialog').showModal();
  }
  const target = focusSelector ? $('#detailBody').querySelector(focusSelector) : null;
  requestAnimationFrame(() => (target?.isConnected ? target : $('#detailTitle'))?.focus({preventScroll:true}));
}
function closeDetail() {
  if (!$('#detailDialog').open || actionPending) return;
  $('#detailDialog').close();
  detailConfirm = '';
  if (detailReturnFocus?.isConnected) detailReturnFocus.focus({preventScroll:true});
  detailReturnFocus = null;
  detailBooking = null;
}
async function runDetailAction(action) {
  if (actionPending || !detailBooking) return;
  const detail = detailBooking.ownerDetail, bookingId = detail?.bookingId ?? detail?.id ?? '';
  if (action === 'cancel-keep') { detailConfirm = ''; renderDetail(detailBooking, false, '[data-detail-action="cancel"]'); return; }
  if (action === 'endEarly') {
    // Ending early needs a new ending, so it continues in My reservations.
    if (!detailAllows(detail, 'endEarly') || !bookingId) return;
    closeDetail();
    openMine({view:'end-early', bookingId});
    return;
  }
  if (action === 'cancel') { if (!detailAllows(detail, 'cancel') || !bookingId) return; detailConfirm = 'cancel'; renderDetail(detailBooking); return; }
  if (action !== 'cancel-confirm' || !detailAllows(detail, 'cancel') || !bookingId) return;
  actionPending = true;
  const status = $('#detailStatus');
  if (status) status.textContent = 'Cancelling reservation...';
  $('#detailBody').querySelectorAll('button').forEach(button => button.disabled = true);
  try {
    await live.cancelOwnedBooking(bookingId);
    actionPending = false;
    detailConfirm = '';
    closeDetail();
    announce('Reservation cancelled. The time is open for everyone.');
  } catch (error) {
    actionPending = false;
    if (status) status.textContent = error?.message || 'That action could not be completed. Please try again.';
    $('#detailBody').querySelectorAll('button').forEach(button => button.disabled = false);
  }
}

/* ================= My reservations, inside Petal ================= */

function announce(text) { $('#status').textContent = text; }
const mineTime = value => { const total = toMinutes(value); return Number.isFinite(total) ? fmt(total) : String(value ?? ''); };
const mineRange = booking => `${mineTime(booking.start)} to ${mineTime(booking.end)}`;
const mineDateLabel = key => {
  const known = days.find(day => day.key === key);
  if (known) return known.label;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))
    ? new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {timeZone:'UTC', weekday:'long', month:'short', day:'numeric'})
    : String(key ?? '');
};
const mineResourceLabel = booking => { const found = reservationResource(booking); if (!found) return 'Reservation'; return found.unit ? `${types[found.type]?.single || found.label} ${found.unit}` : found.label; };
const mineById = id => myReservations.find(booking => booking.id === id) || null;
const mineReady = () => ['live','demo'].includes(connection.status) && connection.canBook === true;
const mineDisabled = () => mineReady() ? '' : ' disabled';

function mineReceiptHtml(booking) {
  const label = reservedForLabels[booking.purpose] || 'Reserved for', purpose = reservationPurposeLabel(booking), detail = String(booking.reservedFor || '').trim();
  return `<div class="receipt"><h3 class="receipt-unit">${esc(mineResourceLabel(booking))}</h3><div class="receipt-row"><span>Day</span><b>${esc(mineDateLabel(booking.date))}</b></div><div class="receipt-row"><span>Time</span><b>${esc(mineRange(booking))}</b></div>${purpose ? `<div class="receipt-row"><span>Purpose</span><b>${esc(purpose)}</b></div>` : ''}${detail ? `<div class="receipt-row"><span>${esc(label)}</span><b>${esc(detail)}</b></div>` : ''}</div>`;
}
function mineCardHtml(booking) {
  const label = reservedForLabels[booking.purpose] || 'Reserved for', detail = String(booking.reservedFor || '').trim();
  const status = reservationStatusLabel(booking), purpose = reservationPurposeLabel(booking), notice = priorityNoticeText(booking);
  const canEndEarly = booking.canEndEarly === true && endEarlyOptions(booking).length > 0;
  const actions = [
    booking.status === 'overridden' ? `<button type="button" class="mine-action" data-mine-rebook="${esc(booking.id)}">Reserve another time</button>` : '',
    canEndEarly ? `<button type="button" class="mine-action" data-mine-end-early="${esc(booking.id)}"${mineDisabled()}>End early</button>` : '',
    booking.canCancel === true ? `<button type="button" class="mine-action mine-stop" data-mine-cancel="${esc(booking.id)}"${mineDisabled()}>${booking.status === 'approved' ? 'Cancel reservation' : 'Cancel request'}</button>` : ''
  ].filter(Boolean).join('');
  return `<li class="mine-card">`
    + `<div class="mine-card-head"><b>${esc(mineDateLabel(booking.date))}</b>${status ? `<span class="mine-badge mine-${esc(booking.status)}">${esc(status)}</span>` : ''}</div>`
    + `<p class="mine-when">${esc(mineRange(booking))}</p>`
    + `<p class="mine-meta"><span>${esc(mineResourceLabel(booking))}</span>${purpose ? `<span>${esc(purpose)}</span>` : ''}${detail ? `<span>${esc(label)}: ${esc(detail)}</span>` : ''}</p>`
    + (endedEarly(booking) ? `<p class="mine-note">Ended early · originally booked until ${esc(mineTime(booking.endedEarlyFrom))}</p>` : '')
    + (notice ? `<p class="mine-note mine-priority" role="note"><strong>Priority update</strong> ${esc(notice)}</p>` : '')
    + (actions ? `<div class="mine-actions">${actions}</div>` : '')
    + `</li>`;
}
function mineListHtml() {
  const {upcoming, past} = groupMyReservations(myReservations);
  if (!upcoming.length && !past.length) {
    if (connection.status === 'loading') return '<h2 id="mineTitle" class="step-title" tabindex="-1">Finding your reservations.</h2><p class="step-hint">Connecting to the live schedule.</p>';
    if (connection.status === 'error') return `<h2 id="mineTitle" class="step-title" tabindex="-1">Reservations unavailable.</h2><p class="step-hint">${esc(connection.error || 'The schedule could not connect. Please try again.')}</p><button type="button" class="text-button" data-retry>Retry connection</button>`;
    return `<h2 id="mineTitle" class="step-title" tabindex="-1">No reservations yet.</h2><p class="step-hint">Anything you reserve on this device appears here, with Cancel and End early.</p><button type="button" class="primary wide" id="mineReserve"${isReady() ? '' : ' disabled'}>Reserve a space</button>`;
  }
  return `<h2 id="mineTitle" class="step-title" tabindex="-1">My reservations.</h2><p class="step-hint">Everything reserved from this device, with its latest status.</p>`
    + (upcoming.length ? `<h3 class="mine-heading">Upcoming</h3><ul class="mine-list" aria-label="Upcoming reservations">${upcoming.map(mineCardHtml).join('')}</ul>` : '')
    + (past.length ? `<h3 class="mine-heading">Past reservations</h3><ul class="mine-list" aria-label="Past reservations">${past.map(mineCardHtml).join('')}</ul>` : '');
}
function mineCancelHtml(booking) {
  const approved = booking.status === 'approved';
  return `<h2 id="mineTitle" class="step-title" tabindex="-1">${approved ? 'Cancel this reservation?' : 'Cancel this request?'}</h2>`
    + `<p class="step-hint">${approved ? 'The time opens for everyone right away. This cannot be undone.' : 'The request is withdrawn right away. This cannot be undone.'}</p>`
    + mineReceiptHtml(booking)
    + `<button type="button" class="primary wide mine-stop" id="mineCancelConfirm"${mineDisabled()} aria-busy="${mineBusy}">${mineBusy ? 'Cancelling...' : approved ? 'Yes, cancel reservation' : 'Yes, cancel request'}</button>`
    + `<button type="button" class="quiet-button" id="mineStepBack">Keep it</button>`;
}
function mineEndEarlyHtml(booking) {
  const options = endEarlyOptions(booking), current = endEarlyNowOption(booking);
  if (!options.length) return `<h2 id="mineTitle" class="step-title" tabindex="-1">This one cannot be shortened.</h2><p class="step-hint">It is a single 30 minute block, so finishing early means cancelling it.</p><button type="button" class="quiet-button" id="mineStepBack">Back to your reservations</button>`;
  return `<h2 id="mineTitle" class="step-title" tabindex="-1">When did you finish?</h2><p class="step-hint">Choose when you actually finished. The time after that opens for everyone right away.</p>`
    + `<div class="chips" role="group" aria-label="Choose a new ending">${options.map(option => `<button type="button" class="chip${option === current ? ' mine-now' : ''}" data-mine-end="${esc(option)}"${mineDisabled()} aria-label="${esc(`End at ${mineTime(option)}${option === current ? ', now' : ''}, frees ${mineTime(option)} to ${mineTime(booking.end)}`)}">${esc(mineTime(option))}${option === current ? '<span class="mine-now-label">now</span>' : ''}<small>Frees ${esc(mineTime(option))}</small></button>`).join('')}</div>`
    + `<button type="button" class="quiet-button" id="mineStepBack">Keep my time</button>`;
}
function mineEndConfirmHtml(booking, end) {
  return `<h2 id="mineTitle" class="step-title" tabindex="-1">End at ${esc(mineTime(end))}?</h2>`
    + `<p class="step-hint">${esc(mineTime(booking.start))} to ${esc(mineTime(end))} stays yours. ${esc(mineTime(end))} to ${esc(mineTime(booking.end))} opens for everyone.</p>`
    + mineReceiptHtml(booking)
    + `<button type="button" class="primary wide" id="mineEndConfirm"${mineDisabled()} aria-busy="${mineBusy}">${mineBusy ? 'Ending early...' : 'End early'}</button>`
    + `<button type="button" class="quiet-button" id="mineStepBack">Back</button>`;
}
function mineConnectionHtml() {
  let message = '';
  if (connection.status === 'offline') message = 'You are offline. Your reservations return when the connection does.';
  else if (connection.status === 'error' && myReservations.length) message = connection.error || 'The shared schedule could not connect.';
  else if (!mineReady() && connection.status !== 'loading') message = 'The shared schedule is reconnecting. Cancel and End early return when it is live.';
  if (!message) return '';
  return `<div class="sheet-connection"><span>${esc(message)}</span><button type="button" class="text-button" data-retry>Retry</button></div>`;
}
/* A background refresh arrives every few seconds. Redrawing the sheet then
   would interrupt whoever is part-way through a confirmation, so the sheet is
   only redrawn when something it shows has actually changed. */
function mineSignature() {
  return JSON.stringify([connection.status, connection.canBook, connection.error, mineStep, mineBusy, mineError,
    days.map(day => `${day.key}|${day.label}`),
    myReservations.map(booking => [booking.id, booking.status, booking.date, booking.start, booking.end, booking.purpose, booking.reservedFor, booking.canCancel, booking.canEndEarly, booking.endedEarlyFrom, booking.priorityNotice?.kind ?? '', booking.assignments])]);
}
function renderMine(moveFocus = false) {
  if (!$('#mineDialog').open) return;
  if (mineStep.view !== 'list' && !mineById(mineStep.bookingId)) mineStep = {view:'list'};
  const signature = mineSignature();
  if (!moveFocus && !mineFocus && signature === mineDrawn) return;
  mineDrawn = signature;
  const booking = mineById(mineStep.bookingId), view = mineStep.view;
  $('#mineBack').style.visibility = view === 'list' ? 'hidden' : 'visible';
  $('#mineCounter').textContent = view === 'list' ? 'Your reservations' : view === 'cancel' ? 'Cancel · confirm' : view === 'end-early' ? 'End early · choose' : 'End early · confirm';
  $('#mineConnection').innerHTML = mineConnectionHtml();
  const body = view === 'cancel' ? mineCancelHtml(booking) : view === 'end-early' ? mineEndEarlyHtml(booking) : view === 'end-confirm' ? mineEndConfirmHtml(booking, mineStep.end) : mineListHtml();
  // A background refresh replaces this markup, so keep focus inside the sheet.
  const heldFocus = $('#mineBody').contains(document.activeElement);
  $('#mineBody').innerHTML = `${mineError ? `<p class="validation form-error" role="alert">${esc(mineError)}</p>` : ''}${body}`;
  $('#mineDialog').scrollTop = 0;
  const target = mineFocus ? $('#mineBody').querySelector(mineFocus) : null;
  mineFocus = '';
  if (moveFocus || target || heldFocus) requestAnimationFrame(() => (target?.isConnected ? target : $('#mineTitle'))?.focus({preventScroll:true}));
}
function mineUrl(open) {
  const search = new URLSearchParams(location.search);
  if (open) search.set('view', 'mine'); else search.delete('view');
  const query = search.toString();
  return location.pathname + (query ? `?${query}` : '') + location.hash;
}
function openMine(nextStep = {view:'list'}, push = true) {
  if (!$('#mineDialog').open) { mineOpener = document.activeElement; if ($('#bookingDialog').open && !saving) closeBooking(); }
  mineStep = nextStep; mineError = '';
  if (!$('#mineDialog').open) $('#mineDialog').showModal();
  if (push && new URLSearchParams(location.search).get('view') !== 'mine') window.history.pushState({view:'mine'}, '', mineUrl(true));
  renderMine(true);
}
function closeMine(push = true) {
  if (mineBusy || !$('#mineDialog').open) return;
  $('#mineDialog').close(); mineStep = {view:'list'}; mineError = '';
  if (push && new URLSearchParams(location.search).get('view') === 'mine') window.history.pushState({}, '', mineUrl(false));
  if (mineOpener?.isConnected) mineOpener.focus({preventScroll:true}); else $('#mineLink')?.focus({preventScroll:true});
  mineOpener = null;
}
function mineBack() {
  if (mineBusy) return;
  mineError = '';
  if (mineStep.view === 'end-confirm') { mineStep = {view:'end-early', bookingId:mineStep.bookingId}; renderMine(true); return; }
  mineFocus = mineStep.view === 'cancel' ? `[data-mine-cancel="${mineStep.bookingId}"]` : mineStep.view === 'end-early' ? `[data-mine-end-early="${mineStep.bookingId}"]` : '';
  mineStep = {view:'list'}; renderMine(true);
}
async function runMineCancel() {
  const booking = mineById(mineStep.bookingId);
  if (!booking || mineBusy) return;
  mineBusy = true; mineError = ''; renderMine();
  try {
    await live.cancelOwnedBooking(booking.id);
    mineBusy = false; mineStep = {view:'list'};
    announce(booking.status === 'approved' ? 'Reservation cancelled. The time is open for everyone.' : 'Request cancelled.');
    renderMine(true);
  } catch (error) {
    mineBusy = false; mineError = error?.message || 'That reservation could not be cancelled. Please try again.'; renderMine(true);
  }
}
async function runMineEndEarly() {
  const booking = mineById(mineStep.bookingId), end = mineStep.end;
  if (!booking || !end || mineBusy) return;
  mineBusy = true; mineError = ''; renderMine();
  try {
    await live.endOwnedBookingEarly(booking.id, end);
    mineBusy = false; mineStep = {view:'list'};
    announce(`Ended at ${mineTime(end)}. The rest of your time is open for others.`);
    renderMine(true);
  } catch (error) {
    mineBusy = false; mineError = error?.message || 'That reservation could not end early. Please try again.'; renderMine(true);
  }
}
function render() { renderDays(); renderResources(); renderSchedule(); renderConnection(); }

function openBooking(preset) {
  if (!isReady()) return;
  returnFocus = document.activeElement;
  const day = days[dayIndex];
  draft = {day:day.key, dayInfo:day, type:preset ? type : null, unit:preset ? preset.unit : null,
    start:preset ? preset.start : null, end:null, purpose:null, purposeOther:'', reservedFor:'', name:localStorage.getItem('srs-name') || '', locked:Boolean(preset), override:false};
  history = []; draftError = ''; step = preset ? 'purpose' : 'resource';
  renderStep(false); $('#bookingDialog').showModal(); updateDialogConnection();
  requestAnimationFrame(() => $('#stepTitle').focus());
}
function closeBooking() {
  if (saving) return;
  $('#bookingDialog').close();
  if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  else $('#reserve').focus({preventScroll:true});
}
function go(next) { history.push(step); step = next; draftError = ''; renderStep(); }
function goBack() { if (!history.length || saving) return; step = history.pop(); draftError = ''; renderStep(); }
function crumb() {
  return dateLabel(draftDay()) + (draft.type ? ' · ' + types[draft.type].single + (draft.unit ? ' ' + draft.unit : '') : '') + (draft.start !== null ? ' · ' + fmt(draft.start) : '');
}
function frame(title, hint, content) {
  return `<p class="crumb">${esc(crumb())}</p><h2 id="stepTitle" class="step-title" tabindex="-1">${title}</h2><p class="step-hint" id="stepHint">${hint}</p>${content}<p id="draftError" class="validation form-error" role="alert">${esc(draftError)}</p>`;
}
function receipt() {
  const unit = draft.unit && !(draft.override && !draft.locked) ? ` ${draft.unit}` : '';
  const overrideNote = draft.override ? `<div class="priority-note" role="note"><b>${priorityOverrideLabel}</b><span>This time replaces a lower-priority reservation.</span></div>` : '';
  return `<div class="receipt"><h3 class="receipt-unit">${types[draft.type].single}${unit}</h3>${overrideNote}<div class="receipt-row"><span>Day</span><b>${esc(dateLabel(draftDay()))}</b></div><div class="receipt-row"><span>Time</span><b>${fmt(draft.start)} to ${fmt(draft.end)}<br>${duration(draft.start, draft.end)}</b></div><div class="receipt-row"><span>Purpose</span><b>${purposes[draft.purpose].label}</b></div><div class="receipt-row"><span>Name</span><b>${esc(draft.name)}</b></div><div class="receipt-row"><span>${esc(reservedForLabels[draft.purpose])}</span><b>${esc(draft.reservedFor)}</b></div></div>`;
}
function renderStep(focus = true) {
  let content = '';
  $('#back').style.visibility = history.length && step !== 'success' ? 'visible' : 'hidden';
  $('#stepCounter').textContent = step === 'success' ? connection.demo ? 'Demo reservation added' : 'Reservation confirmed' : connection.demo ? 'Your demo reservation' : 'Your reservation';
  if (step === 'resource') content = frame('What would you like to reserve?', 'Select a resource.', `<div class="choice-list">${Object.entries(types).map(([key, resource]) => `<button class="choice" type="button" data-pick-resource="${key}"><span class="choice-icon">${icons[key]}</span><span class="choice-copy"><b>${resource.label}</b><small>${resource.count} spaces to choose from</small></span><span class="next" aria-hidden="true">&#8250;</span></button>`).join('')}</div>`);
  if (step === 'purpose') content = frame('What is this reservation for?', draft.locked ? 'Your exact space and start time are selected.' : 'Select a purpose.', `<div class="choice-list">${Object.entries(purposes).map(([key, purpose]) => `<button type="button" class="choice purpose-choice ${key}" data-purpose="${key}"><span class="choice-copy"><b>${purpose.label}</b>${purpose.hint ? `<small>${purpose.hint}</small>` : ''}</span><span class="next" aria-hidden="true">&#8250;</span></button>`).join('')}</div>`);
  if (step === 'reservedFor') {
    const label = reservedForLabels[draft.purpose] || 'Reserved for';
    const title = draft.purpose === 'other' ? 'What is this for?' : 'Who is this for?';
    const hint = draft.purpose === 'other' ? 'Add a short purpose for this reservation.' : 'Add the person this reservation is for.';
    content = frame(title, hint, `<form id="nameForm"><label class="field-label" for="guestName">Your name</label><input id="guestName" name="name" autocomplete="name" maxlength="120" required value="${esc(draft.name)}"><label class="field-label" for="reservedFor">${label}</label><input id="reservedFor" name="reservedFor" autocomplete="off" maxlength="120" required value="${esc(draft.reservedFor)}" aria-describedby="nameHelp nameError"><p class="field-help" id="nameHelp">Only the shared public name and purpose appear on the schedule.</p><p class="validation" id="nameError" role="alert"></p><button type="submit" class="primary wide">Continue <span aria-hidden="true">&#8594;</span></button></form>`);
  }
  if (step === 'start') {
    const starts = startOptions();
    const groups = [['Morning',600,720],['Afternoon',720,1020],['Evening',1020,1380]].map(([label, start, end]) => {
      const list = starts.filter(option => option.start >= start && option.start < end);
      return list.length ? `<h3 class="group-label">${label}</h3><div class="chips">${list.map(option => `<button type="button" class="chip${option.override ? ' override-option' : ''}" data-pick-start="${option.start}"${option.override ? ` aria-label="${fmt(option.start)}, ${priorityOverrideLabel}"` : ''}>${fmt(option.start)}${option.override ? `<span class="override-label">${priorityOverrideLabel}</span>` : ''}</button>`).join('')}</div>` : '';
    }).join('');
    content = frame('When shall we begin?', 'Open times are shown. Times marked Priority override can replace a lower-priority reservation. Service times are set aside.', groups || `<p class="step-hint">${draftReady() ? 'This resource is full for the day. Close this sheet to try another day.' : 'Times will appear when availability is confirmed.'}</p>`);
  }
  if (step === 'end') {
    const ends = endOptions();
    content = frame('And when will you finish?', 'Choose an ending that keeps your whole visit in one space and clear of services. Priority override marks a lower-priority reservation.', `<div class="chips">${ends.map(option => `<button type="button" class="chip${option.override ? ' override-option' : ''}" data-end="${option.end}"${option.override ? ` aria-label="${fmt(draft.start)} to ${fmt(option.end)}, ${priorityOverrideLabel}"` : ''}>${fmt(option.end)}<small>${duration(draft.start, option.end)}</small>${option.override ? `<span class="override-label">${priorityOverrideLabel}</span>` : ''}</button>`).join('')}</div>${ends.length ? '' : `<p class="step-hint">${draftReady() ? 'This time is no longer available. Close this sheet to choose another open time.' : 'Endings will appear when availability is confirmed.'}</p>`}`);
  }
  if (step === 'confirm') content = frame('Review your reservation.', connection.demo ? 'Confirm this demo reservation to see it on the schedule.' : 'Your space is reserved after you confirm and the save completes.', receipt() + `<button type="button" class="primary wide" id="confirm">${connection.demo ? 'Confirm demo reservation' : 'Confirm reservation'}</button>${connection.demo ? '<p class="field-help">Demo mode. This does not reserve a real resource.</p>' : ''}`);
  if (step === 'success') content = `<div class="success"><div class="seal"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg></div><h2 class="step-title" id="stepTitle" tabindex="-1">Reservation confirmed.</h2><p class="step-hint" id="stepHint">${connection.demo ? 'Your demo reservation has been added.' : 'Your reservation is confirmed.'}</p><p class="success-details"><strong>${types[draft.type].single} ${draft.unit}</strong><br>${esc(dateLabel(draftDay()))}<br>${fmt(draft.start)} to ${fmt(draft.end)}</p><button type="button" class="primary wide" id="seeReservation">See it on the schedule <span aria-hidden="true">&#8594;</span></button><button type="button" class="quiet-button" id="reserveAnother">Make another reservation</button>${connection.demo ? '<p class="field-help">Demo mode. This is a simulated reservation.</p>' : '<a class="saved-link" href="?view=mine" id="mineFromSuccess">Manage my reservations</a>'}</div>`;
  $('#sheetBody').innerHTML = content;
  $('#bookingDialog').scrollTop = 0;
  updateDialogConnection();
  if (focus) requestAnimationFrame(() => $('#stepTitle')?.focus({preventScroll:true}));
}
function showDraftError(message) {
  draftError = message;
  if ($('#draftError')) $('#draftError').textContent = message;
}
async function save() {
  if (saving) return;
  if (!draftReady()) { showDraftError('Reconnect and confirm availability before reserving. Your details are still here.'); updateDialogConnection(); return; }
  if (!visibleText(draft.name) || !visibleText(draft.reservedFor)) { showDraftError('Add your name and the reserved-for detail before confirming.'); return; }
  const selected = rangeAvailability(draftDay(), draft.type, draft.start, draft.end, draft.purpose, draft.locked ? draft.unit : null);
  if (!selected || selected.override !== Boolean(draft.override)) {
    showDraftError(selected ? 'Availability changed. Please go back and review this time again.' : 'This time is no longer available for the whole visit. Go back to choose another ending, or close this sheet to choose a different space.');
    return;
  }
  draft.unit = selected.unit; draft.override = selected.override;
  if (draft.purpose === 'other' && !draft.purposeOther.trim()) { showDraftError('Add reservation details for Other before confirming.'); return; }
  saving = true; showDraftError(''); updateDialogConnection();
  try {
    const submittedUnit = draft.unit;
    const saved = await submit({day:draft.day, type:draft.type, unit:submittedUnit, start:draft.start, end:draft.end,
      name:(draft.name || draft.reservedFor).trim(), reservedFor:draft.reservedFor.trim(), purpose:draft.purpose,
      purposeOther:draft.purpose === 'other' ? draft.reservedFor.trim() : ''});
    const booking = normalizeBooking(saved);
    const existing = bookings.findIndex(item => item.key === booking.key);
    if (existing === -1) bookings.push(booking); else bookings[existing] = booking;
    lastBooking = booking;
    draft.type = booking.type; draft.unit = booking.unit; draft.start = booking.start; draft.end = booking.end;
    type = booking.type;
    const selected = days.findIndex(day => day.key === booking.day);
    if (selected !== -1) dayIndex = selected;
    saving = false; render();
    $('#status').textContent = `${connection.demo ? 'Demo reservation added' : 'Reservation confirmed'}: ${types[booking.type].single} ${booking.unit}, ${fmt(booking.start)} to ${fmt(booking.end)}.`;
    go('success');
  } catch (error) {
    saving = false;
    showDraftError(error?.message || 'Your reservation was not saved. Please try again. Your details are still here.');
    updateDialogConnection();
  }
}

$('#days').addEventListener('click', event => {
  const button = event.target.closest('[data-day]');
  if (!button || saving) return;
  dayIndex = Number(button.dataset.day); $('#status').textContent = ''; render();
  $('#days').querySelector(`[data-day="${dayIndex}"]`)?.focus({preventScroll:true});
});
$('#resources').addEventListener('click', event => {
  const button = event.target.closest('[data-resource]');
  if (!button || saving) return;
  type = button.dataset.resource; $('#status').textContent = ''; renderResources(); renderSchedule();
  $('#resources').querySelector(`[data-resource="${type}"]`)?.focus({preventScroll:true});
});
$('#schedule').addEventListener('click', event => {
  const bookingButton = event.target.closest('[data-booking]');
  if (bookingButton) {
    const booking = bookings.find(item => item.key === bookingButton.dataset.booking);
    if (booking) renderDetail(booking, true);
    return;
  }
  const button = event.target.closest('[data-unit][data-start]');
  if (button && !button.disabled && isReady()) openBooking({unit:Number(button.dataset.unit), start:Number(button.dataset.start)});
});
document.addEventListener('click', event => { if (event.target.closest('[data-retry]')) retry(); });
$('#reserve').addEventListener('click', () => openBooking());
$('#close').addEventListener('click', closeBooking);
$('#back').addEventListener('click', goBack);
$('#bookingDialog').addEventListener('cancel', event => { event.preventDefault(); closeBooking(); });
$('#bookingDialog').addEventListener('click', event => {
  if (event.target !== $('#bookingDialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeBooking();
});
$('#bookingDialog').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const focusable = [...$('#bookingDialog').querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement.id === 'stepTitle')) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$('#detailClose').addEventListener('click', closeDetail);
$('#detailDialog').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
$('#detailDialog').addEventListener('click', event => {
  if (event.target !== $('#detailDialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetail();
});
$('#detailBody').addEventListener('click', event => {
  const action = event.target.closest('[data-detail-action]')?.dataset.detailAction;
  if (action) runDetailAction(action);
});
$('#mineLink').addEventListener('click', event => { event.preventDefault(); openMine(); });
$('#mineClose').addEventListener('click', () => closeMine());
$('#mineBack').addEventListener('click', mineBack);
$('#mineDialog').addEventListener('cancel', event => { event.preventDefault(); if (mineStep.view === 'list') closeMine(); else mineBack(); });
$('#mineDialog').addEventListener('click', event => {
  if (event.target !== $('#mineDialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMine();
});
$('#mineBody').addEventListener('click', event => {
  if (event.target.closest('[data-retry]')) return;
  if (event.target.closest('#mineStepBack')) { mineBack(); return; }
  if (event.target.closest('#mineReserve') || event.target.closest('[data-mine-rebook]')) { closeMine(); openBooking(); return; }
  if (mineBusy) return;
  const cancel = event.target.closest('[data-mine-cancel]');
  if (cancel) { mineStep = {view:'cancel', bookingId:cancel.dataset.mineCancel}; mineError = ''; renderMine(true); return; }
  const endEarly = event.target.closest('[data-mine-end-early]');
  if (endEarly) { mineStep = {view:'end-early', bookingId:endEarly.dataset.mineEndEarly}; mineError = ''; renderMine(true); return; }
  const choice = event.target.closest('[data-mine-end]');
  if (choice) { mineStep = {view:'end-confirm', bookingId:mineStep.bookingId, end:choice.dataset.mineEnd}; mineError = ''; renderMine(true); return; }
  if (event.target.closest('#mineCancelConfirm')) { runMineCancel(); return; }
  if (event.target.closest('#mineEndConfirm')) runMineEndEarly();
});
addEventListener('popstate', () => {
  const wants = new URLSearchParams(location.search).get('view') === 'mine';
  if (wants && !$('#mineDialog').open) openMine({view:'list'}, false);
  else if (!wants && $('#mineDialog').open) closeMine(false);
});
$('#sheetBody').addEventListener('click', event => {
  if (event.target.closest('#mineFromSuccess')) { event.preventDefault(); closeBooking(); openMine(); return; }
  if (saving) return;
  if (event.target.closest('#seeReservation')) {
    closeBooking();
    const element = document.getElementById(lastBooking?.id);
    if (element) { element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'center'}); element.focus({preventScroll:true}); }
    return;
  }
  if (event.target.closest('#reserveAnother')) { closeBooking(); openBooking(); return; }
  if (!draftReady()) { updateDialogConnection(); return; }
  const resource = event.target.closest('[data-pick-resource]');
  if (resource) { draft.type = resource.dataset.pickResource; draft.unit = null; draft.start = null; draft.end = null; go('purpose'); return; }
  const purpose = event.target.closest('[data-purpose]');
  if (purpose) { draft.purpose = purpose.dataset.purpose; draft.override = false; if (!draft.locked) draft.unit = null; draft.purposeOther = ''; go(draft.locked ? 'end' : 'start'); return; }
  const start = event.target.closest('[data-pick-start]');
  if (start) { draft.start = Number(start.dataset.pickStart); draft.end = null; draft.unit = null; draft.override = false; go('end'); return; }
  const end = event.target.closest('[data-end]');
  if (end) {
    const ending = Number(end.dataset.end);
    const option = endOptions().find(candidate => candidate.end === ending);
    if (!option) { showDraftError('Availability changed. Please choose an available ending.'); return; }
    draft.end = ending;
    draft.unit = option.unit; draft.override = option.override;
    go('reservedFor'); return;
  }
  if (event.target.closest('#confirm')) save();
});
$('#sheetBody').addEventListener('submit', event => {
  if (event.target.id !== 'nameForm') return;
  event.preventDefault();
  if (!draftReady() || saving) { updateDialogConnection(); return; }
  const field = $('#guestName'), reserved = $('#reservedFor'), value = field.value.trim(), reservedValue = reserved.value.trim();
  if (!visibleText(value) || !visibleText(reservedValue)) { $('#nameError').textContent = 'Add your name and the reserved-for detail to continue.'; reserved.setAttribute('aria-invalid','true'); reserved.focus(); return; }
  draft.name = value; draft.reservedFor = reservedValue; draft.purposeOther = draft.purpose === 'other' ? reservedValue : ''; go('confirm');
});
$('#sheetBody').addEventListener('input', event => {
  if (event.target.id === 'guestName') draft.name = event.target.value;
  if (event.target.id === 'reservedFor') { draft.reservedFor = event.target.value; draft.purposeOther = draft.purpose === 'other' ? event.target.value : ''; }
  if (event.target.id === 'guestName' || event.target.id === 'reservedFor') { event.target.removeAttribute('aria-invalid'); $('#nameError').textContent = ''; }
});

render();
subscribe(snapshot => {
  const selectedDay = days[dayIndex]?.key;
  const openDetailKey = detailBooking?.key;
  connection = {status:snapshot.status, canBook:Boolean(snapshot.canBook), demo:Boolean(snapshot.demo), error:snapshot.error || ''};
  days = (snapshot.days || []).map(normalizeDay);
  const selected = days.findIndex(day => day.key === selectedDay);
  dayIndex = selected === -1 ? 0 : selected;
  myReservations = (Array.isArray(snapshot.myBookings) ? snapshot.myBookings : []).filter(booking => booking && typeof booking.id === 'string' && booking.id);
  bookings = (snapshot.bookings || []).map(normalizeBooking);
  render();
  renderMine();
  if ($('#detailDialog').open && openDetailKey) {
    const updated = bookings.find(item => item.key === openDetailKey);
    if (updated) renderDetail(updated);
    else closeDetail();
  }
  if ($('#bookingDialog').open && ['start','end'].includes(step) && !saving) {
    const focused = document.activeElement;
    const focusType = focused?.hasAttribute('data-pick-start') ? 'data-pick-start' : focused?.hasAttribute('data-end') ? 'data-end' : null;
    const focusValue = focusType ? focused.getAttribute(focusType) : null;
    renderStep(false);
    if (focusType) ($('#sheetBody').querySelector(`[${focusType}="${focusValue}"]`) || $('#stepTitle')).focus({preventScroll:true});
  }
});
if (new URLSearchParams(location.search).get('view') === 'mine') openMine({view:'list'}, false);
