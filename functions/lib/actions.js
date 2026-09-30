'use strict';

// Everything that reads or changes booking records. Each change runs in a
// Firestore transaction, so two people can never end up holding the same unit.

const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { RESOURCES, MAX_ACTIVE_PER_DAY, KEEP_DAYS, NOTE_MAX } = require('./config');
const { addDays, todayAt, earlyEndError } = require('./schedule');
const {
  TYPES, unitIds, emptyAssignments, freeUnit, takeoverTarget, shortenedEnd, conflictWith
} = require('./bookings');

const BOOKINGS = 'bookings';
const NOTES = 'privateBookingNotes';
const RECORD_LIMIT = 400;

async function recordsFor(db, dates) {
  if (!dates.length) return [];
  const snapshot = await db.collection(BOOKINGS).where('date', 'in', dates).limit(RECORD_LIMIT).get();
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
}

async function approvedOn(transaction, db, date) {
  const snapshot = await transaction.get(db.collection(BOOKINGS).where('date', '==', date).where('status', '==', 'approved'));
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
}

async function existing(transaction, ref) {
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) throw new HttpsError('not-found', 'That reservation no longer exists.');
  return snapshot.data();
}

function bookingId(value) {
  if (typeof value !== 'string' || !value || value.length > 160 || value.includes('/')) {
    throw new HttpsError('invalid-argument', 'Reservation ID is missing.');
  }
  return value;
}

// ---------- Members ----------

// Books the first free unit. When none is free for the whole time, a Contact
// or New Member reservation takes a unit held only by lower priorities:
//   - a holder that started earlier keeps its unit and now ends when this one starts;
//   - any other holder moves to another free unit, or is released if none is free.
// Each affected holder gets a `priorityNotice` so My reservations can explain it.
async function submitReservation(db, request, uid) {
  const ref = db.collection(BOOKINGS).doc();
  return db.runTransaction(async transaction => {
    const mine = await transaction.get(db.collection(BOOKINGS)
      .where('ownerUid', '==', uid).where('date', '==', request.date).where('status', '==', 'approved'));
    if (mine.size >= MAX_ACTIVE_PER_DAY) {
      throw new HttpsError('resource-exhausted', `You already have ${MAX_ACTIVE_PER_DAY} reservations on this day.`);
    }
    const approved = await approvedOn(transaction, db, request.date);
    const candidate = { ...request, assignments: emptyAssignments() };
    const now = FieldValue.serverTimestamp();
    const record = unit => ({
      date: request.date,
      start: request.start,
      end: request.end,
      name: request.name,
      purpose: request.purpose,
      reservedFor: request.reservedFor,
      needs: Object.fromEntries(TYPES.map(type => [type, type === request.type])),
      assignments: { ...emptyAssignments(), [request.type]: unit },
      status: 'approved',
      ownerUid: uid,
      createdAt: now,
      updatedAt: now
    });

    const free = freeUnit(request.type, candidate, approved, request.requestedUnit);
    if (free) {
      transaction.create(ref, record(free));
      return { id: ref.id, unit: free, tookOver: false };
    }

    const target = request.allowTakeover ? takeoverTarget(request.type, candidate, approved, request.requestedUnit) : null;
    if (!target) {
      const plural = RESOURCES[request.type].plural.toLowerCase();
      throw new HttpsError('already-exists', request.requestedUnit
        ? 'That unit is taken for part of that time. Choose another time.'
        : `No ${plural} are free for that whole time. Choose another time.`);
    }
    takeOver(transaction, db, request, target, approved, ref.id, now);
    transaction.create(ref, record(target.unitId));
    return { id: ref.id, unit: target.unitId, tookOver: true };
  });
}

function takeOver(transaction, db, request, target, approved, newId, now) {
  const type = request.type;
  const notice = fields => ({ type, fromUnit: target.unitId, byPurpose: request.purpose, byBookingId: newId, at: now, ...fields });
  const shortened = [];
  const displaced = [];
  for (const holder of target.holders) {
    const end = shortenedEnd(holder, request);
    if (end) shortened.push({ holder, end });
    else displaced.push(holder);
  }

  // Place displaced holders against a pool that already includes the new
  // reservation, so nobody is moved into the unit being taken.
  const affected = new Set(target.holders.map(holder => holder.id));
  const pool = approved.filter(booking => !affected.has(booking.id));
  shortened.forEach(({ holder, end }) => pool.push({ ...holder, end }));
  pool.push({ ...request, id: newId, status: 'approved', assignments: { ...emptyAssignments(), [type]: target.unitId } });

  for (const { holder, end } of shortened) {
    transaction.update(db.collection(BOOKINGS).doc(holder.id), {
      end,
      priorityNotice: notice({ kind: 'shortened', toUnit: target.unitId, fromEnd: holder.end, toEnd: end }),
      updatedAt: now
    });
  }
  for (const holder of displaced) {
    const toUnit = freeUnit(type, { date: holder.date, start: holder.start, end: holder.end }, pool);
    const assignments = { ...emptyAssignments(), ...holder.assignments, [type]: toUnit };
    const ref = db.collection(BOOKINGS).doc(holder.id);
    if (toUnit) {
      pool.push({ ...holder, assignments });
      transaction.update(ref, { assignments, priorityNotice: notice({ kind: 'moved', toUnit }), updatedAt: now });
    } else {
      transaction.update(ref, { status: 'overridden', assignments, priorityNotice: notice({ kind: 'released', toUnit: null }), updatedAt: now });
    }
  }
}

