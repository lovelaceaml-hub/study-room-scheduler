'use strict';

const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { FieldPath, FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { HttpsError, onCall, onRequest } = require('firebase-functions/v2/https');
const {
  OVERRIDE_PURPOSES,
  availableUnitForType,
  conflictingBooking,
  earlyEndError,
  isoDateInLosAngeles,
  isoWeekday,
  migrationResourceUpdate,
  normalizeBookingIds,
  normalizeLegacyResourceMaps,
  overrideTarget,
  priorityForPurpose,
  rangesOverlap,
  shorterAvailableEnd,
  shouldAutoApproveMemberBooking,
  validateBookingTime,
  validateDirectBooking,
  validateReservedFor
} = require('./lib/policy');
const { publicLobbyBooking, publicLobbyScheduleDates } = require('./lib/public-lobby-schedule');
const { projectMemberSchedule } = require('./lib/member-schedule');

initializeApp();
const db = getFirestore();
const ADMIN_PIN = defineSecret('STUDY_ROOM_ADMIN_PIN');
const REGION = 'us-west1';
const SESSION_MINUTES = 20;
const RATE_WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;

// Server-side projection for LV Zion's temporary public release. Browsers
// never read Firestore booking documents from this endpoint: it returns only
// the exact fields already visible in the four-room lobby timetable.
exports.publicLobbySchedule = onRequest({ region: REGION }, async (_request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  if (_request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }
  const displayDates = publicLobbyScheduleDates(new Date());
  const snapshot = await db.collection('bookings')
    .where('date', 'in', displayDates)
    .orderBy('date')
    .limit(240)
    .get();
  const source = snapshot.docs.map(document => document.data());
  const peers = source.filter(booking => booking.status === 'approved' && booking.purpose !== 'blocked' && booking.needs?.room === true).map(booking => booking.name).filter(Boolean);
  const bookings = source
    .map(booking => publicLobbyBooking(booking, peers))
    .filter(Boolean);
  response.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  response.set('X-Content-Type-Options', 'nosniff');
  response.json({ version: 1, generatedAt: new Date().toISOString(), bookings });
});

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
  // Google's front end APPENDS the real client IP to any client-supplied
  // X-Forwarded-For value, so the trustworthy entry is the last one.
  const parts = String(forwarded || '').split(',').map(part => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(request.rawRequest?.ip || 'unknown');
}

function errorFromValidation(error) {
  if (error instanceof HttpsError) return error;
  return new HttpsError('invalid-argument', error && error.message ? error.message : 'The request is invalid.');
}

function pinFingerprint() {
  return sha256(`study-room-pin:${ADMIN_PIN.value()}`).slice(0, 24);
}

// PIN attempts are limited per client ADDRESS (never per signed-in user):
// anonymous auth lets anyone mint a fresh uid before every guess, so a
// uid-based key would reset the counter each time. A second, global counter
// backstops attackers who can rotate addresses too.
const GLOBAL_RATE_KEY = 'global-pin-failures';
const MAX_GLOBAL_FAILED_ATTEMPTS = 20;

async function recordFailureOn(ref, maximumFailures) {
  const now = Timestamp.now();
  const windowMs = RATE_WINDOW_MINUTES * 60 * 1000;
  let blocked = false;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() : {};
    const windowStartMs = previous.windowStart?.toMillis?.() || 0;
    const inWindow = now.toMillis() - windowStartMs < windowMs;
    const failures = inWindow ? Number(previous.failures || 0) + 1 : 1;
    blocked = failures >= maximumFailures;
    transaction.set(ref, {
      failures,
      windowStart: inWindow ? previous.windowStart : now,
      blockedUntil: blocked ? Timestamp.fromMillis(now.toMillis() + windowMs) : null,
      updatedAt: now
    });
  });
  return blocked;
}

function addressRateRef(address) {
  return db.collection('adminRateLimits').doc(sha256(`address:${address}`).slice(0, 40));
}

