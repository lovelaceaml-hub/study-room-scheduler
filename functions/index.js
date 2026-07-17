'use strict';

const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { FieldPath, FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const {
  conflictingBooking,
  isoDateInLosAngeles,
  isoWeekday,
  migrationResourceUpdate,
  normalizeBookingIds,
  normalizeLegacyResourceMaps,
  priorityForPurpose,
  rangesOverlap,
  validateBookingTime,
  validateDirectBooking
} = require('./lib/policy');

initializeApp();
const db = getFirestore();
const ADMIN_PIN = defineSecret('STUDY_ROOM_ADMIN_PIN');
const REGION = 'us-west1';
const SESSION_MINUTES = 20;
const RATE_WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeTextEqual(first, second) {
  const firstHash = crypto.createHash('sha256').update(String(first)).digest();
  const secondHash = crypto.createHash('sha256').update(String(second)).digest();
  return crypto.timingSafeEqual(firstHash, secondHash);
}

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Please reload the app and try again.');
  return request.auth.uid;
}

function clientAddress(request) {
  const forwarded = request.rawRequest && request.rawRequest.headers
    ? request.rawRequest.headers['x-forwarded-for']
    : '';
  return String(forwarded || request.rawRequest?.ip || 'unknown').split(',')[0].trim();
}

function errorFromValidation(error) {
  if (error instanceof HttpsError) return error;
  return new HttpsError('invalid-argument', error && error.message ? error.message : 'The request is invalid.');
}

function pinFingerprint() {
  return sha256(`study-room-pin:${ADMIN_PIN.value()}`).slice(0, 24);
}

async function registerFailedAttempt(uid, address) {
  const key = sha256(`${uid}:${address}`).slice(0, 40);
  const ref = db.collection('adminRateLimits').doc(key);
  const now = Timestamp.now();
  const windowMs = RATE_WINDOW_MINUTES * 60 * 1000;
  let blocked = false;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() : {};
    const windowStartMs = previous.windowStart?.toMillis?.() || 0;
    const inWindow = now.toMillis() - windowStartMs < windowMs;
    const failures = inWindow ? Number(previous.failures || 0) + 1 : 1;
    blocked = failures >= MAX_FAILED_ATTEMPTS;
    transaction.set(ref, {
      failures,
      windowStart: inWindow ? previous.windowStart : now,
      blockedUntil: blocked ? Timestamp.fromMillis(now.toMillis() + windowMs) : null,
      updatedAt: now
    });
  });
  return blocked;
}

async function ensureNotRateLimited(uid, address) {
  const key = sha256(`${uid}:${address}`).slice(0, 40);
  const snapshot = await db.collection('adminRateLimits').doc(key).get();
  if (!snapshot.exists) return;
  const blockedUntil = snapshot.data().blockedUntil;
  if (blockedUntil && blockedUntil.toMillis() > Date.now()) {
    throw new HttpsError('resource-exhausted', 'Too many PIN attempts. Please wait 15 minutes and try again.');
  }
}

async function clearRateLimit(uid, address) {
  const key = sha256(`${uid}:${address}`).slice(0, 40);
  await db.collection('adminRateLimits').doc(key).delete().catch(() => {});
}

async function requireAdminSession(request) {
  const uid = requireAuth(request);
  const token = request.data && typeof request.data.sessionToken === 'string'
    ? request.data.sessionToken
    : '';
  if (token.length < 32 || token.length > 256) throw new HttpsError('permission-denied', 'Admin is locked.');
  const ref = db.collection('adminSessions').doc(sha256(token));
  const snapshot = await ref.get();
  const session = snapshot.exists ? snapshot.data() : null;
  const valid = session
    && session.uid === uid
    && session.expiresAt?.toMillis?.() > Date.now()
    && session.pinFingerprint === pinFingerprint();
  if (!valid) {
    if (snapshot.exists) await ref.delete().catch(() => {});
    throw new HttpsError('permission-denied', 'Admin session expired. Enter the PIN again.');
  }
  return { uid, ref };
}

function bookingDateTimestamp(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  return Timestamp.fromDate(date);
}

