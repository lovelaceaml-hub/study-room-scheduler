import { subscribe, submit, retry } from '../shared/live.js';
import { overrideUnitForRange } from '../shared/model.js';

const TYPES = {
  room: { label: 'Study Room', short: 'Room', plural: 'Study Rooms', count: 4, icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21V3M15 12h1"/>' },
  whiteboard: { label: 'Whiteboard', short: 'Board', plural: 'Whiteboards', count: 5, icon: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="m8 21 2-5m6 5-2-5M7 8h10M7 11h6"/>' },
  tv: { label: 'TV', short: 'TV', plural: 'TVs', count: 3, icon: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>' }
};
const OPEN = 600;
const CLOSE = 1380;
const STARTS = Array.from({ length: (CLOSE - OPEN) / 30 }, (_, index) => OPEN + index * 30);
const $ = selector => document.querySelector(selector);
const dialog = $('#sheet');
const body = $('#body');
const detailDialog = $('#bookingDetails');
const detailBody = $('#detailBody');
let detailReturnFocus = null;
let snapshot = { status: 'loading', canBook: false, demo: false, error: '', days: [], bookings: [] };
let selectedDay = '';
let type = 'room';
let step = 'resource';
let history = [];
let draft = {};
let saving = false;
let saved = null;
let returnFocus = null;
let formError = '';

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function publicNameFor(booking) {
  // The current live projection calls its already-public-safe label `name`.
  const projected = [booking?.publicName, booking?.displayName, booking?.name].find(value => typeof value === 'string' && hasVisibleText(value))?.trim() || '';
  return hasVisibleText(projected) ? projected : 'Reserved';
}
function bookingKeyFor(booking, day = booking?.day, resource = booking?.type, unit = booking?.unit) {
  const key = booking?.key ?? booking?.id;
  return String(key || `${day || ''}-${resource || ''}-${unit || ''}-${booking?.start ?? ''}-${booking?.end ?? ''}`);
}
function ownerDetailFor(booking) {
  const detail = booking?.ownerDetail && typeof booking.ownerDetail === 'object'
    ? booking.ownerDetail
    : booking?.ownerDetails && typeof booking.ownerDetails === 'object' ? booking.ownerDetails
      : booking?.owner && typeof booking.owner === 'object' ? booking.owner : null;
  if (!detail || (detail.authorized !== true && detail.ownerAuthorized !== true)) return null;
  const actions = detail.actions && typeof detail.actions === 'object' ? detail.actions : {};
  const allowed = (...names) => names.some(name => detail[name] === true || actions[name] === true || actions[name]?.allowed === true);
  const reservedFor = typeof detail.reservedFor === 'string' && hasVisibleText(detail.reservedFor) ? detail.reservedFor.trim() : '';
  const name = typeof detail.name === 'string' && hasVisibleText(detail.name) ? detail.name.trim() : typeof detail.displayName === 'string' && hasVisibleText(detail.displayName) ? detail.displayName.trim() : '';
  return { name, reservedFor, canEndEarly: allowed('canEndEarly', 'endEarly', 'end'), canCancel: allowed('canCancel', 'cancel') };
}
function detailActionMarkup(detail) {
  if (!detail || (!detail.canEndEarly && !detail.canCancel)) return '';
  const actions = [];
  if (detail.canEndEarly) actions.push('<a class="detailAction" href="/?classic=1&amp;tab=mine">End early</a>');
  if (detail.canCancel) actions.push('<a class="detailAction danger" href="/?classic=1&amp;tab=mine">Cancel</a>');
  return `<div class="detailActions"><p>Use My reservations to complete an authorized action.</p><div>${actions.join('')}</div></div>`;
}
function showBookingDetails(booking, trigger) {
  if (!detailDialog || !booking) return;
  const resource = TYPES[booking.type]?.label || 'Resource';
  const blocked = booking.blocked === true || booking.purpose === 'blocked';
  const purpose = blocked ? 'Reserved' : purposeLabel(booking.purpose);
  const detail = ownerDetailFor(booking);
  const publicName = blocked ? 'Reserved' : publicNameFor(booking);
  const ownerRow = `<div class="detailRow"><span>Reserved</span><b>${escapeHTML(detail?.name || publicName)}</b></div>${(detail?.reservedFor || booking.reservedFor) ? `<div class="detailRow"><span>Reserved for</span><b>${escapeHTML(detail?.reservedFor || booking.reservedFor)}</b></div>` : ''}`;
  detailBody.innerHTML = `<div class="detailContent"><h2 id="detailTitle">${escapeHTML(publicName)}</h2><p id="detailDescription" class="detailHint">${escapeHTML(resource)} ${escapeHTML(booking.unit)} · ${escapeHTML(dayLabel(booking.day))}</p><div class="detailSummary"><div class="detailRow"><span>Reservation</span><b>${timeLabel(booking.start)} to ${timeLabel(booking.end)}</b></div><div class="detailRow"><span>Purpose</span><b>${escapeHTML(purpose)}</b></div>${ownerRow}</div>${detailActionMarkup(detail)}</div>`;
  detailReturnFocus = trigger;
  detailDialog.showModal();
  $('#detailTitle')?.focus({ preventScroll: true });
}
function closeBookingDetails() {
  if (detailDialog?.open) detailDialog.close();
}
function timeLabel(minutes, compact = false) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour % 12 || 12}${compact && minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`} ${hour < 12 ? 'AM' : 'PM'}`;
}
function purposeLabel(purpose) {
  return purpose === 'contact' ? 'Contact' : purpose === 'new' ? 'New Member' : 'Other';
}
function dayInfo(key = selectedDay) {
  return snapshot.days.find(day => day.key === key);
}
function dayLabel(key = selectedDay) {
  return dayInfo(key)?.label || key;
}
function serviceBlocks(key) {
  const weekday = dayInfo(key)?.weekday ?? new Date(`${key}T12:00:00Z`).getUTCDay();
  return weekday === 6 ? [[600, 660], [870, 930], [1170, 1230]] : weekday === 2 ? [[1170, 1230]] : [[OPEN, CLOSE]];
}
function overlaps(start, end, otherStart, otherEnd) {
  return start < otherEnd && otherStart < end;
}
function serviceAt(key, start, end) {
  return serviceBlocks(key).find(([a, b]) => overlaps(start, end, a, b));
}
function matchingBookings(key, resource, unit, start, end) {
  return snapshot.bookings.filter(booking => booking.day === key && booking.type === resource && booking.unit === unit && overlaps(start, end, booking.start, booking.end));
}
function freeUnits(key, resource, start, end, unit = null) {
  if (!dayInfo(key) || !TYPES[resource] || !Number.isInteger(start) || !Number.isInteger(end) || start % 30 || end % 30 || start < OPEN || end > CLOSE || start >= end || serviceAt(key, start, end)) return [];
  const units = unit === null ? Array.from({ length: TYPES[resource].count }, (_, index) => index + 1) : [unit];
  return units.filter(number => Number.isInteger(number) && number > 0 && number <= TYPES[resource].count && !matchingBookings(key, resource, number, start, end).length);
}
function rangeAvailability(start, end) {
  const free = freeUnits(draft.day, draft.type, start, end, draft.unit);
  const overrideUnit = !free.length && ['contact', 'new'].includes(draft.purpose) && !serviceAt(draft.day, start, end)
    ? overrideUnitForRange(draft.type, draft.day, start, end, draft.purpose, snapshot.bookings, draft.unit)
    : null;
  return { free, overrideUnit };
}
function selectableRange(start, end) {
  const { free, overrideUnit } = rangeAvailability(start, end);
  return free.length > 0 || Boolean(overrideUnit);
}
function availableStarts() {
  return STARTS.filter(start => selectableRange(start, start + 30));
}
function availableEnds() {
  if (!Number.isInteger(draft.start)) return [];
  const ends = [];
  for (let end = draft.start + 30; end <= CLOSE; end += 30) {
    const { free, overrideUnit } = rangeAvailability(draft.start, end);
    if (!free.length && !overrideUnit) break;
    ends.push(end);
  }
  return ends;
}
function canBook() {
  return Boolean(snapshot.canBook && dayInfo(selectedDay));
}
function selectedResource() {
  if (!TYPES[draft.type]) return '';
  return draft.unit === null ? `Any available ${TYPES[draft.type].label.toLowerCase()}` : `${TYPES[draft.type].label} ${draft.unit}`;
}
function setError(message, focus = true) {
  formError = message;
  const element = $('#dialogError');
  element.textContent = message;
  element.classList.toggle('hidden', !message);
  if (message && focus) element.focus({ preventScroll: false });
}
function resetError() {
  setError('', false);
}
function renderConnection() {
  const mode = snapshot.demo ? 'demo' : snapshot.status;
  const labels = { loading: 'Connecting to the live schedule', live: 'Live schedule', offline: 'Offline, reconnect to reserve', error: 'Schedule unavailable', demo: 'Sample schedule' };
  $('#connection').className = `connection ${mode}`;
  $('#statusText').textContent = labels[mode] || 'Connecting to the live schedule';
  $('#retry').classList.toggle('hidden', !['offline', 'error'].includes(snapshot.status));
  const detail = snapshot.demo ? 'Sample reservations stay in this preview.' : snapshot.error || '';
  $('#connectionDetail').textContent = detail;
  $('#connectionDetail').classList.toggle('hidden', !detail);
  $('#reserve').disabled = !canBook();
  if (dialog.open) updateDialogConnection();
}
function renderDays() {
  $('#daypick').innerHTML = snapshot.days.map(day => `<button class="day${day.key === selectedDay ? ' on' : ''}" type="button" data-day="${escapeHTML(day.key)}" aria-pressed="${day.key === selectedDay}"><strong>${escapeHTML(day.label)}</strong>${day.weekday === 6 ? 'Primary service day' : 'Midweek availability'}</button>`).join('');
}
function renderMeters() {
  $('#snapLabel').textContent = dayInfo()?.label.split(',')[0] || 'Connecting';
  document.querySelectorAll('.meter').forEach(button => {
    const resource = button.dataset.type;
    const hasDay = Boolean(dayInfo());
    const count = hasDay ? Array.from({ length: TYPES[resource].count }, (_, index) => index + 1).filter(unit => STARTS.some(start => freeUnits(selectedDay, resource, start, start + 30, unit).length)).length : 0;
    button.classList.toggle('on', resource === type);
    button.setAttribute('aria-pressed', String(resource === type));
    button.querySelector('b').textContent = hasDay && canBook() ? String(count) : '...';
    button.querySelector('em').textContent = hasDay && canBook() ? `of ${TYPES[resource].count} with open time` : 'Checking availability';
    button.setAttribute('aria-label', `${TYPES[resource].plural}${hasDay && canBook() ? `, ${count} of ${TYPES[resource].count} have open time on ${dayLabel()}` : ''}`);
  });
}
function renderSchedule() {
  $('#listTitle').textContent = TYPES[type].plural;
  $('#schedule').setAttribute('aria-busy', String(snapshot.status === 'loading'));
  if (!dayInfo()) {
    $('#scheduleHint').textContent = 'The complete day appears here when connected.';
    $('#schedule').innerHTML = `<div class="emptyState">${snapshot.status === 'loading' ? 'Connecting to the schedule...' : 'No reservation days are available. Try connecting again.'}</div>`;
    return;
  }
  $('#scheduleHint').textContent = `${dayLabel()}. Each card is 30 minutes. ${canBook() ? 'Tap an open card to reserve that unit.' : 'Reconnect before choosing a time.'}`;
  const units = Array.from({ length: TYPES[type].count }, (_, index) => index + 1);
  const heads = units.map(unit => `<div class="laneHead"><b>${unit}</b>${TYPES[type].short}</div>`).join('');
  const rows = STARTS.map((start, index) => {
    const end = start + 30;
    const block = serviceAt(selectedDay, start, end);
    const rail = `<div class="timeRail${start % 60 === 0 ? ' hasHour' : ''}" aria-hidden="true">${start % 60 === 0 ? `<span class="hourMark">${timeLabel(start, true)}</span>` : ''}${end === CLOSE ? `<span class="hourEnd">${timeLabel(CLOSE, true)}</span>` : ''}</div>`;
    const cells = block ? `<div class="serviceBand${start !== block[0] ? ' continued' : ''}" aria-label="Service, ${timeLabel(start)} to ${timeLabel(end)}, all ${TYPES[type].plural.toLowerCase()} unavailable"><strong>Service</strong><span>Reservations pause during service</span></div>` : units.map(unit => {
      const records = matchingBookings(selectedDay, type, unit, start, end);
      const booking = records.find(item => item.blocked || item.purpose === 'blocked') || records[0];
      const room = `${TYPES[type].short} ${unit}`;
      const range = `${TYPES[type].label} ${unit}, ${timeLabel(start)} to ${timeLabel(end)}`;
      if (booking) {
        const blocked = booking.blocked || booking.purpose === 'blocked';
        const purpose = ['contact', 'new', 'other'].includes(booking.purpose) ? booking.purpose : 'other';
        const name = blocked ? 'Reserved' : publicNameFor(booking);
        const startsHere = start <= booking.start;
        const label = startsHere ? (blocked ? `${range}, Reserved` : `${range}, ${name}, ${purposeLabel(purpose)}`) : `${range}, reservation continues`;
        const continuation = startsHere ? `<span class="slotRoom">${room}</span><span class="slotName">${escapeHTML(name)}</span>${blocked ? '' : `<span class="slotPurpose">${purposeLabel(purpose)}</span>`}` : '<span class="slotContinuation" aria-hidden="true"></span>';
        return `<button class="roomSlot ${blocked ? 'reserved' : `booked ${purpose}`} ${bookingSegmentClass(booking, start, end)}" type="button" data-booking-key="${escapeHTML(bookingKeyFor(booking, selectedDay, type, unit))}" aria-haspopup="dialog" aria-label="${escapeHTML(label)}">${continuation}</button>`;
      }
      if (!canBook()) return `<div class="roomSlot unavailable" aria-label="${escapeHTML(range)}, availability unconfirmed"><span class="slotRoom">${room}</span><span class="slotOpen">Checking</span></div>`;
      return `<button class="roomSlot open" type="button" data-unit="${unit}" data-start="${start}" aria-label="${escapeHTML(range)}, open, reserve this unit"><span class="slotRoom">${room}</span><span class="slotOpen">Open</span></button>`;
    }).join('');
    return `<section class="timeBlock${index % 4 < 2 ? ' hourGroup' : ''}" data-time="${start}">${rail}${cells}</section>`;
  }).join('');
  $('#schedule').innerHTML = `<div class="scheduleCanvas" data-type="${type}" style="--units:${units.length}"><div class="scheduleHead"><div class="laneHead">Time</div>${heads}</div>${rows}</div>`;
}
function renderView() {
  renderConnection();
  renderDays();
  renderMeters();
  renderSchedule();
}
function setType(next) {
  if (!TYPES[next]) return;
  type = next;
  renderMeters();
  renderSchedule();
}
function bookingSegmentClass(booking, start, end) {
  const startsHere = start <= booking.start;
  const endsHere = end >= booking.end;
  return ['bookingPart', startsHere ? 'bookingStart' : 'bookingContinue', endsHere ? 'bookingEnd' : 'bookingMiddle'].join(' ');
}
function updateDialogConnection() {
  const message = $('#dialogStatus');
  const disconnected = !snapshot.canBook || !dayInfo(draft.day);
  message.classList.toggle('hidden', !disconnected || step === 'success');
  if (disconnected && step !== 'success') {
    message.innerHTML = 'The connection is unavailable. Your details are still here. Reconnect to confirm.<button class="linkButton" type="button" data-retry>Reconnect</button>';
  } else message.textContent = '';
  const confirm = $('#confirm');
  if (confirm) confirm.disabled = saving || disconnected;
}
function openSheet(selection = null, trigger = $('#reserve')) {
  if (!canBook()) return;
  if (selection && !freeUnits(selectedDay, selection.type, selection.start, selection.start + 30, selection.unit).length) return;
  returnFocus = trigger;
  draft = { day: selectedDay, type: selection?.type || null, unit: selection?.unit ?? null, start: selection?.start ?? null, end: null, purpose: null, purposeOther: '', name: localStorage.getItem('srs-name') || '', reservedFor: '', direct: Boolean(selection) };
  step = selection ? 'purpose' : 'resource';
  history = [];
  saved = null;
  resetError();
  renderStep(false);
  dialog.showModal();
  $('#stepTitle')?.focus({ preventScroll: true });
}
function closeSheet() {
  if (!saving) dialog.close();
}
function nextStep(next) {
  if (saving) return;
  history.push(step);
  step = next;
  resetError();
  renderStep();
}
function previousStep() {
  if (saving || step === 'success') return;
  if (!history.length) return closeSheet();
  step = history.pop();
  resetError();
  renderStep();
}
function heading(title, hint) {
  return `<h2 id="stepTitle" tabindex="-1">${title}</h2><p class="hint">${hint}</p>`;
}
function timeChip(kind, value, rangeStart, rangeEnd) {
  const { free, overrideUnit } = rangeAvailability(rangeStart, rangeEnd);
  const override = !free.length && Boolean(overrideUnit);
  const selected = draft[kind] === value;
  const accessible = `${timeLabel(value)}${override ? ', Priority override, may replace a lower-priority reservation' : ''}`;
  const marker = override
    ? `<span class="chipTime">${timeLabel(value)}</span><span class="chipBadge" aria-hidden="true">Priority override</span>`
    : timeLabel(value);
  return `<button class="chip${selected ? ' on' : ''}${override ? ' override' : ''}" type="button" data-${kind}="${value}" aria-label="${escapeHTML(accessible)}">${marker}</button>`;
}
function overrideNotice(start, end) {
  const { free, overrideUnit } = rangeAvailability(start, end);
  if (free.length || !overrideUnit) return '';
  return '<div class="overrideNotice" role="note"><strong>Priority override</strong><span>This range is held by a lower-priority reservation and may replace it.</span></div>';
}
function summaryRows(booking = draft) {
  const purpose = purposeLabel(booking.purpose);
  const reservedForLabel = booking.purpose === 'contact' ? 'Contact Name' : booking.purpose === 'new' ? 'Member Name' : 'Purpose';
  const reservedFor = booking.reservedFor || (booking === draft && booking.purpose === 'other' ? booking.purposeOther : '');
  return `<div class="sumrow"><span>Day</span><b>${escapeHTML(dayLabel(booking.day))}</b></div><div class="sumrow"><span>Purpose</span><b>${escapeHTML(purpose)}</b></div><div class="sumrow"><span>Time</span><b>${timeLabel(booking.start)} to ${timeLabel(booking.end)}</b></div><div class="sumrow"><span>Name</span><b>${escapeHTML(booking.name || '')}</b></div><div class="sumrow"><span>${reservedForLabel}</span><b>${escapeHTML(reservedFor)}</b></div>`;
}
function renderStep(focus = true) {
  const progressSteps = draft.direct ? ['purpose', 'end', 'reservedFor', 'confirm'] : ['resource', 'purpose', 'start', 'end', 'reservedFor', 'confirm'];
  const current = step;
  $('#progress').innerHTML = progressSteps.map(item => `<i class="${item === current ? 'on' : ''}"></i>`).join('');
  $('#progress').classList.toggle('hidden', step === 'success');
  $('#back').disabled = saving || step === 'success';
  $('#close').disabled = saving;
  let content = '';
  if (step === 'resource') {
    content = heading('What would you like to reserve?', `Choose a resource for ${escapeHTML(dayLabel(draft.day))}. We will show its available times.`) + `<div class="choices">${Object.entries(TYPES).map(([key, item]) => `<button class="choice" type="button" data-picktype="${key}"><span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">${item.icon}</svg></span><span><b>${item.label}</b><small>${item.count} ${key === 'room' ? 'study rooms' : key === 'tv' ? 'displays' : 'boards'}</small></span></button>`).join('')}</div>`;
  } else if (step === 'purpose') {
    content = heading(`What is ${draft.unit === null ? `this ${TYPES[draft.type].label.toLowerCase()}` : escapeHTML(selectedResource())} for?`, `Purpose determines reservation priority.${draft.start !== null ? ` Your start time is ${timeLabel(draft.start)}.` : ''}`) + '<div class="choices"><button class="choice priority contact" type="button" data-purpose="contact"><span class="ico" aria-hidden="true">1</span><span><b>Contact</b><small>Highest priority</small></span><span class="rank">1st priority</span></button><button class="choice priority new" type="button" data-purpose="new"><span class="ico" aria-hidden="true">2</span><span><b>New Member</b><small>Second priority</small></span><span class="rank">2nd priority</span></button><button class="choice priority other" type="button" data-purpose="other"><span class="ico" aria-hidden="true">3</span><span><b>Other</b><small>Tell us what it is for</small></span><span class="rank">Last priority</span></button></div>';
  } else if (step === 'start') {
    const starts = availableStarts();
    content = heading('When would you like to start?', `${escapeHTML(dayLabel(draft.day))}. ${draft.unit === null ? 'We will assign one unit that is free for your full reservation.' : `${escapeHTML(selectedResource())} stays selected.`}`) + (starts.length ? `<div class="chips">${starts.map(start => timeChip('start', start, start, start + 30)).join('')}</div>` : '<div class="emptyState">There are no open start times for this selection. Close this sheet to choose another day or unit.</div>');
  } else if (step === 'end') {
    const ends = availableEnds();
    content = heading('When would you like to end?', `Starting at ${timeLabel(draft.start)}. Every ending keeps ${draft.unit === null ? 'one unit' : escapeHTML(selectedResource())} free continuously, without crossing a service.`) + (ends.length ? `<div class="chips">${ends.map(end => timeChip('end', end, draft.start, end)).join('')}</div>` : '<div class="emptyState">This start time is no longer available. Choose another time to keep going.</div><button class="secondary" type="button" data-edit-time>Choose another time</button>');
  } else if (step === 'reservedFor') {
    const label = draft.purpose === 'contact' ? 'Contact Name' : draft.purpose === 'new' ? 'Member Name' : 'Purpose';
    const description = draft.purpose === 'other' ? 'Describe what this reservation is for.' : `Enter the ${label.toLowerCase()} for this reservation.`;
    const field = draft.purpose === 'other'
      ? `<textarea class="field" id="reservedFor" name="reservedFor" required maxlength="300" placeholder="What is the reservation for?">${escapeHTML(draft.reservedFor)}</textarea>`
      : `<input class="field" id="reservedFor" name="reservedFor" type="text" autocomplete="off" maxlength="100" required value="${escapeHTML(draft.reservedFor)}" placeholder="${escapeHTML(label)}">`;
    content = heading('Who or what is this for?', description) + `<form id="reservedForForm"><label class="fieldLabel" for="name">Your name</label><input class="field" id="name" name="name" type="text" autocomplete="name" maxlength="120" required value="${escapeHTML(draft.name)}"><label class="fieldLabel" for="reservedFor">${label}</label>${field}<button class="continue" type="submit">Review reservation</button></form>`;
  } else if (step === 'confirm') {
    content = heading('Confirm your reservation', snapshot.demo ? 'This sample reservation will stay in the preview.' : 'One final check before it goes on the schedule.') + `<div class="summary"><h3>${escapeHTML(selectedResource())}</h3>${summaryRows()}</div>${overrideNotice(draft.start, draft.end)}<button class="continue" id="confirm" type="button" ${saving || !snapshot.canBook ? 'disabled' : ''}>${saving ? 'Reserving...' : 'Confirm reservation'}</button><button class="secondary" type="button" data-edit-time ${saving ? 'disabled' : ''}>Change time</button>`;
  } else if (step === 'success') {
    const resource = `${TYPES[saved.type].label} ${saved.unit}`;
    content = `<div class="done"><div class="check" aria-hidden="true">&#10003;</div>${heading(snapshot.demo ? 'Your sample is reserved.' : 'You are reserved.', `${escapeHTML(resource)} is reserved from ${timeLabel(saved.start)} to ${timeLabel(saved.end)}.`)}<div class="summary"><h3>${escapeHTML(resource)}</h3>${summaryRows(saved)}</div><button class="continue" id="finish" type="button">Return to schedule</button></div>`;
  }
  body.innerHTML = `<div class="step" data-step="${step}">${content}</div>`;
  setError(formError, false);
  updateDialogConnection();
  if (focus) {
    $('#stepTitle')?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }
}
function hasVisibleText(value) {
  return value.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').length > 0;
}
async function confirmReservation() {
  if (saving) return;
  if (!snapshot.canBook || !dayInfo(draft.day)) return setError('Reconnect to confirm. Your reservation details are still here.');
  if (!['contact', 'new', 'other'].includes(draft.purpose) || !hasVisibleText(draft.name) || !hasVisibleText(draft.reservedFor)) return setError('Complete your name and the reserved-for field before confirming.');
  const availability = rangeAvailability(draft.start, draft.end);
  if (!availability.free.length && !availability.overrideUnit) return setError('This time is no longer available for the full reservation. Choose Change time to select another range.');
  saving = true;
  resetError();
  renderStep(false);
  try {
    const reservedFor = draft.reservedFor.trim();
    draft.unit = availability.overrideUnit ?? draft.unit;
    draft.override = Boolean(availability.overrideUnit);
    const result = await submit({ day: draft.day, type: draft.type, unit: draft.unit, start: draft.start, end: draft.end, name: draft.name.trim(), reservedFor, purpose: draft.purpose, purposeOther: draft.purpose === 'other' ? reservedFor : '' });
    if (!result || result.status !== 'approved' || !TYPES[result.type] || !Number.isInteger(result.unit)) throw new Error('The reservation could not be confirmed. Your details are still here.');
    saved = { ...result, reservedFor: typeof result.reservedFor === 'string' ? result.reservedFor : reservedFor };
    saving = false;
    step = 'success';
    history = [];
    renderStep();
  } catch (error) {
    saving = false;
    renderStep(false);
    setError(typeof error?.message === 'string' ? error.message : 'The reservation could not be saved. Your details are still here. Try again.');
  }
}

$('#reserve').addEventListener('click', event => openSheet(null, event.currentTarget));
$('#retry').addEventListener('click', () => retry());
$('#close').addEventListener('click', closeSheet);
$('#back').addEventListener('click', previousStep);
$('#daypick').addEventListener('click', event => {
  const button = event.target.closest('[data-day]');
  if (!button || !snapshot.days.some(day => day.key === button.dataset.day)) return;
  selectedDay = button.dataset.day;
  renderView();
});
document.querySelectorAll('.meter').forEach(button => button.addEventListener('click', () => setType(button.dataset.type)));
$('#schedule').addEventListener('click', event => {
  const occupied = event.target.closest('[data-booking-key]');
  if (occupied) {
    const booking = snapshot.bookings.find(item => bookingKeyFor(item) === occupied.dataset.bookingKey);
    if (booking) showBookingDetails(booking, occupied);
    return;
  }
  const button = event.target.closest('.roomSlot.open');
  if (button) openSheet({ type, unit: Number(button.dataset.unit), start: Number(button.dataset.start) }, button);
});
$('#detailClose')?.addEventListener('click', closeBookingDetails);
detailDialog?.addEventListener('close', () => {
  if (detailReturnFocus?.isConnected) detailReturnFocus.focus({ preventScroll: true });
  else $('#reserve')?.focus({ preventScroll: true });
  detailReturnFocus = null;
});
detailDialog?.addEventListener('click', event => {
  if (event.target !== detailDialog) return;
  const box = detailDialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeBookingDetails();
});
dialog.addEventListener('cancel', event => {
  if (saving) event.preventDefault();
});
dialog.addEventListener('close', () => {
  resetError();
  const fallback = draft.direct ? document.querySelector(`.roomSlot.open[data-unit="${draft.unit}"][data-start="${draft.start}"]`) : null;
  const target = returnFocus?.isConnected ? returnFocus : fallback || $('#reserve');
  target?.focus({ preventScroll: true });
});
dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeSheet();
  }
  if (event.target.closest('[data-retry]')) retry();
});
body.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || saving) return;
  if (button.dataset.picktype) {
    draft.type = button.dataset.picktype;
    draft.unit = null;
    draft.start = null;
    draft.end = null;
    setType(draft.type);
    nextStep('purpose');
  } else if (button.dataset.purpose) {
    draft.purpose = button.dataset.purpose;
    draft.purposeOther = '';
    draft.reservedFor = '';
    nextStep(draft.direct && draft.start !== null ? 'end' : 'start');
  } else if (button.hasAttribute('data-start')) {
    const start = Number(button.dataset.start);
    const availability = rangeAvailability(start, start + 30);
    if (!availability.free.length && !availability.overrideUnit) return setError('That start time is no longer available. Choose another time.');
    draft.start = start;
    draft.end = null;
    if (draft.unit === null && availability.overrideUnit) draft.unit = availability.overrideUnit;
    draft.override = Boolean(availability.overrideUnit);
    nextStep('end');
  } else if (button.hasAttribute('data-end')) {
    const end = Number(button.dataset.end);
    const availability = rangeAvailability(draft.start, end);
    if (!availability.free.length && !availability.overrideUnit) return setError('That ending is no longer available. Choose another ending.');
    draft.end = end;
    if (draft.unit === null && availability.overrideUnit) draft.unit = availability.overrideUnit;
    draft.override = Boolean(availability.overrideUnit);
    nextStep('reservedFor');
  } else if (button.hasAttribute('data-edit-time')) {
    nextStep('start');
  } else if (button.id === 'confirm') {
    confirmReservation();
  } else if (button.id === 'finish') closeSheet();
});
body.addEventListener('input', event => {
  if (event.target.id === 'name') draft.name = event.target.value;
  if (event.target.id === 'reservedFor') {
    draft.reservedFor = event.target.value;
    if (draft.purpose === 'other') draft.purposeOther = event.target.value;
  }
});
body.addEventListener('submit', event => {
  event.preventDefault();
  if (saving) return;
  if (event.target.id === 'reservedForForm') {
    draft.name = $('#name').value.trim();
    draft.reservedFor = $('#reservedFor').value.trim();
    if (!hasVisibleText(draft.name) || !hasVisibleText(draft.reservedFor)) return setError('Complete your name and this field before continuing.');
    if (draft.purpose === 'other') draft.purposeOther = draft.reservedFor;
    nextStep('confirm');
  }
});

renderView();
subscribe(value => {
  const previousDays = snapshot.days.map(day => day.key).join(',');
  snapshot = {
    status: value?.status || 'loading',
    canBook: value?.canBook === true,
    demo: value?.demo === true,
    error: typeof value?.error === 'string' ? value.error : '',
    days: Array.isArray(value?.days) ? value.days.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day.key) && typeof day.label === 'string' && [2, 6].includes(day.weekday)) : [],
    bookings: Array.isArray(value?.bookings) ? value.bookings : []
  };
  if (!dayInfo()) selectedDay = snapshot.days[0]?.key || '';
  renderConnection();
  if (previousDays !== snapshot.days.map(day => day.key).join(',') || !$('#daypick').children.length) renderDays();
  renderMeters();
  renderSchedule();
  if (dialog.open && ['start', 'end'].includes(step) && !saving) renderStep(false);
});