async function registerFailedAttempt(address) {
  const blockedForAddress = await recordFailureOn(addressRateRef(address), MAX_FAILED_ATTEMPTS);
  const blockedGlobally = await recordFailureOn(
    db.collection('adminRateLimits').doc(GLOBAL_RATE_KEY),
    MAX_GLOBAL_FAILED_ATTEMPTS
  );
  return blockedForAddress || blockedGlobally;
}

function isCurrentlyBlocked(snapshot) {
  if (!snapshot.exists) return false;
  const blockedUntil = snapshot.data().blockedUntil;
  return Boolean(blockedUntil && blockedUntil.toMillis() > Date.now());
}

async function ensureNotRateLimited(address) {
  const [forAddress, global] = await Promise.all([
    addressRateRef(address).get(),
    db.collection('adminRateLimits').doc(GLOBAL_RATE_KEY).get()
  ]);
  if (isCurrentlyBlocked(forAddress) || isCurrentlyBlocked(global)) {
    throw new HttpsError('resource-exhausted', 'Too many PIN attempts. Please wait 15 minutes and try again.');
  }
}

async function clearRateLimit(address) {
  // Only the per-address counter resets on success; the global counter keeps
  // counting so interleaved correct logins cannot launder a brute force.
  await addressRateRef(address).delete().catch(() => {});
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
  // Meeting was retired as a choice on 11 September 2026. Records already
  // saved with it keep working; no new one can be created.
  const purpose = ['contact', 'new-member', 'other'].includes(data.purpose) ? data.purpose : '';
  if (!purpose) throw new HttpsError('invalid-argument', 'Choose a purpose.');
  const purposeOther = requestText(data.purposeOther, 240, 'Purpose details');
  const hasReservedFor = Object.prototype.hasOwnProperty.call(data, 'reservedFor');
  let reservedFor;
  try {
    reservedFor = hasReservedFor
      ? validateReservedFor(purpose, data.reservedFor)
      : validateReservedFor(purpose, purpose === 'other' ? purposeOther : '', { required: false });
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message);
  }
  if (purpose === 'other' && !reservedFor) {
    throw new HttpsError('invalid-argument', 'Purpose details are required.');
  }
  const requestedUnit = data.requestedUnit == null ? null : data.requestedUnit;
  if (requestedUnit !== null && !UNITS_BY_TYPE[resourceType].includes(requestedUnit)) {
    throw new HttpsError('invalid-argument', 'Choose a valid unit for this resource.');
  }
  return {
    date,
    start: data.start,
    end: data.end,
    resourceType,
    name: requestText(data.name, 120, 'Name', true),
    purpose,
    purposeOther: purpose === 'other' ? reservedFor : purposeOther,
    reservedFor,
    requestedUnit
  };
}

function memberBookingDocument(request, assignments, uid, now, automatic = true) {
  return {
    schemaVersion: 5,
    date: request.date,
    bookingDate: bookingDateTimestamp(request.date),
    start: request.start,
    end: request.end,
    name: request.name,
    needs: { room: request.resourceType === 'room', whiteboard: request.resourceType === 'whiteboard', tv: request.resourceType === 'tv' },
    purpose: request.purpose,
    purposeOther: request.purpose === 'other' ? request.purposeOther : '',
    reservedFor: request.reservedFor || '',
    status: automatic ? 'approved' : 'pending',
    assignments,
    ownerUid: uid,
    createdAt: now,
    updatedAt: now,
    ...(automatic ? { decidedAt: now, decidedBy: 'automatic' } : {})
  };
}

