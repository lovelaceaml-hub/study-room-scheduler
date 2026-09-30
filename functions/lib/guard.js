'use strict';

// Who is calling: the signed-in device, request limits, and the Admin PIN.

const crypto = require('node:crypto');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  MAX_REQUESTS_PER_DEVICE, MAX_REQUESTS_PER_NETWORK, MAX_PIN_FAILURES, MAX_PIN_FAILURES_TOTAL,
  RATE_WINDOW_MINUTES, ADMIN_SESSION_MINUTES
} = require('./config');

const LIMITS = 'adminRateLimits';
const SESSIONS = 'adminSessions';
const WINDOW_MS = RATE_WINDOW_MINUTES * 60 * 1000;

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

// ---------- Counting attempts in a 15-minute window ----------

function limitRef(db, name) {
  return db.collection(LIMITS).doc(sha256(name).slice(0, 40));
}

function blocked(snapshot) {
  return Boolean(snapshot.exists && snapshot.data().blockedUntil?.toMillis() > Date.now());
}

// Adds one attempt; returns true once more than `allowed` attempts fall in
// one window, and blocks further attempts for a window.
async function countAttempt(db, ref, allowed) {
  const now = Timestamp.now();
  let over = false;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() : {};
    const started = previous.windowStart?.toMillis?.() || 0;
    const inWindow = now.toMillis() - started < WINDOW_MS;
    const attempts = inWindow ? Number(previous.failures || 0) + 1 : 1;
    over = attempts > allowed;
    transaction.set(ref, {
      failures: attempts,
      windowStart: inWindow ? previous.windowStart : now,
      blockedUntil: over ? Timestamp.fromMillis(now.toMillis() + WINDOW_MS) : null,
      updatedAt: now
    });
  });
  return over;
}

// Reservation requests are limited per device, and more loosely per network
// so that everyone on the church Wi-Fi can still book.
async function limitReservationRequests(db, request) {
  const limits = [
    [limitRef(db, `member-device:${requireUser(request)}`), MAX_REQUESTS_PER_DEVICE, 'this device'],
    [limitRef(db, `member-submit:${clientAddress(request)}`), MAX_REQUESTS_PER_NETWORK, 'this network']
  ];
  const snapshots = await Promise.all(limits.map(([ref]) => ref.get()));
  const refusal = source => new HttpsError('resource-exhausted', `Too many reservation requests from ${source}. Wait a few minutes and try again.`);
  const blockedLimit = limits.find((limit, index) => blocked(snapshots[index]));
  if (blockedLimit) throw refusal(blockedLimit[2]);
  for (const [ref, allowed, source] of limits) {
    if (await countAttempt(db, ref, allowed)) throw refusal(source);
  }
}

// ---------- Admin PIN and sessions ----------

// PIN failures are counted per address (a new anonymous uid is free to make)
// and in total, so rotating addresses does not help either.
const PIN_LOCKED = `Too many PIN attempts. Wait ${RATE_WINDOW_MINUTES} minutes and try again.`;

function sameText(first, second) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(first)).digest(),
    crypto.createHash('sha256').update(String(second)).digest()
  );
}

// Sessions end when the PIN changes, because each one records which PIN opened it.
function pinFingerprint(pin) {
  return sha256(`study-room-pin:${pin}`).slice(0, 24);
}

async function startAdminSession(db, request, pin) {
  const uid = requireUser(request);
  const addressRef = limitRef(db, `address:${clientAddress(request)}`);
  const totalRef = db.collection(LIMITS).doc('global-pin-failures');
  const [byAddress, total] = await Promise.all([addressRef.get(), totalRef.get()]);
  if (blocked(byAddress) || blocked(total)) throw new HttpsError('resource-exhausted', PIN_LOCKED);

  const attempt = typeof request.data?.pin === 'string' ? request.data.pin : '';
  if (!sameText(attempt, pin)) {
    const lockedHere = await countAttempt(db, addressRef, MAX_PIN_FAILURES);
    const lockedEverywhere = await countAttempt(db, totalRef, MAX_PIN_FAILURES_TOTAL);
    throw new HttpsError(lockedHere || lockedEverywhere ? 'resource-exhausted' : 'permission-denied',
      lockedHere || lockedEverywhere ? PIN_LOCKED : 'That PIN is not correct.');
  }
  // A correct PIN clears this address only; the total keeps counting.
  await addressRef.delete().catch(() => {});

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Timestamp.fromMillis(Date.now() + ADMIN_SESSION_MINUTES * 60 * 1000);
  await db.collection(SESSIONS).doc(sha256(token)).set({
    uid, expiresAt, createdAt: FieldValue.serverTimestamp(), pinFingerprint: pinFingerprint(pin)
  });
  return { sessionToken: token, expiresAt: expiresAt.toMillis() };
}

async function requireAdmin(db, request, pin) {
  const uid = requireUser(request);
  const token = typeof request.data?.sessionToken === 'string' ? request.data.sessionToken : '';
  if (token.length < 32 || token.length > 256) throw new HttpsError('permission-denied', 'Admin is locked.');
  const ref = db.collection(SESSIONS).doc(sha256(token));
  const snapshot = await ref.get();
  const session = snapshot.exists ? snapshot.data() : null;
  const valid = session
    && session.uid === uid
    && session.expiresAt?.toMillis() > Date.now()
    && session.pinFingerprint === pinFingerprint(pin);
  if (!valid) {
    if (snapshot.exists) await ref.delete().catch(() => {});
    throw new HttpsError('permission-denied', 'Your Admin session ended. Enter the PIN again.');
  }
  return { uid, ref };
}

module.exports = { requireUser, limitReservationRequests, startAdminSession, requireAdmin };