function sanitizeAssignments(needs, source) {
  const assignments = { room: null, whiteboard: null, tv: null };
  const allowed = {
    room: ['room-1', 'room-2', 'room-3', 'room-4'],
    whiteboard: ['wb-1', 'wb-2', 'wb-3', 'wb-4', 'wb-5'],
    tv: ['tv-1', 'tv-2', 'tv-3']
  };
  for (const type of Object.keys(assignments)) {
    if (!needs || !needs[type]) continue;
    if (!source || !allowed[type].includes(source[type])) {
      throw new HttpsError('invalid-argument', `Choose a valid ${type} assignment.`);
    }
    assignments[type] = source[type];
  }
  return assignments;
}

async function approvedBookingsForDate(transaction, date) {
  const query = db.collection('bookings').where('date', '==', date).where('status', '==', 'approved');
  const snapshot = await transaction.get(query);
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
}

const UNITS_BY_TYPE = Object.freeze({
  room: Object.freeze(['room-1', 'room-2', 'room-3', 'room-4']),
  whiteboard: Object.freeze(['wb-1', 'wb-2', 'wb-3', 'wb-4', 'wb-5']),
  tv: Object.freeze(['tv-1', 'tv-2', 'tv-3'])
});

function requestText(value, maximum, field, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new HttpsError('invalid-argument', `${field} is required.`);
  if (text.length > maximum) throw new HttpsError('invalid-argument', `${field} is too long.`);
  return text;
}

function memberRequestInput(input) {
  const data = input && typeof input === 'object' ? input : {};
  const date = requestText(data.date, 10, 'Date', true);
  const timeError = validateBookingTime(date, data.start, data.end, new Date(), true);
  if (timeError) throw new HttpsError('invalid-argument', timeError);
  const resourceType = requestText(data.resourceType, 20, 'Resource type', true);
  if (!UNITS_BY_TYPE[resourceType]) throw new HttpsError('invalid-argument', 'Choose a study room, whiteboard, or TV.');
  const purpose = ['contact', 'new-member', 'group', 'study-member', 'other'].includes(data.purpose) ? data.purpose : '';
  if (!purpose) throw new HttpsError('invalid-argument', 'Choose a purpose.');
  const purposeOther = requestText(data.purposeOther, 240, 'Purpose details');
  if (purpose === 'other' && !purposeOther) throw new HttpsError('invalid-argument', 'Purpose details are required.');
  return { date, start: data.start, end: data.end, resourceType, name: requestText(data.name, 120, 'Name', true), purpose, purposeOther };
}

function isTuesday(date) { return isoWeekday(date) === 2; }

function assignmentFor(type, candidate, approved) {
  return UNITS_BY_TYPE[type].find(unitId => !approved.some(existing =>
    existing.status === 'approved'
      && existing.assignments && existing.assignments[type] === unitId
      && rangesOverlap(candidate, existing)
  )) || null;
}

async function memberSubmitBooking(input, uid) {
  let request;
  try { request = memberRequestInput(input); }
  catch (error) { throw errorFromValidation(error); }
  const bookingRef = db.collection('bookings').doc();
  return db.runTransaction(async transaction => {
    const approved = await approvedBookingsForDate(transaction, request.date);
    const candidate = { ...request, date: request.date, assignments: { room: null, whiteboard: null, tv: null } };
    const automatic = isTuesday(request.date);
    const unitId = automatic ? assignmentFor(request.resourceType, candidate, approved) : null;
    if (automatic && !unitId) {
      throw new HttpsError('already-exists', 'That resource is fully booked for the selected time. Please choose another time.');
    }
    candidate.assignments[request.resourceType] = unitId;
    const now = FieldValue.serverTimestamp();
    transaction.create(bookingRef, {
      schemaVersion: 4,
      date: request.date,
      bookingDate: bookingDateTimestamp(request.date),
      start: request.start,
      end: request.end,
      name: request.name,
      needs: { room: request.resourceType === 'room', whiteboard: request.resourceType === 'whiteboard', tv: request.resourceType === 'tv' },
      purpose: request.purpose,
      purposeOther: request.purpose === 'other' ? request.purposeOther : '',
      status: automatic ? 'approved' : 'pending',
      assignments: candidate.assignments,
      ownerUid: uid,
      createdAt: now,
      updatedAt: now,
      ...(automatic ? { decidedAt: now, decidedBy: 'automatic' } : {})
    });
    return { bookingId: bookingRef.id, status: automatic ? 'approved' : 'pending', assignment: unitId, priority: priorityForPurpose(request.purpose) };
  });
}

