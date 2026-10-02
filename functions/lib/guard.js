'use strict';

// Who is calling: the signed-in device, and the Admin PIN with its limits.

const crypto = require('node:crypto');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  MAX_PIN_FAILURES, MAX_PIN_FAILURES_TOTAL, RATE_WINDOW_MINUTES, ADMIN_SESSION_MINUTES
} = require('./config');

const LIMITS = 'adminRateLimits';
const SESSIONS = 'adminSessions';
const WINDOW_MS = RATE_WINDOW_MINUTES * 60 * 1000;
const SESSION_MS = ADMIN_SESSION_MINUTES * 60 * 1000;
// A configured PIN shorter than this is treated as not set up.
const PIN_MIN_LENGTH = 4;
// Expired Admin records removed per "Remove old records".
const PURGE_LIMIT = 200;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Every browser signs in anonymously; the uid identifies the device.
function requireUser(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Reload the page and try again.');
  return request.auth.uid;
}

// Google's front end appends the real client address to X-Forwarded-For, so
// the last entry is the one to trust.
function clientAddress(request) {
  const forwarded = String(request.rawRequest?.headers?.['x-forwarded-for'] || '');
  const parts = forwarded.split(',').map(part => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(request.rawRequest?.ip || 'unknown');
}

// The network an address belongs to. One IPv6 network (a /64) gives each
// device as many addresses as it likes, so IPv6 addresses count by their /64.
function networkOf(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  const bare = address.toLowerCase().split('%')[0];
  const [head, tail] = bare.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// ---------- Counting attempts in a 15-minute window ----------

function limitRef(db, name) {
  return db.collection(LIMITS).doc(sha256(name).slice(0, 40));
}

// A stored counter at `now`: attempts in the current window, and whether a
// block is still on.
function counterAt(snapshot, now) {
  const data = snapshot.exists ? snapshot.data() : {};
  const started = data.windowStart?.toMillis?.() ?? 0;
  const inWindow = now.toMillis() - started < WINDOW_MS;
  return {
    attempts: inWindow ? Number(data.attempts || 0) : 0,
    windowStart: inWindow ? data.windowStart : now,
    blocked: data.blockedUntil?.toMillis?.() > now.toMillis()
  };
}

// In one transaction over every counter: when any is blocked, nothing is
// counted and `blocked` is its index. Otherwise each counter gets one more
// attempt, and a counter that goes over its `allowed` is blocked for a window
// from now; `over` says which. Counting before anything else happens means a
// burst of parallel attempts cannot get past the limit.
async function countAttempt(db, counters, now) {
  return db.runTransaction(async transaction => {
    const snapshots = await Promise.all(counters.map(counter => transaction.get(counter.ref)));
    const states = snapshots.map(snapshot => counterAt(snapshot, now));
    const blocked = states.findIndex(state => state.blocked);
    if (blocked >= 0) return { blocked, over: counters.map(() => false), windowStarts: [] };
    const over = counters.map((counter, index) => {
      const attempts = states[index].attempts + 1;
      const isOver = attempts > counter.allowed;
      transaction.set(counter.ref, {
        attempts,
        windowStart: states[index].windowStart,
        blockedUntil: isOver ? Timestamp.fromMillis(now.toMillis() + WINDOW_MS) : null,
        updatedAt: now
      });
      return isOver;
    });
    return { blocked: -1, over, windowStarts: states.map(state => state.windowStart.toMillis()) };
  });
}

// ---------- Admin PIN and sessions ----------

// PIN attempts are counted per address (a new anonymous uid is free to make)
// and in total, so rotating addresses does not help either.
const PIN_LOCKED = `Too many PIN attempts. Wait ${RATE_WINDOW_MINUTES} minutes and try again.`;
const SESSION_ENDED = 'Your Admin session ended. Enter the PIN again.';

function sameText(first, second) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(first)).digest(),
    crypto.createHash('sha256').update(String(second)).digest()
  );
}

// An empty or very short PIN (a missing secret, say) must never open Admin.
function requirePinSetUp(pin) {
  if (typeof pin !== 'string' || pin.length < PIN_MIN_LENGTH) throw new HttpsError('failed-precondition', 'Admin is not set up.');
}

// Sessions end when the PIN changes, because each one records which PIN
// opened it. Mixing in the session's own token keeps the stored value from
// revealing the PIN to anyone who can read the database.
function pinFingerprint(token, pin) {
  return sha256(`${token}:${pin}`);
}