async function cancelReservation(db, id, uid) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  await db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (booking.ownerUid !== uid) throw new HttpsError('permission-denied', 'Only the device that made this reservation can cancel it.');
    if (booking.status !== 'approved') throw new HttpsError('failed-precondition', 'This reservation is no longer active.');
    transaction.update(ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
  });
}

// Moves the end time earlier; the unit and the rest of the record stay.
// `uid` is the member's device, or null when the Admin does it.
async function endEarly(db, id, end, uid, actor) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  return db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (uid && booking.ownerUid !== uid) throw new HttpsError('permission-denied', 'Only the device that made this reservation can end it early.');
    if (booking.status !== 'approved') throw new HttpsError('failed-precondition', 'This reservation is no longer active.');
    const problem = earlyEndError(booking, end);
    if (problem) throw new HttpsError('failed-precondition', problem);
    transaction.update(ref, {
      end,
      // The first end time is kept through repeated shortening.
      endedEarlyFrom: typeof booking.endedEarlyFrom === 'string' ? booking.endedEarlyFrom : booking.end,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor
    });
    return { end };
  });
}

// ---------- Admin ----------

async function adminAdd(db, booking, uid) {
  const ref = db.collection(BOOKINGS).doc();
  const { note, ...fields } = booking;
  await db.runTransaction(async transaction => {
    const approved = await approvedOn(transaction, db, booking.date);
    const conflict = conflictWith({ ...fields, id: ref.id }, approved);
    if (conflict) throw new HttpsError('already-exists', `That unit is already booked by ${conflict.name || 'someone else'} at that time.`);
    const now = FieldValue.serverTimestamp();
    transaction.create(ref, { ...fields, status: 'approved', ownerUid: null, createdAt: now, updatedAt: now, updatedBy: uid });
    if (note) transaction.set(db.collection(NOTES).doc(ref.id), { bookingId: ref.id, note, updatedAt: now, updatedBy: uid });
  });
  return { id: ref.id };
}

async function adminCancel(db, id, uid) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  await db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (booking.status !== 'approved') throw new HttpsError('failed-precondition', 'This booking is no longer active.');
    transaction.update(ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  });
}

// Makes a cancelled or released booking active again, on the units chosen.
async function adminRestore(db, id, assignments, uid) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  await db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (booking.status === 'approved') throw new HttpsError('failed-precondition', 'This booking is already active.');
    const chosen = emptyAssignments();
    for (const type of TYPES) {
      if (!booking.needs?.[type]) continue;
      const unit = assignments?.[type];
      if (!unitIds(type).includes(unit)) throw new HttpsError('invalid-argument', `Choose a ${RESOURCES[type].label.toLowerCase()}.`);
      chosen[type] = unit;
    }
    const approved = await approvedOn(transaction, db, booking.date);
    const conflict = conflictWith({ ...booking, id, assignments: chosen }, approved, id);
    if (conflict) throw new HttpsError('already-exists', `That unit is already booked by ${conflict.name || 'someone else'} at that time.`);
    transaction.update(ref, {
      status: 'approved',
      assignments: chosen,
      priorityNotice: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid
    });
  });
}

// Deletes up to 350 records dated more than KEEP_DAYS ago, with their notes.
async function removeOldRecords(db) {
  const cutoff = addDays(todayAt(), -KEEP_DAYS);
  const snapshot = await db.collection(BOOKINGS).where('date', '<', cutoff).limit(350).get();
  const batch = db.batch();
  snapshot.docs.forEach(document => {
    batch.delete(document.ref);
    batch.delete(db.collection(NOTES).doc(document.id));
  });
  if (!snapshot.empty) await batch.commit();
  return { removed: snapshot.size, more: snapshot.size === 350 };
}

async function readNotes(db, ids) {
  if (!Array.isArray(ids) || ids.length > 400) throw new HttpsError('invalid-argument', 'Too many notes requested.');
  const valid = [...new Set(ids)].map(bookingId);
  if (!valid.length) return {};
  const snapshots = await db.getAll(...valid.map(id => db.collection(NOTES).doc(id)));
  return Object.fromEntries(snapshots.filter(snapshot => snapshot.exists).map(snapshot => [snapshot.id, String(snapshot.data().note || '')]));
}

async function saveNote(db, id, value, uid) {
  const ref = db.collection(NOTES).doc(bookingId(id));
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length > NOTE_MAX) throw new HttpsError('invalid-argument', `Notes must be ${NOTE_MAX} characters or fewer.`);
  if (note) await ref.set({ bookingId: id, note, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  else await ref.delete();
}

module.exports = {
  recordsFor,
  submitReservation,
  cancelReservation,
  endEarly,
  adminAdd,
  adminCancel,
  adminRestore,
  removeOldRecords,
  readNotes,
  saveNote
};