async function memberSubmitBooking(input, uid) {
  let request;
  try { request = memberRequestInput(input); }
  catch (error) { throw errorFromValidation(error); }
  // Keep all member writes on the explicitly deployed callable. Contact and
  // New Member still use the transactional priority path when a full range
  // requires taking a lower-priority reservation.
  if (OVERRIDE_PURPOSES.includes(request.purpose)) return memberOverrideBooking(input, uid);
  const bookingRef = db.collection('bookings').doc();
  return db.runTransaction(async transaction => {
    const mine = await transaction.get(
      db.collection('bookings')
        .where('ownerUid', '==', uid)
        .where('date', '==', request.date)
        .where('status', 'in', ['pending', 'approved'])
    );
    if (mine.size >= 4) {
      throw new HttpsError('resource-exhausted', 'You already have several reservations for this day. Please talk to the approver if you need more.');
    }
    const approved = await approvedBookingsForDate(transaction, request.date);
    const candidate = { ...request, date: request.date, assignments: { room: null, whiteboard: null, tv: null } };
    const automatic = shouldAutoApproveMemberBooking(request.date, new Date());
    const availableUnitId = availableUnitForType(request.resourceType, candidate, approved, request.requestedUnit);
    if (!availableUnitId) {
      const unavailableMessage = request.resourceType === 'room'
        ? 'There are no rooms available in the time slot that was selected.'
        : request.resourceType === 'whiteboard'
          ? 'There are no whiteboards available in the time slot that was selected.'
          : 'There are no TVs available in the time slot that was selected.';
      throw new HttpsError('already-exists', unavailableMessage, {
        suggestedEnd: shorterAvailableEnd(request.resourceType, candidate, approved)
      });
    }
    const unitId = automatic ? availableUnitId : null;
    candidate.assignments[request.resourceType] = unitId;
    const now = FieldValue.serverTimestamp();
    transaction.create(bookingRef, memberBookingDocument(request, candidate.assignments, uid, now, automatic));
    return { bookingId: bookingRef.id, status: automatic ? 'approved' : 'pending', assignment: unitId, priority: priorityForPurpose(request.purpose) };
  });
}

/* Taking a reserved time. Contact may take New Member or Other, and New
   Member may take Other, so when a range is full and a lower-priority unit is
   reclaimable, one unit can be reclaimed. Whoever is displaced keeps their
   time in another unit when one is free; otherwise their reservation is
   released and flagged for the approver. Everything happens in one
   transaction so two people can never take the same unit. */