function pinCounters(db, request) {
  return [
    { ref: limitRef(db, `address:${networkOf(clientAddress(request))}`), allowed: MAX_PIN_FAILURES },
    { ref: db.collection(LIMITS).doc('global-pin-failures'), allowed: MAX_PIN_FAILURES_TOTAL }
  ];
}

// A correct PIN was not a guess: its address starts afresh, and the total
// gets this attempt back, with the block it set if it set one.
async function forgetAttempt(db, [address, total], counted, now) {
  await address.ref.delete();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(total.ref);
    const data = snapshot.exists ? snapshot.data() : null;
    if (!data || data.windowStart?.toMillis?.() !== counted.windowStarts[1]) return;
    const update = { attempts: Math.max(0, Number(data.attempts || 0) - 1), updatedAt: Timestamp.now() };
    if (counted.over[1] && data.blockedUntil?.toMillis?.() === now.toMillis() + WINDOW_MS) update.blockedUntil = null;
    transaction.update(total.ref, update);
  });
}

// Every attempt is counted first, in one transaction, and only then compared,
// so at most `allowed` + 1 PINs are ever compared per address, and in total,
// per window.
async function startAdminSession(db, request, pin) {
  const uid = requireUser(request);
  requirePinSetUp(pin);
  const attempt = typeof request.data?.pin === 'string' ? request.data.pin : '';
  const counters = pinCounters(db, request);
  const now = Timestamp.now();
  const counted = await countAttempt(db, counters, now);
  if (counted.blocked >= 0) throw new HttpsError('resource-exhausted', PIN_LOCKED);
  if (!sameText(attempt, pin)) {
    const locked = counted.over.includes(true);
    throw new HttpsError(locked ? 'resource-exhausted' : 'permission-denied', locked ? PIN_LOCKED : 'That PIN is not correct.');
  }
  await forgetAttempt(db, counters, counted, now);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Timestamp.fromMillis(Date.now() + SESSION_MS);
  await db.collection(SESSIONS).doc(sha256(token)).set({
    uid, expiresAt, createdAt: FieldValue.serverTimestamp(), pinFingerprint: pinFingerprint(token, pin)
  });
  return { sessionToken: token, expiresAt: expiresAt.toMillis(), expiresInMs: SESSION_MS };
}

// Admin stays unlocked until ADMIN_SESSION_MINUTES pass with no Admin change.
// Change endpoints pass `extend`; reading the schedule does not extend it.
// Returns { uid, ref, expiresInMs }.
async function requireAdmin(db, request, pin, { extend = false } = {}) {
  const uid = requireUser(request);
  requirePinSetUp(pin);
  const token = typeof request.data?.sessionToken === 'string' ? request.data.sessionToken : '';
  if (token.length < 32 || token.length > 256) throw new HttpsError('permission-denied', 'Admin is locked.');
  const ref = db.collection(SESSIONS).doc(sha256(token));
  const snapshot = await ref.get();
  const session = snapshot.exists ? snapshot.data() : null;
  const now = Date.now();
  const valid = session
    && session.uid === uid
    && session.expiresAt?.toMillis() > now
    && session.pinFingerprint === pinFingerprint(token, pin);
  if (!valid) {
    if (snapshot.exists) await ref.delete().catch(() => {});
    throw new HttpsError('permission-denied', SESSION_ENDED);
  }
  if (!extend) return { uid, ref, expiresInMs: session.expiresAt.toMillis() - now };
  try {
    await ref.update({ expiresAt: Timestamp.fromMillis(now + SESSION_MS) });
  } catch {
    // Signed out in another tab a moment ago.
    throw new HttpsError('permission-denied', SESSION_ENDED);
  }
  return { uid, ref, expiresInMs: SESSION_MS };
}

// Deletes expired Admin sessions, and attempt counters whose window and block
// are both over (a block never outlasts a window from the counter's last
// change). A bounded number of each per call.
async function removeExpired(db, now = new Date()) {
  const [sessions, limits] = await Promise.all([
    db.collection(SESSIONS).where('expiresAt', '<', Timestamp.fromDate(now)).limit(PURGE_LIMIT).get(),
    db.collection(LIMITS).where('updatedAt', '<', Timestamp.fromMillis(now.getTime() - WINDOW_MS)).limit(PURGE_LIMIT).get()
  ]);
  const documents = [...sessions.docs, ...limits.docs];
  if (documents.length) {
    const batch = db.batch();
    documents.forEach(document => batch.delete(document.ref));
    await batch.commit();
  }
  return { sessions: sessions.size, limits: limits.size };
}

module.exports = { requireUser, startAdminSession, requireAdmin, removeExpired, networkOf };