function assertNoConflict(candidate, existing, excludeId) {
  const conflict = conflictingBooking(candidate, existing, excludeId);
  if (conflict) throw new HttpsError('already-exists', `That assignment is already in use by ${conflict.name || 'another booking'}.`);
}

async function approveExisting(action, bookingId, assignments, uid) {
  if (!bookingId) throw new HttpsError('invalid-argument', 'Booking ID is required.');
  const bookingRef = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookingRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Booking not found.');
    const booking = snapshot.data();
    const allowedStatus = action === 'approve' ? ['pending'] : ['declined', 'cancelled'];
    if (!allowedStatus.includes(booking.status)) throw new HttpsError('failed-precondition', 'This booking is no longer ready for that action.');
    let legacyMaps;
    let requestedMaps;
    try {
      // Stored v2 documents and old Admin drafts may still carry a harmless
      // `podium: false/null` key. Strip it at the trusted boundary.
      legacyMaps = normalizeLegacyResourceMaps(booking.needs, booking.assignments);
      requestedMaps = normalizeLegacyResourceMaps(legacyMaps.needs, assignments);
    } catch (error) {
      throw new HttpsError('failed-precondition', error.message);
    }
    const timeError = validateBookingTime(booking.date, booking.start, booking.end, new Date(), true);
    if (timeError) throw new HttpsError('failed-precondition', timeError);
    const safeNeeds = legacyMaps.needs;
    const safeAssignments = sanitizeAssignments(safeNeeds, requestedMaps.assignments);
    const candidate = { ...booking, id: bookingId, status: 'approved', needs: safeNeeds, assignments: safeAssignments };
    const existing = await approvedBookingsForDate(transaction, booking.date);
    assertNoConflict(candidate, existing, bookingId);
    transaction.update(bookingRef, {
      status: 'approved',
      needs: safeNeeds,
      assignments: safeAssignments,
      preferredRoom: safeNeeds.room && ['room-1', 'room-2', 'room-3', 'room-4'].includes(booking.preferredRoom)
        ? booking.preferredRoom
        : null,
      updatedAt: FieldValue.serverTimestamp(),
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: uid
    });
    return { bookingId, status: 'approved', assignments: safeAssignments };
  });
}

async function changeExistingStatus(action, bookingId, uid) {
  if (!bookingId) throw new HttpsError('invalid-argument', 'Booking ID is required.');
  const bookingRef = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookingRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Booking not found.');
    const booking = snapshot.data();
    const nextStatus = action === 'decline' ? 'declined' : 'cancelled';
    const allowed = action === 'decline' ? ['pending'] : ['pending', 'approved'];
    if (!allowed.includes(booking.status)) throw new HttpsError('failed-precondition', 'This booking is no longer ready for that action.');
    transaction.update(bookingRef, {
      status: nextStatus,
      ...(nextStatus === 'cancelled' && booking.status === 'approved' ? { lastAssignments: booking.assignments || {} } : {}),
      assignments: { room: null, whiteboard: null, tv: null },
      updatedAt: FieldValue.serverTimestamp(),
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: uid
    });
    return { bookingId, status: nextStatus };
  });
}

async function directAdd(input, note, uid) {
  let booking;
  try {
    booking = validateDirectBooking(input, new Date());
  } catch (error) {
    throw errorFromValidation(error);
  }
  const bookingRef = db.collection('bookings').doc();
  const noteText = typeof note === 'string' ? note.trim() : '';
  if (noteText.length > 1000) throw new HttpsError('invalid-argument', 'Note is too long.');
  await db.runTransaction(async transaction => {
    const existing = await approvedBookingsForDate(transaction, booking.date);
    assertNoConflict({ ...booking, id: bookingRef.id }, existing, null);
    const now = FieldValue.serverTimestamp();
    transaction.create(bookingRef, {
      ...booking,
      bookingDate: bookingDateTimestamp(booking.date),
      ownerUid: null,
      createdAt: now,
      updatedAt: now,
      decidedAt: now,
      decidedBy: uid
    });
    if (noteText) {
      transaction.set(db.collection('privateBookingNotes').doc(bookingRef.id), {
        bookingId: bookingRef.id,
        note: noteText,
        updatedAt: now,
        updatedBy: uid
      });
    }
  });
  return { bookingId: bookingRef.id, status: 'approved' };
}