async function memberOverrideBooking(input, uid) {
  let request;
  try { request = memberRequestInput(input); }
  catch (error) { throw errorFromValidation(error); }
  if (!OVERRIDE_PURPOSES.includes(request.purpose)) {
    throw new HttpsError('failed-precondition', 'Only a Contact or New Member reservation can take a reserved time.');
  }
  const type = request.resourceType;
  const bookingRef = db.collection('bookings').doc();
  return db.runTransaction(async transaction => {
    const mine = await transaction.get(
      db.collection('bookings')
        .where('ownerUid', '==', uid)
        .where('date', '==', request.date)
        .where('status', 'in', ['pending', 'approved'])
    );
    if (mine.size >= 4) {
      throw new HttpsError('resource-exhausted', 'You already have several reservations for this day. Please talk to the approver if you need more.');
    }
    const approved = await approvedBookingsForDate(transaction, request.date);
    const candidate = { ...request, assignments: { room: null, whiteboard: null, tv: null } };
    const now = FieldValue.serverTimestamp();

    // Something opened up while they were deciding: take it and displace no one.
    const freeUnit = availableUnitForType(type, candidate, approved);
    if (freeUnit) {
      candidate.assignments[type] = freeUnit;
      transaction.create(bookingRef, memberBookingDocument(request, candidate.assignments, uid, now));
      return { bookingId: bookingRef.id, status: 'approved', assignment: freeUnit, priority: priorityForPurpose(request.purpose) };
    }

    const target = overrideTarget(type, candidate, approved);
    if (!target) {
      throw new HttpsError('failed-precondition', 'That time is fully reserved and nothing in it can be taken.');
    }

    // Re-place the displaced reservations against a pool that already counts
    // the new claim, so nobody is moved into a unit that is about to be taken.
    const displacedIds = new Set(target.holders.map(holder => holder.id));
    const pool = approved
      .filter(existing => !displacedIds.has(existing.id))
      .map(existing => ({ ...existing, assignments: { ...(existing.assignments || {}) } }));
    candidate.assignments[type] = target.unitId;
    pool.push({ ...candidate, id: bookingRef.id, status: 'approved' });

    const moves = target.holders.map(holder => {
      const holderCandidate = {
        date: holder.date,
        start: holder.start,
        end: holder.end,
        assignments: { room: null, whiteboard: null, tv: null }
      };
      const toUnit = availableUnitForType(type, holderCandidate, pool);
      if (toUnit) {
        const assignments = { ...(holder.assignments || {}), [type]: toUnit };
        pool.push({ ...holder, status: 'approved', assignments });
        return { holder, toUnit, assignments };
      }
      return { holder, toUnit: null, assignments: { ...(holder.assignments || {}), [type]: null } };
    });

    moves.forEach(move => {
      const notice = {
        kind: move.toUnit ? 'moved' : 'released',
        type,
        fromUnit: target.unitId,
        toUnit: move.toUnit || null,
        byPurpose: request.purpose,
        byBookingId: bookingRef.id,
        at: now
      };
      transaction.update(db.collection('bookings').doc(move.holder.id), move.toUnit
        ? { assignments: move.assignments, priorityNotice: notice, updatedAt: now }
        : { status: 'overridden', assignments: move.assignments, needsRebooking: true, priorityNotice: notice, updatedAt: now });
    });

    transaction.create(bookingRef, {
      ...memberBookingDocument(request, candidate.assignments, uid, now),
      overrodeBookingIds: moves.map(move => move.holder.id)
    });

    return {
      bookingId: bookingRef.id,
      status: 'approved',
      assignment: target.unitId,
      priority: priorityForPurpose(request.purpose),
      overrodeBookingId: moves.length ? moves[0].holder.id : null,
      moved: moves.every(move => !!move.toUnit),
      released: moves.filter(move => !move.toUnit).length
    };
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

/* Finishing early. The reservation keeps its unit and history; only its end
   time moves back, which immediately frees the remaining slots for everyone
   else. `requireOwnerUid` is set for member calls and null for Admin. */
async function endBookingEarly(bookingId, requestedEnd, actor, requireOwnerUid = null) {
  if (typeof bookingId !== 'string' || !bookingId || bookingId.length > 160) {
    throw new HttpsError('invalid-argument', 'Booking ID is required.');
  }
  const bookingRef = db.collection('bookings').doc(bookingId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookingRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Booking not found.');
    const booking = snapshot.data();
    if (requireOwnerUid && booking.ownerUid !== requireOwnerUid) {
      throw new HttpsError('permission-denied', 'Only the device that made this reservation can end it early.');
    }
    if (!['pending', 'approved'].includes(booking.status)) {
      throw new HttpsError('failed-precondition', 'This reservation is no longer active.');
    }
    const problem = earlyEndError(booking, typeof requestedEnd === 'string' ? requestedEnd : '', new Date());
    if (problem) throw new HttpsError('failed-precondition', problem);
    const now = FieldValue.serverTimestamp();
    transaction.update(bookingRef, {
      end: requestedEnd,
      // Keep the first, longest booked ending so the record still shows what
      // was originally reserved after several successive shortenings.
      endedEarlyFrom: typeof booking.endedEarlyFrom === 'string' ? booking.endedEarlyFrom : booking.end,
      endedEarlyAt: now,
      endedEarlyBy: actor,
      updatedAt: now
    });
    return { bookingId, end: requestedEnd };
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
  await ensureNotRateLimited(address);
  const pin = request.data && typeof request.data.pin === 'string' ? request.data.pin : '';
  if (!timingSafeTextEqual(pin, ADMIN_PIN.value())) {
    const blocked = await registerFailedAttempt(address);
    if (blocked) throw new HttpsError('resource-exhausted', 'Too many PIN attempts. Please wait 15 minutes and try again.');
    throw new HttpsError('permission-denied', 'Incorrect Admin PIN.');
  }
  await clearRateLimit(address);
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
    case 'end-early':
      return endBookingEarly(data.bookingId, data.end, session.uid, null);
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

// One address gets a handful of booking submissions per window; the 8th and
// later within 15 minutes are refused so a script cannot flood the schedule.
const MAX_MEMBER_SUBMISSIONS = 8;

function memberSubmitRef(address) {
  return db.collection('adminRateLimits').doc(sha256(`member-submit:${address}`).slice(0, 40));
}

exports.memberSubmitBooking = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  const address = clientAddress(request);
  const submitRef = memberSubmitRef(address);
  if (isCurrentlyBlocked(await submitRef.get())) {
    throw new HttpsError('resource-exhausted', 'Too many reservation requests from this device. Please wait a few minutes and try again.');
  }
  const blocked = await recordFailureOn(submitRef, MAX_MEMBER_SUBMISSIONS);
  if (blocked) {
    throw new HttpsError('resource-exhausted', 'Too many reservation requests from this device. Please wait a few minutes and try again.');
  }
  return memberSubmitBooking(request.data, uid);
});

exports.memberOverrideBooking = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  const address = clientAddress(request);
  const submitRef = memberSubmitRef(address);
  if (isCurrentlyBlocked(await submitRef.get())) {
    throw new HttpsError('resource-exhausted', 'Too many reservation requests from this device. Please wait a few minutes and try again.');
  }
  const blocked = await recordFailureOn(submitRef, MAX_MEMBER_SUBMISSIONS);
  if (blocked) {
    throw new HttpsError('resource-exhausted', 'Too many reservation requests from this device. Please wait a few minutes and try again.');
  }
  return memberOverrideBooking(request.data, uid);
});

// Ending early only ever shrinks a reservation the caller already owns, so it
// needs no rate limit of its own: it can free time but never take more.
exports.memberEndBookingEarly = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  const data = request.data || {};
  return endBookingEarly(data.bookingId, data.end, uid, uid);
});

