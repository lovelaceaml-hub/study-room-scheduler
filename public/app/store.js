// The member app's data: the schedule from the server, refreshed every 15
// seconds, and the three things a member can do (book, cancel, end early).
// Every change goes through a Cloud Function, then the schedule reloads.

import { connect, errorMessage } from '../shared/firebase.js';
import { writeStored } from '../shared/format.js';
import { demoBackend } from './demo-backend.js';

const REFRESH_MS = 15000;
export const NAME_KEY = 'srs-name';

const demo = new URLSearchParams(location.search).get('demo') === '1';

// status: 'connecting' | 'live' | 'demo' | 'offline' | 'error'
let state = { status: 'connecting', demo, config: null, days: [], bookings: [], mine: [] };
const listeners = new Set();
let backend = null;
let timer = null;
let loading = null;
let loadedAt = 0;

function update(changes) {
  state = { ...state, ...changes };
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  if (!loading && !loadedAt) refresh();
  return () => listeners.delete(listener);
}

export function canBook(current = state) {
  return current.status === 'live' || current.status === 'demo';
}

async function api() {
  backend ??= demo ? demoBackend() : await connect();
  return backend;
}

// Reloads the schedule. Never throws: a failure shows up as the status.
export function refresh() {
  loading ??= load().finally(() => { loading = null; });
  return loading;
}

async function load() {
  clearTimeout(timer);
  try {
    const view = await (await api()).call('memberSchedule');
    if (view?.version !== 2 || !view.config) throw new Error('Unexpected schedule format');
    loadedAt = Date.now();
    update({ status: demo ? 'demo' : 'live', config: view.config, days: view.days, bookings: view.bookings, mine: view.mine });
  } catch {
    update({ status: navigator.onLine === false ? 'offline' : 'error' });
  } finally {
    timer = setTimeout(refresh, REFRESH_MS);
  }
}

async function send(name, data, fallback) {
  if (!canBook()) throw new Error('The schedule is not connected. Wait until it is live, then try again.');
  try {
    const result = await (await api()).call(name, data);
    await refresh();
    return result;
  } catch (error) {
    throw new Error(errorMessage(error, fallback));
  }
}

// `request`: { date, type, unit, start, end, purpose, name, reservedFor, takeover }.
// `unit` is null to let the server pick any free unit.
export async function book(request) {
  const result = await send('memberSubmitBooking', {
    date: request.date,
    start: request.start,
    end: request.end,
    resourceType: request.type,
    requestedUnit: request.unit,
    purpose: request.purpose,
    name: request.name,
    reservedFor: request.reservedFor,
    allowTakeover: request.takeover
  }, 'The connection dropped before the reservation was confirmed. Check My reservations before trying again.');
  writeStored(NAME_KEY, request.name);
  return result;
}

export function cancel(id) {
  return send('memberCancelBooking', { bookingId: id }, 'The reservation could not be cancelled. Check your connection and try again.');
}

export function endEarly(id, end) {
  return send('memberEndBookingEarly', { bookingId: id, end }, 'The reservation could not be changed. Check your connection and try again.');
}

addEventListener('offline', () => { if (!demo) update({ status: 'offline' }); });
addEventListener('online', () => refresh());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!canBook() || Date.now() - loadedAt > REFRESH_MS)) refresh();
});