async function cleanupOldBookings(uid) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 56);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const snapshot = await db.collection('bookings').where('date', '<', cutoffDate).limit(350).get();
  const batch = db.batch();
  snapshot.docs.forEach(document => {
    batch.delete(document.ref);
    batch.delete(db.collection('privateBookingNotes').doc(document.id));
  });
  if (!snapshot.empty) await batch.commit();
  return { removed: snapshot.size, more: snapshot.size === 350, cutoffDate, performedBy: uid };
}

async function retireBaptismRoom(uid, cursor = {}) {
  const today = isoDateInLosAngeles(new Date());
  let query = db.collection('bookings')
    .where('date', '>=', today)
    .orderBy('date')
    .orderBy(FieldPath.documentId())
    .limit(300);
  if (typeof cursor.afterDate === 'string' && typeof cursor.afterBookingId === 'string'
      && cursor.afterDate && cursor.afterBookingId) {
    query = query.startAfter(cursor.afterDate, cursor.afterBookingId);
  }
  const snapshot = await query.get();
  const batch = db.batch();
  let normalized = 0;
  let returnedToPending = 0;
  let skippedInvalid = 0;
  snapshot.docs.forEach(document => {
    const booking = document.data();
    if (booking.status !== 'pending' && booking.status !== 'approved') return;
    let resourceUpdate;
    try {
      resourceUpdate = migrationResourceUpdate(booking);
    } catch (error) {
      skippedInvalid += 1;
      return;
    }
    const update = {
      needs: resourceUpdate.needs,
      assignments: resourceUpdate.assignments,
      preferredRoom: resourceUpdate.preferredRoom,
      status: resourceUpdate.status,
      schemaVersion: 3,
      updatedAt: FieldValue.serverTimestamp()
    };
    if (typeof booking.date === 'string' && [2, 6].includes(isoWeekday(booking.date))) {
      update.bookingDate = bookingDateTimestamp(booking.date);
    }
    if (resourceUpdate.retiredBaptismRoom) {
      update.decidedAt = FieldValue.delete();
      update.decidedBy = uid;
      update.migrationReason = 'Baptism Room retired';
      returnedToPending += 1;
    }
    batch.update(document.ref, update);
    normalized += 1;
  });
  if (normalized) await batch.commit();
  const last = snapshot.docs[snapshot.docs.length - 1];
  return {
    scanned: snapshot.size,
    normalized,
    returnedToPending,
    skippedInvalid,
    afterDate: last ? last.data().date : null,
    afterBookingId: last ? last.id : null,
    done: snapshot.size < 300
  };
}

exports.adminStartSession = onCall({ region: REGION, secrets: [ADMIN_PIN] }, async request => {
  const uid = requireAuth(request);
  const address = clientAddress(request);
  await ensureNotRateLimited(uid, address);
  const pin = request.data && typeof request.data.pin === 'string' ? request.data.pin : '';
  if (!timingSafeTextEqual(pin, ADMIN_PIN.value())) {
    const blocked = await registerFailedAttempt(uid, address);
    if (blocked) throw new HttpsError('resource-exhausted', 'Too many PIN attempts. Please wait 15 minutes and try again.');
    throw new HttpsError('permission-denied', 'Incorrect Admin PIN.');
  }
  await clearRateLimit(uid, address);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Timestamp.fromMillis(Date.now() + SESSION_MINUTES * 60 * 1000);
  await db.collection('adminSessions').doc(sha256(token)).set({
    uid,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    pinFingerprint: pinFingerprint()
  });
  return { sessionToken: token, expiresAt: expiresAt.toMillis() };
});

exports.adminEndSession = onCall({ region: REGION, secrets: [ADMIN_PIN] }, async request => {
  const session = await requireAdminSession(request);
  await session.ref.delete();
  return { locked: true };
});

exports.adminBookingAction = onCall({ region: REGION, secrets: [ADMIN_PIN] }, async request => {
  const session = await requireAdminSession(request);
  const data = request.data || {};
  switch (data.action) {
    case 'approve':
    case 'reapprove':
      return approveExisting(data.action, data.bookingId, data.assignments, session.uid);
    case 'decline':
    case 'cancel':
      return changeExistingStatus(data.action, data.bookingId, session.uid);
    case 'direct-add':
      return directAdd(data.booking, data.note, session.uid);
    case 'cleanup':
      return cleanupOldBookings(session.uid);
    case 'retire-baptism-room':
      return retireBaptismRoom(session.uid, data);
    default:
      throw new HttpsError('invalid-argument', 'Unknown Admin action.');
  }
});

