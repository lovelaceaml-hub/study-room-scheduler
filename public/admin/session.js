// The Admin session: the token the PIN unlocks, and when the page locks
// itself. The server keeps a session open until 20 minutes pass with no
// Admin change, and says how long is left (`expiresInMs`) when the PIN is
// accepted and after every change. The page counts that time on this
// device's own clock, so a device clock that is wrong does not matter. The
// automatic refresh does not keep the session open.
//
// Every lock or unlock starts a new "epoch". A request sent in an earlier
// epoch never reaches the page: `call` throws `Stale` instead, so a result
// that arrives after Lock is dropped.

import { connect } from '../shared/firebase.js';

const KEY = 'srs-admin-session';
// Used only when an older server sends no usable time left.
const FALLBACK_MS = 20 * 60 * 1000;
// The lock timer looks again at least this often, in case the device slept.
const CHECK_MS = 60 * 1000;

let api = null;
let current = null; // { token, deadline }, deadline on this device's clock
let restored = false;
let epoch = 0;
let timer = null;
const handlers = { expired() {}, deadline() {} };

export class Stale extends Error {
  constructor() {
    super('The Admin session changed while this was running.');
  }
}

export function on(name, handler) {
  handlers[name] = handler;
}

function read() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    // Older pages saved `expiresAt` from the server's clock.
    const deadline = Number(saved?.deadline ?? saved?.expiresAt);
    return typeof saved?.token === 'string' && Number.isFinite(deadline) ? { token: saved.token, deadline } : null;
  } catch {
    return null;
  }
}

// Session storage only lets a reload stay unlocked. When it is blocked, the
// session still works in this tab.
function write() {
  try {
    if (current) sessionStorage.setItem(KEY, JSON.stringify(current));
    else sessionStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

// The open session, or null.
export function session() {
  if (!restored) {
    restored = true;
    current = read();
    if (current && current.deadline <= Date.now()) current = null;
    write();
    arm();
  }
  return current && current.deadline > Date.now() ? current : null;
}

export function currentEpoch() {
  return epoch;
}

export function deadline() {
  return session()?.deadline ?? null;
}

function arm() {
  clearTimeout(timer);
  if (!current) return;
  timer = setTimeout(check, Math.min(Math.max(0, current.deadline - Date.now()), CHECK_MS));
}

// Locks when the time is up; call it when the page wakes up, too.
export function check() {
  if (!current) return;
  if (current.deadline > Date.now()) {
    arm();
    return;
  }
  clear();
  handlers.expired();
}

function extend(ms) {
  if (!current || !Number.isFinite(ms)) return;
  current.deadline = Date.now() + ms;
  write();
  arm();
  handlers.deadline(current.deadline);
}

function clear() {
  epoch += 1;
  current = null;
  clearTimeout(timer);
  write();
}

export async function start(pin) {
  api ??= await connect();
  const result = await api.call('adminStartSession', { pin });
  if (typeof result?.sessionToken !== 'string') throw new Error('Unexpected session format');
  // An older server sends only `expiresAt`, on its own clock.
  let left = Number.isFinite(result.expiresInMs) ? result.expiresInMs : result.expiresAt - Date.now();
  if (!(left > 0)) left = FALLBACK_MS;
  epoch += 1;
  restored = true;
  current = { token: result.sessionToken, deadline: Date.now() + left };
  write();
  arm();
  handlers.deadline(current.deadline);
  return current;
}

// Calls an Admin function with the session token. A change's answer carries
// the time left, which moves the deadline; the schedule's answer does not.
export async function call(name, payload = {}) {
  const at = epoch;
  const token = session()?.token;
  if (!token) {
    check();
    throw new Stale();
  }
  api ??= await connect();
  let result;
  try {
    result = await api.call(name, { sessionToken: token, ...payload });
  } catch (error) {
    if (at !== epoch) throw new Stale();
    throw error;
  }
  if (at !== epoch) throw new Stale();
  if (Number.isFinite(result?.expiresInMs)) extend(result.expiresInMs);
  return result;
}

// Lock: ends the session here and on the server.
export function end() {
  const token = current?.token;
  clear();
  if (token && api) api.call('adminEndSession', { sessionToken: token }).catch(() => {});
}

// The server said the session is over; there is nothing left to end there.
export function drop() {
  clear();
}

addEventListener('visibilitychange', () => {
  if (!document.hidden) check();
});
addEventListener('focus', () => check());
