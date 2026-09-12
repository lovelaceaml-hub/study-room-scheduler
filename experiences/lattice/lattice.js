import { overrideUnitForRange } from '../shared/model.js';
import { subscribe, submit, retry } from '../shared/live.js';

const TYPES = {
  room: { label: 'Study room', plural: 'Study rooms', short: 'Room', count: 4 },
  whiteboard: { label: 'Whiteboard', plural: 'Whiteboards', short: 'Board', count: 5 },
  tv: { label: 'TV', plural: 'TVs', short: 'TV', count: 3 }
};
const PURPOSES = { contact: 'Contact', new: 'New Member', other: 'Other' };
const START = 600;
const END = 1380;
const STEP = 30;
const $ = (selector) => document.querySelector(selector);
const dialog = $('#sheet');
const panel = $('#panel');
const schedule = $('#schedule');
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const time = (minutes, short = false) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour % 12 || 12}${short && minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`} ${hour < 12 ? 'AM' : 'PM'}`;
};
const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && otherStart < end;
let state = { status: 'loading', canBook: false, demo: false, error: '', days: [], bookings: [] };
let selectedDay = '';
let type = 'room';
let draft = {};
let step = 'resource';
let history = [];
let saving = false;
let formError = '';
let saved = null;
let opener = null;

function dayInfo(day) {
  return state.days.find((item) => item.key === day);
}

function dayLabel(day) {
  return dayInfo(day)?.label || day;
}

function serviceBlocks(day) {
  const weekday = dayInfo(day)?.weekday ?? new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 6) return [[600, 660, 'Morning service'], [870, 930, 'Afternoon service'], [1170, 1230, 'Evening service']];
  if (weekday === 2) return [[1170, 1230, 'Evening service']];
  return [[START, END, 'Reservations unavailable']];
}

function freeUnits(day, resource, start, end, exactUnit = null) {
  const config = TYPES[resource];
  if (!state.canBook || !dayInfo(day) || !config || !Number.isInteger(start) || !Number.isInteger(end)
    || start < START || end > END || start >= end || start % STEP || end % STEP) return [];
  if (serviceBlocks(day).some(([from, to]) => overlaps(start, end, from, to))) return [];
  const units = Array.from({ length: config.count }, (_, index) => index + 1);
  return units.filter((unit) => (exactUnit == null || unit === exactUnit)
    && !state.bookings.some((booking) => booking.day === day && booking.type === resource
      && booking.unit === unit && overlaps(start, end, booking.start, booking.end)));
}

function rangeOption(day, resource, start, end, purpose = draft.purpose, exactUnit = draft.unit) {
  const free = freeUnits(day, resource, start, end, exactUnit);
  if (free.length) return { override: false, unit: free[0] };
  if (!state.canBook || !dayInfo(day) || serviceBlocks(day).some(([from, to]) => overlaps(start, end, from, to))) return null;
  const overrideUnit = overrideUnitForRange(resource, day, start, end, purpose, state.bookings, exactUnit);
  return overrideUnit == null ? null : { override: true, unit: overrideUnit };
}

function validStarts() {
  const values = [];
  for (let start = START; start < END; start += STEP) {
    const option = rangeOption(draft.day, draft.type, start, start + STEP);
    if (option) values.push({ start, override: option.override });
  }
  return values;
}

function validEnds() {
  const values = [];
  for (let end = draft.start + STEP; end <= END; end += STEP) {
    const option = rangeOption(draft.day, draft.type, draft.start, end);
    if (!option) break;
    values.push({ end, override: option.override });
  }
  return values;
}

function resourceLabel(value = draft) {
  const config = TYPES[value.type];
  if (!config) return '';
  return value.unit == null ? `Any available ${config.label.toLowerCase()}` : `${config.label} ${value.unit}`;
}

function hasPriorityOverride(value = draft) {
  if (value.override) return true;
  if (!value.purpose || value.start == null || value.end == null) return false;
  return Boolean(rangeOption(value.day, value.type, value.start, value.end, value.purpose, value.unit)?.override);
}