exports.memberSubmitBooking = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  return memberSubmitBooking(request.data, uid);
});

exports.adminNoteAction = onCall({ region: REGION, secrets: [ADMIN_PIN] }, async request => {
  const session = await requireAdminSession(request);
  const data = request.data || {};
  if (data.action === 'get-many') {
    let bookingIds;
    try {
      bookingIds = normalizeBookingIds(data.bookingIds, 50);
    } catch (error) {
      throw new HttpsError('invalid-argument', error.message);
    }
    const snapshots = await db.getAll(...bookingIds.map(id => db.collection('privateBookingNotes').doc(id)));
    return {
      notes: snapshots.map(snapshot => ({
        bookingId: snapshot.id,
        note: snapshot.exists ? String(snapshot.data().note || '') : ''
      }))
    };
  }
  const bookingId = typeof data.bookingId === 'string' ? data.bookingId : '';
  if (!bookingId || bookingId.length > 160) throw new HttpsError('invalid-argument', 'Booking ID is required.');
  const noteRef = db.collection('privateBookingNotes').doc(bookingId);
  if (data.action === 'get') {
    const snapshot = await noteRef.get();
    return { bookingId, note: snapshot.exists ? String(snapshot.data().note || '') : '' };
  }
  if (data.action === 'set') {
    const note = typeof data.note === 'string' ? data.note.trim() : '';
    if (note.length > 1000) throw new HttpsError('invalid-argument', 'Note is too long.');
    if (!note) await noteRef.delete();
    else await noteRef.set({ bookingId, note, updatedAt: FieldValue.serverTimestamp(), updatedBy: session.uid });
    return { bookingId, saved: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown note action.');
});

// A member may attach a private note only to a booking they own. The note can
// never be read back through the member API, which keeps lobby/member reads safe.
exports.memberSetPrivateNote = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const bookingId = typeof data.bookingId === 'string' ? data.bookingId : '';
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (!bookingId || bookingId.length > 160) throw new HttpsError('invalid-argument', 'Booking ID is required.');
  if (note.length > 1000) throw new HttpsError('invalid-argument', 'Note is too long.');
  const bookingRef = db.collection('bookings').doc(bookingId);
  const noteRef = db.collection('privateBookingNotes').doc(bookingId);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookingRef);
    if (!snapshot.exists || snapshot.data().ownerUid !== uid || snapshot.data().status !== 'pending') {
      throw new HttpsError('permission-denied', 'You cannot add a note to this request.');
    }
    if (!note) transaction.delete(noteRef);
    else transaction.set(noteRef, { bookingId, note, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  });
  return { saved: true };
});

// Run repeatedly until `done` is true. Each call moves at most 150 legacy
// public `note` fields into the server-only private collection.
exports.adminMigrateNotes = onCall({ region: REGION, secrets: [ADMIN_PIN], timeoutSeconds: 120 }, async request => {
  const session = await requireAdminSession(request);
  const data = request.data || {};
  let query = db.collection('bookings').orderBy(FieldPath.documentId()).limit(150);
  if (typeof data.afterBookingId === 'string' && data.afterBookingId) query = query.startAfter(data.afterBookingId);
  const snapshot = await query.get();
  const batch = db.batch();
  let migrated = 0;
  snapshot.docs.forEach(document => {
    const booking = document.data();
    if (!Object.prototype.hasOwnProperty.call(booking, 'note')) return;
    const note = typeof booking.note === 'string' ? booking.note.trim() : '';
    if (note) {
      batch.set(db.collection('privateBookingNotes').doc(document.id), {
        bookingId: document.id,
        note,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: session.uid,
        migratedFromPublicBooking: true
      });
    }
    batch.update(document.ref, { note: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    migrated += 1;
  });
  if (migrated) await batch.commit();
  const last = snapshot.docs[snapshot.docs.length - 1];
  return {
    scanned: snapshot.size,
    migrated,
    afterBookingId: last ? last.id : null,
    done: snapshot.size < 150
  };
});
