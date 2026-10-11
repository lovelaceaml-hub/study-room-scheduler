// The member app's data: the schedule from the server, refreshed every 15
// seconds, and the three things a member can do (book, cancel, end early).
// Every change goes through a Cloud Function, then the schedule reloads.

import { connect, errorMessage } from '../shared/firebase.js';
import { writeStored, setServerTime } from '../shared/format.js';
import { demoBackend } from './demo-backend.js';

const REFRESH_MS = 15000;
// A schedule that has not arrived by then is reported, so the page never
// spins forever behind a stalled network.
const LOAD_TIMEOUT_MS = 20000;
const SCHEDULE_VERSION = 2;
export const NAME_KEY = 'srs-name';

const demo = new URLSearchParams(location.search).get('demo') === '1';

// status: 'connecting' | 'live' | 'demo' | 'offline' | 'error'
//   | 'slow' (no answer in time) | 'outdated' (the server sends a newer schedule format)
let state = { status: 'connecting', demo, config: null, days: [], bookings: [], mine: [] };
const listeners = new Set();
let backend = null;
let timer = null;
let loading = null; // { generation, promise }
let loadedAt = 0;
// Goes up with every change sent, so a load that began before the change
// can never overwrite what came after it.
let generation = 0;

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

function withTimeout(promise, ms) {
  let clock;
  const late = new Promise((resolve, reject) => {
    clock = setTimeout(() => reject(Object.assign(new Error('The schedule is taking too long to load.'), { slow: true })), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(clock));
}

// Reloads the schedule. Never throws: a failure shows up as the status.
// `fresh` starts a new load even while one is running, and makes the page
// ignore every load that began earlier.
export function refresh({ fresh = false } = {}) {
  if (fresh) generation += 1;
  if (loading?.generation === generation) return loading.promise;
  const current = generation;
  const promise = load(current).finally(() => {
    if (loading?.promise === promise) loading = null;
  });
  loading = { generation: current, promise };
  return promise;
}

async function load(current) {
  clearTimeout(timer);
  let changes;
  try {
    const sentAt = Date.now();
    const view = await withTimeout(api().then(server => server.call('memberSchedule')), LOAD_TIMEOUT_MS);
    if (typeof view?.version !== 'number') throw new Error('Unexpected schedule format');
    // A server from before `serverTime` leaves the device's clock in use.
    setServerTime(view.serverTime, sentAt);
    if (view.version !== SCHEDULE_VERSION) {
      changes = { status: 'outdated' };
    } else {
      if (!view.config || !Array.isArray(view.days)) throw new Error('Unexpected schedule format');
      changes = { status: demo ? 'demo' : 'live', config: view.config, days: view.days, bookings: view.bookings || [], mine: view.mine || [] };
    }
  } catch (error) {
    changes = { status: error.slow ? 'slow' : navigator.onLine === false ? 'offline' : 'error' };
  }
  // A change was sent while this was loading; the load started after it wins.
  if (current !== generation) return;
  if (changes.config) loadedAt = Date.now();
  update(changes);
  clearTimeout(timer);
  timer = setTimeout(() => {
    // A hidden page waits; it reloads as soon as it is shown again.
    if (!document.hidden) refresh();
  }, REFRESH_MS);
}

// Sends a change, then waits for a schedule that includes it. A failure is
// thrown as an Error whose message is for the member; `lost` is true when the
// server may have made the change anyway (the answer never arrived). The
// schedule is reloaded either way, so the page shows what really happened.
async function send(name, data, fallback) {
  if (!canBook()) throw Object.assign(new Error('The schedule is not connected. Wait until it is live, then try again.'), { lost: false });
  let result;
  try {
    result = await (await api()).call(name, data);
  } catch (error) {
    await refresh({ fresh: true });
    const message = errorMessage(error, '');
    throw Object.assign(new Error(message || fallback), { lost: !message });
  }
  await refresh({ fresh: true });
  return result;
}

// A new id for one booking draft: the server answers a repeat of the same id
// with the first result, so a retry after a lost answer never books twice.
export function newRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
}

// `request`: { date, type, unit, start, end, purpose, name, reservedFor, takeover, takeoverUnit, force, requestId }.
// `unit` is null to let the server pick any free unit. `force` is a Force
// override the member confirmed.
export async function book(request) {
  const data = {
    date: request.date,
    start: request.start,
    end: request.end,
    resourceType: request.type,
    requestedUnit: request.unit,
    purpose: request.purpose,
    name: request.name,
    reservedFor: request.reservedFor,
    allowTakeover: request.takeover,
    requestId: request.requestId
  };
  if (request.takeover && request.takeoverUnit) data.takeoverUnit = request.takeoverUnit;
  if (request.force) data.forceOverride = true;
  const result = await send('memberSubmitBooking', data, 'We couldn’t confirm the reservation. Check your connection, then try again.');
  // A practice name in demo mode is never kept for the real app.
  if (!demo) writeStored(NAME_KEY, request.name);
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
  if (!document.hidden && (!canBook() || Date.now() - loadedAt >= REFRESH_MS)) refresh();
});