function timeChoiceMarkup(attribute, value, override, selected) {
  const className = override ? ' class="override-choice"' : '';
  const indicator = override ? '<span class="overrideIndicator">Priority override</span>' : '';
  const label = `${time(value)}${override ? ', Priority override' : ''}`;
  return `<button${className} type="button" ${attribute}="${value}" data-priority-override="${override}" aria-label="${label}" aria-pressed="${selected}">${time(value)}${indicator}</button>`;
}

function updateTimeChoice(button, value, option) {
  const override = Boolean(option?.override);
  button.disabled = !option;
  button.classList.toggle('override-choice', override);
  button.dataset.priorityOverride = String(override);
  button.setAttribute('aria-label', `${time(value)}${override ? ', Priority override' : ''}`);
  const indicator = button.querySelector('.overrideIndicator');
  if (override && !indicator) button.insertAdjacentHTML('beforeend', '<span class="overrideIndicator">Priority override</span>');
  if (!override) indicator?.remove();
}

function setType(next) {
  if (!TYPES[next]) return;
  type = next;
  document.querySelectorAll('.overview [data-type]').forEach((button) => {
    const active = button.dataset.type === type;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderSchedule();
}

function renderState() {
  const labels = { loading: 'Connecting', live: 'Live schedule', offline: 'Offline', error: 'Connection unavailable' };
  $('#connection').dataset.status = state.demo ? 'demo' : state.status;
  $('#connectionLabel').textContent = state.demo ? 'Sample schedule' : (labels[state.status] || 'Connecting');
  $('#reserve').disabled = !state.canBook || !selectedDay;
  $('#retry').classList.toggle('hidden', !['offline', 'error'].includes(state.status));
  let message = '';
  if (state.demo) message = 'Sample schedule. Practice reservations stay in this browser.';
  else if (state.status === 'loading') message = 'Connecting to the schedule. Reservations will open when it is ready.';
  else if (state.status === 'offline') message = 'You are offline. The schedule may have changed. Reconnect to reserve a space.';
  else if (state.status === 'error') message = state.error || 'The schedule could not connect. Try again to see current availability.';
  else if (!state.canBook) message = 'Reservations are temporarily unavailable. Please try again shortly.';
  $('#statusMessage').textContent = message;
  $('#statusMessage').classList.toggle('hidden', !message);
  $('#dates').innerHTML = state.days.map((day) => `<button class="date ${day.key === selectedDay ? 'active' : ''}" type="button" data-day="${html(day.key)}" aria-pressed="${day.key === selectedDay}"><b>${html(day.label)}</b>${day.weekday === 6 ? 'Saturday availability' : 'Tuesday availability'}</button>`).join('');
  renderSchedule();
  if (dialog.open) refreshFlowAvailability();
}

function renderSchedule() {
  const config = TYPES[type];
  $('#scheduleName').textContent = config.plural;
  $('#unitCount').textContent = `${config.count} ${type === 'room' ? 'spaces' : type === 'whiteboard' ? 'boards' : 'TVs'}`;
  $('#scheduleHint').textContent = state.canBook ? 'Tap any open card to reserve it.' : 'Availability will open when connected.';
  schedule.dataset.type = type;
  schedule.setAttribute('aria-busy', String(state.status === 'loading'));
  schedule.classList.toggle('hasData', Boolean(selectedDay));
  if (!selectedDay) {
    const loading = state.status === 'loading';
    schedule.innerHTML = `<div class="emptyState">${loading ? '<span class="loadingMark" aria-hidden="true"></span>' : ''}<h3>${loading ? 'Getting the schedule ready' : 'The schedule is unavailable'}</h3><p>${loading ? 'Available times will appear here.' : 'Use Try again above to reconnect.'}</p></div>`;
    return;
  }
  const units = Array.from({ length: config.count }, (_, index) => index + 1);
  const head = `<div class="laneHead" style="--lanes:${config.count}"><div>Time</div>${units.map((unit) => `<div><b>${unit}</b>${config.short}</div>`).join('')}</div>`;
  const bookings = state.bookings.filter((booking) => booking.day === selectedDay && booking.type === type);
  const services = serviceBlocks(selectedDay);
  const rows = [];
  for (let start = START; start < END; start += STEP) {
    const end = start + STEP;
    const service = services.find(([from, to]) => overlaps(start, end, from, to));
    const rail = `<div class="rail" aria-hidden="true">${start % 60 === 0 ? `<span class="hour">${time(start, true)}</span>` : ''}${end === END ? `<span class="endHour">${time(END, true)}</span>` : ''}</div>`;
    if (service) {
      const [from, to, label] = service;
      rows.push(`<div class="timeRow serviceRow ${start === from ? 'serviceStart' : ''} ${end === to ? 'serviceEnd' : ''}" aria-label="${html(label)}, ${time(start)} to ${time(end)}">${rail}<div class="serviceBand">${start === from ? `<strong>${html(label)}</strong><small>${time(from)} to ${time(to)}</small>` : '<span>Reserved for service</span>'}</div></div>`);
      continue;
    }
    const cells = units.map((unit) => {
      const booking = bookings.find((item) => item.unit === unit && overlaps(start, end, item.start, item.end));
      const unitName = `${config.label} ${unit}`;
      if (booking) {
        const blocked = booking.blocked || booking.purpose === 'blocked';
        const purpose = PURPOSES[booking.purpose] ? booking.purpose : 'other';
        const name = blocked ? 'Reserved' : booking.name || 'Reserved';
        const description = blocked ? `${unitName}, ${time(start)} to ${time(end)}, Reserved` : `${unitName}, ${time(start)} to ${time(end)}, ${name}, ${PURPOSES[purpose]}`;
        return `<article class="slot ${blocked ? 'blocked' : purpose}" aria-label="${html(description)}"><span class="slotLabel">${config.short} ${unit}</span><span class="slotName">${html(name)}</span>${blocked ? '' : `<span class="badge">${PURPOSES[purpose]}</span>`}</article>`;
      }
      if (!state.canBook) return `<div class="slot waiting" aria-label="${html(unitName)}, ${time(start)} to ${time(end)}, availability unconfirmed"><span class="slotLabel">${config.short} ${unit}</span><span class="slotName">Unavailable</span></div>`;
      return `<button class="slot open" type="button" data-unit="${unit}" data-start="${start}" aria-label="${html(unitName)} is open from ${time(start)} to ${time(end)}"><span class="slotLabel">${config.short} ${unit}</span><span class="slotOpen">Open</span></button>`;
    }).join('');
    rows.push(`<div class="timeRow ${Math.floor((start - START) / 60) % 2 === 0 ? 'group' : ''}">${rail}${cells}</div>`);
  }
  const empty = !bookings.length && state.canBook ? `<p class="scheduleEmpty">No ${config.plural.toLowerCase()} are reserved yet. Choose any open card outside service times.</p>` : '';
  schedule.innerHTML = `${head}${empty}<div class="gridBody" style="--lanes:${config.count}">${rows.join('')}</div><div class="legend"><span><i aria-hidden="true"></i>Open</span><span><i class="c" aria-hidden="true"></i>Contact</span><span><i class="n" aria-hidden="true"></i>New Member</span><span><i class="o" aria-hidden="true"></i>Other</span><span><i class="r" aria-hidden="true"></i>Reserved</span></div>`;
}

function openFlow(selection) {
  if (!state.canBook || !selectedDay || dialog.open) return;
  if (selection && !freeUnits(selectedDay, type, selection.start, selection.start + STEP, selection.unit).length) return;
  opener = document.activeElement;
  draft = { day: selectedDay, type: selection ? type : '', unit: selection?.unit ?? null, start: selection?.start ?? null, end: null, name: '', purpose: '', purposeOther: '', direct: Boolean(selection) };
  step = selection ? 'purpose' : 'resource';
  history = [];
  saved = null;
  formError = '';
  saving = false;
  renderStep(false);
  document.body.classList.add('modalOpen');
  dialog.showModal();
  $('#flowTitle').focus({ preventScroll: true });
}

function closeFlow() {
  if (saving) return;
  dialog.close();
}

function go(next) {
  history.push(step);
  step = next;
  formError = '';
  renderStep();
}

function back() {
  if (!history.length || saving) return;
  step = history.pop();
  formError = '';
  renderStep();
}

function summary(value = draft, includeName = false) {
  const override = hasPriorityOverride(value);
  return `<div class="summary"><div><span>Date</span><b>${html(dayLabel(value.day))}</b></div><div><span>Space</span><b>${html(resourceLabel(value))}</b></div><div><span>Purpose</span><b>${html(PURPOSES[value.purpose] || '')}</b></div><div><span>Time</span><b>${time(value.start)} to ${time(value.end)}</b></div>${override ? '<div class="prioritySummary"><span>Booking note</span><b>Priority override</b></div>' : ''}${includeName ? `<div><span>Full name</span><b>${html(value.name)}</b></div>` : ''}</div>`;
}

function renderStep(focus = true) {
  const steps = [draft.direct ? null : 'resource', 'purpose', draft.purpose === 'other' ? 'details' : null, draft.direct && !draft.changingStart ? null : 'start', 'end', 'name', 'confirm'].filter(Boolean);
  $('#steps').innerHTML = step === 'success' ? '' : steps.map((item) => `<i class="${item === step ? 'on' : ''}"></i>`).join('');
  $('#back').disabled = saving;
  $('#back').style.visibility = history.length && step !== 'success' ? 'visible' : 'hidden';
  $('#close').disabled = saving;
  $('#flowContext').textContent = `${dayLabel(draft.day)}${draft.type ? ` · ${resourceLabel(draft)}` : ''}${draft.start != null ? ` · From ${time(draft.start)}` : ''}`;
  let title = '';
  let description = '';
  let content = '';
  if (step === 'resource') {
    title = 'What would you like to reserve?';
    description = 'Choose a resource to see its available times.';
    content = `<div class="choices">${Object.entries(TYPES).map(([key, config]) => `<button class="choice" type="button" data-pick="${key}"><span class="tile" aria-hidden="true">${config.short[0]}</span><span><strong>${config.label}</strong><small>${config.count} ${config.plural.toLowerCase()} on the schedule</small></span></button>`).join('')}</div>`;
  } else if (step === 'purpose') {
    title = 'What is this reservation for?';
    description = draft.direct ? `Your ${resourceLabel().toLowerCase()} and ${time(draft.start)} start are selected.` : 'Choose the purpose of your reservation.';
    content = `<div class="choices"><button class="choice purpose contact" type="button" data-purpose="contact"><span class="tile" aria-hidden="true">1</span><span><strong>Contact</strong><small>Highest priority</small></span></button><button class="choice purpose new" type="button" data-purpose="new"><span class="tile" aria-hidden="true">2</span><span><strong>New Member</strong><small>Second priority</small></span></button><button class="choice purpose other" type="button" data-purpose="other"><span class="tile" aria-hidden="true">3</span><span><strong>Other</strong><small>Add a short description</small></span></button></div>`;
  } else if (step === 'details') {
    title = 'Tell us what it is for.';
    description = 'Add a short description for your Other reservation.';
    content = `<form id="detailsForm"><label class="fieldLabel" for="purposeOther">Purpose description</label><textarea class="field" id="purposeOther" name="purposeOther" maxlength="240" required>${html(draft.purposeOther)}</textarea><button class="continue" type="submit">Continue</button></form>`;
  } else if (step === 'start') {
    title = 'When should it start?';
    description = 'Choose a start time. Only available half-hour starts are shown.';
    const starts = validStarts();
    content = starts.length ? `<div class="timeChoices">${starts.map(({ start, override }) => timeChoiceMarkup('data-start-choice', start, override, draft.start === start)).join('')}</div>` : '<p class="statusMessage">There are no available starts for this selection. Go back to choose a different resource, or close this window to change the date.</p>';
  } else if (step === 'end') {
    title = 'When should it end?';
    description = `Starting at ${time(draft.start)}. Every offered range stays free in one space and ends before the next service.`;
    const ends = validEnds();
    content = ends.length ? `<div class="timeChoices">${ends.map(({ end, override }) => timeChoiceMarkup('data-end-choice', end, override, draft.end === end)).join('')}</div>` : '<p class="statusMessage">This start is no longer available. Choose another time below.</p>';
  } else if (step === 'name') {
    title = 'Who is reserving?';
    description = 'Enter your full name so this reservation is easy to recognize.';
    content = `<form id="nameForm"><label class="fieldLabel" for="name">Full name</label><input class="field" id="name" name="name" type="text" autocomplete="name" maxlength="120" value="${html(draft.name)}" required aria-describedby="nameHelp"><p class="fieldHelp" id="nameHelp">The shared schedule displays an abbreviated name.</p><button class="continue" type="submit">Review reservation</button></form>`;
  } else if (step === 'confirm') {
    title = 'Confirm your reservation';
    description = state.demo ? 'This is a sample reservation for practice.' : 'One final check before it is placed on the schedule.';
    content = `${summary(draft, true)}${draft.purpose === 'other' ? `<p class="fieldHelp">Purpose description: ${html(draft.purposeOther)}</p>` : ''}<form id="confirmForm"><button class="continue" id="confirm" type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Reserving...' : state.demo ? 'Confirm sample reservation' : 'Confirm reservation'}</button></form>`;
  } else if (step === 'success') {
    title = state.demo ? 'Sample reservation saved.' : "You're reserved.";
    description = state.demo ? 'Your practice reservation is visible in this browser.' : 'Your reservation is confirmed.';
    content = `<div class="check" aria-hidden="true">✓</div>${summary(saved)}<button class="continue" id="finish" type="button">Return to schedule</button>`;
  }
  panel.innerHTML = `<div class="${step === 'success' ? 'done' : 'panel'}"><h3 id="flowTitle" tabindex="-1">${title}</h3><p id="flowDescription">${description}</p>${content}</div>`;
  refreshFlowAvailability();
  if (focus) {
    dialog.scrollTop = 0;
    $('#flowTitle').focus({ preventScroll: true });
  }
}

function refreshFlowAvailability() {
  const connectionMissing = !state.canBook || !dayInfo(draft.day);
  const hasStart = draft.type && draft.start != null;
  const currentOption = hasStart ? rangeOption(draft.day, draft.type, draft.start, draft.end ?? draft.start + STEP) : null;
  const rangeUnavailable = Boolean(hasStart && !currentOption);
  panel.querySelectorAll('[data-start-choice]').forEach((button) => {
    const start = Number(button.dataset.startChoice);
    updateTimeChoice(button, start, rangeOption(draft.day, draft.type, start, start + STEP));
  });
  panel.querySelectorAll('[data-end-choice]').forEach((button) => {
    const end = Number(button.dataset.endChoice);
    updateTimeChoice(button, end, rangeOption(draft.day, draft.type, draft.start, end));
  });
  const confirm = $('#confirm');
  if (confirm) confirm.disabled = saving || connectionMissing || rangeUnavailable;
  $('#close').disabled = saving;
  $('#back').disabled = saving;
  let notice = formError;
  if (!notice && step !== 'success' && !saving) {
    if (connectionMissing) notice = 'Reconnect to the schedule before reserving. Your details are still here.';
    else if (rangeUnavailable && ['end', 'name', 'confirm'].includes(step)) notice = 'This time is no longer available. Choose another time to continue.';
  }
  $('#flowNotice').textContent = notice;
  $('#flowNotice').classList.toggle('hidden', !notice || step === 'success');
  $('#changeTime').classList.toggle('hidden', saving || connectionMissing || step === 'success' || !hasStart || !(rangeUnavailable || formError));
}

async function confirmReservation() {
  if (saving) return;
  if (!state.canBook || !dayInfo(draft.day)) {
    formError = 'Reconnect to the schedule before reserving. Your details are still here.';
    refreshFlowAvailability();
    return;
  }
  if (!rangeOption(draft.day, draft.type, draft.start, draft.end)) {
    formError = 'This time has just become unavailable. Choose another time to continue.';
    refreshFlowAvailability();
    return;
  }
  if (!draft.name.trim() || !PURPOSES[draft.purpose] || (draft.purpose === 'other' && !draft.purposeOther.trim())) {
    formError = 'Please go back and complete your name and purpose.';
    refreshFlowAvailability();
    return;
  }
  saving = true;
  formError = '';
  renderStep(false);
  try {
    saved = await submit({ day: draft.day, type: draft.type, unit: draft.override ? null : draft.unit, start: draft.start, end: draft.end, name: draft.name.trim(), purpose: draft.purpose, purposeOther: draft.purpose === 'other' ? draft.purposeOther.trim() : '' });
    saving = false;
    step = 'success';
    renderStep();
  } catch (error) {
    saving = false;
    formError = typeof error?.message === 'string' && error.message ? error.message : 'We could not reserve that time. Your details are saved here. Please try again.';
    renderStep(false);
    $('#flowNotice').setAttribute('tabindex', '-1');
    $('#flowNotice').focus({ preventScroll: true });
  }
}

$('#dates').addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button || !dayInfo(button.dataset.day)) return;
  selectedDay = button.dataset.day;
  renderState();
});
document.querySelectorAll('.overview [data-type]').forEach((button) => button.addEventListener('click', () => setType(button.dataset.type)));
schedule.addEventListener('click', (event) => {
  const button = event.target.closest('button.slot.open');
  if (button) openFlow({ unit: Number(button.dataset.unit), start: Number(button.dataset.start) });
});
$('#reserve').addEventListener('click', () => openFlow());
$('#retry').addEventListener('click', () => retry());
$('#close').addEventListener('click', closeFlow);
$('#back').addEventListener('click', back);
$('#changeTime').addEventListener('click', () => {
  draft.start = null;
  draft.end = null;
  draft.changingStart = true;
  formError = '';
  history = [draft.direct ? null : 'resource', 'purpose', draft.purpose === 'other' ? 'details' : null].filter(Boolean);
  step = 'start';
  renderStep();
});
dialog.addEventListener('cancel', (event) => {
  if (saving) event.preventDefault();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('modalOpen');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  else $('#reserve').focus({ preventScroll: true });
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog || saving) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeFlow();
});
panel.addEventListener('input', (event) => {
  if (event.target.id === 'name') draft.name = event.target.value;
  if (event.target.id === 'purposeOther') draft.purposeOther = event.target.value;
});
panel.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled || saving) return;
  if (button.dataset.pick) {
    draft.type = button.dataset.pick;
    draft.unit = null;
    draft.start = null;
    draft.end = null;
    setType(draft.type);
    go('purpose');
  } else if (button.dataset.purpose) {
    draft.purpose = button.dataset.purpose;
    if (draft.purpose !== 'other') draft.purposeOther = '';
    go(draft.purpose === 'other' ? 'details' : draft.start == null ? 'start' : 'end');
  } else if (button.dataset.startChoice) {
    const start = Number(button.dataset.startChoice);
    if (!rangeOption(draft.day, draft.type, start, start + STEP)) return;
    draft.start = start;
    draft.end = null;
    go('end');
  } else if (button.dataset.endChoice) {
    const end = Number(button.dataset.endChoice);
    if (!rangeOption(draft.day, draft.type, draft.start, end)) return;
    draft.end = end;
    go('name');
  } else if (button.id === 'finish') closeFlow();
});
panel.addEventListener('submit', (event) => {
  event.preventDefault();
  if (saving) return;
  if (event.target.id === 'detailsForm') {
    draft.purposeOther = $('#purposeOther').value.trim();
    if (!draft.purposeOther) {
      $('#purposeOther').setCustomValidity('Please describe the purpose.');
      $('#purposeOther').reportValidity();
      return;
    }
    go(draft.start == null ? 'start' : 'end');
  } else if (event.target.id === 'nameForm') {
    draft.name = $('#name').value.trim();
    if (!draft.name) {
      $('#name').setCustomValidity('Please enter your full name.');
      $('#name').reportValidity();
      return;
    }
    go('confirm');
  } else if (event.target.id === 'confirmForm') confirmReservation();
});
panel.addEventListener('input', (event) => {
  if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
});

subscribe((snapshot) => {
  state = {
    ...snapshot,
    canBook: snapshot.canBook === true,
    demo: snapshot.demo === true,
    days: Array.isArray(snapshot.days) ? snapshot.days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.key) && [2, 6].includes(day.weekday)) : [],
    bookings: Array.isArray(snapshot.bookings) ? snapshot.bookings : []
  };
  if (!state.days.some((day) => day.key === selectedDay)) selectedDay = state.days[0]?.key || '';
  renderState();
});