exports.memberSchedule = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  const dates = publicLobbyScheduleDates(new Date());
  const snapshot = await db.collection('bookings')
    .where('date', 'in', dates)
    .orderBy('date')
    .limit(350)
    .get();
  const records = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
  return { ...projectMemberSchedule(records, dates, uid), days: dates };
});

exports.adminSchedule = onCall({ region: REGION, secrets: [ADMIN_PIN] }, async request => {
  await requireAdminSession(request);
  const dates = publicLobbyScheduleDates(new Date());
  const snapshot = await db.collection('bookings')
    .where('date', 'in', dates)
    .orderBy('date')
    .limit(350)
    .get();
  return {
    version: 1,
    days: dates,
    bookings: snapshot.docs.map(document => ({ id: document.id, ...document.data() }))
  };
});

exports.memberCancelBooking = onCall({ region: REGION }, async request => {
  const uid = requireAuth(request);
  const bookingId = typeof request.data?.bookingId === 'string' ? request.data.bookingId : '';
  if (!bookingId || bookingId.length > 160) throw new HttpsError('invalid-argument', 'Booking ID is required.');
  const bookingRef = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookingRef);
    if (!snapshot.exists || snapshot.data().ownerUid !== uid) {
      throw new HttpsError('permission-denied', 'Only the device that made this reservation can cancel it.');
    }
    const status = snapshot.data().status;
    if (status !== 'pending' && status !== 'approved') {
      throw new HttpsError('failed-precondition', 'This reservation is no longer active.');
    }
    transaction.update(bookingRef, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
  });
  return { bookingId, status: 'cancelled' };
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
