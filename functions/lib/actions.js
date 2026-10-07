'use strict';

// Everything that reads or changes booking records. Each change runs in a
// Firestore transaction, so two people can never end up holding the same unit.

const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { RESOURCES, KEEP_DAYS, NOTE_MAX } = require('./config');
const { addDays, todayAt, hasEnded, earlyEndError } = require('./schedule');
const {
  TYPES, REQUEST_ID, unitIds, unitName, inSentence, emptyAssignments, heldUnit, heldAssignments, typesHeld, neededTypes,
  freeUnit, takeoverTarget, shortenedEnd, conflictWith, text
} = require('./bookings');
const { removeExpired } = require('./guard');

const BOOKINGS = 'bookings';
const NOTES = 'privateBookingNotes';
// Far more than the units can hold in a few days, so nothing is cut off.
const RECORD_LIMIT = 2000;
// One batch holds 500 writes: each old booking and its note.
const REMOVE_LIMIT = 250;
// Notes read per getAll call.
const NOTES_PER_READ = 100;
const BOOKING_ID = /^[A-Za-z0-9_-]{1,160}$/;

function records(snapshot) {
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
}

// Firestore takes at most 30 values in one 'in' filter. The window is a few
// days, but special days opening early could add more.
const IN_LIMIT = 30;

async function onDates(dates, query) {
  const groups = [];
  for (let index = 0; index < dates.length; index += IN_LIMIT) groups.push(dates.slice(index, index + IN_LIMIT));
  return (await Promise.all(groups.map(group => query(group).get()))).flatMap(records);
}

// Every booking on `dates`, in any status (for Admin).
async function allRecordsFor(db, dates) {
  return onDates(dates, group => db.collection(BOOKINGS).where('date', 'in', group).limit(RECORD_LIMIT));
}

// Active bookings on `dates`, plus this device's own in any status.
async function scheduleRecordsFor(db, dates, uid = null) {
  const [active, own] = await Promise.all([
    onDates(dates, group => db.collection(BOOKINGS).where('date', 'in', group).where('status', '==', 'approved').limit(RECORD_LIMIT)),
    uid ? onDates(dates, group => db.collection(BOOKINGS).where('ownerUid', '==', uid).where('date', 'in', group)) : []
  ]);
  const byId = new Map(active.map(record => [record.id, record]));
  for (const record of own) byId.set(record.id, record);
  return [...byId.values()];
}

async function approvedOn(transaction, db, date) {
  return records(await transaction.get(db.collection(BOOKINGS).where('date', '==', date).where('status', '==', 'approved')));
}

const INACTIVE = 'This reservation was already cancelled or replaced.';
const ENDED = 'This reservation has already ended.';

function conflictError(candidate, conflict) {
  const type = TYPES.find(item => heldUnit(candidate, item) && heldUnit(candidate, item) === heldUnit(conflict, item));
  const unit = type ? unitName(candidate.assignments[type]) : 'That unit';
  return new HttpsError('already-exists', `${unit} is already reserved by ${conflict.name || 'someone else'} at that time.`);
}

async function existing(transaction, ref) {
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) throw new HttpsError('not-found', 'That reservation no longer exists.');
  return snapshot.data();
}

function bookingId(value) {
  if (typeof value !== 'string' || !BOOKING_ID.test(value)) {
    throw new HttpsError('invalid-argument', 'Reservation ID is missing.');
  }
  return value;
}

// ---------- Members ----------

// What the member gets back, the first time and on a repeat.
function submitResult(id, record, repeated = false) {
  const type = neededTypes(record)[0];
  const result = { id, unit: heldUnit(record, type), takeover: record.takeover === true };
  return repeated ? { ...result, repeated: true } : result;
}

// The first result again when this device already made the reservation
// `requestId` names, or null. A member whose answer was lost may retry after
// the start time would refuse a new request.
async function repeatedReservation(db, requestId, uid) {
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return null;
  const earlier = await db.collection(BOOKINGS).doc(`r-${requestId}`).get();
  return earlier.exists && earlier.data().ownerUid === uid ? submitResult(earlier.id, earlier.data(), true) : null;
}

// Books the first free unit. When none is free for the whole time, a Contact
// or New Member reservation the member confirmed takes a unit held only by
// lower priorities (only `takeoverUnit`, the unit the member was shown):
//   - a holder that started earlier keeps its unit and now ends when this one starts;
//   - any other holder moves to another free unit, or is released if none is free.
// Each affected holder gets a `priorityNotice` so My reservations can explain it.
// With a `requestId`, a repeat of the same request returns the first result.
async function submitReservation(db, request, uid) {
  const ref = request.requestId ? db.collection(BOOKINGS).doc(`r-${request.requestId}`) : db.collection(BOOKINGS).doc();
  return db.runTransaction(async transaction => {
    if (request.requestId) {
      const earlier = await transaction.get(ref);
      if (earlier.exists && earlier.data().ownerUid === uid) return submitResult(ref.id, earlier.data(), true);
      if (earlier.exists) throw new HttpsError('permission-denied', 'Reload the page and try again.');
    }
    const approved = await approvedOn(transaction, db, request.date);
    const candidate = { ...request, assignments: emptyAssignments() };
    const now = FieldValue.serverTimestamp();
    const record = (unit, takeover) => ({
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
      takeover,
      forced: takeover && request.forceOverride === true,
      createdAt: now,
      updatedAt: now
    });

    const free = freeUnit(request.type, candidate, approved, request.requestedUnit);
    if (free) {
      transaction.create(ref, record(free, false));
      return submitResult(ref.id, record(free, false));
    }

    const target = confirmedTarget(request, candidate, approved);
    if (!target) throw new HttpsError('already-exists', takenMessage(request));
    takeOver(transaction, db, request, target, approved, ref.id, now);
    transaction.create(ref, record(target.unitId, true));
    return submitResult(ref.id, record(target.unitId, true));
  });
}

// The takeover the member confirmed, if it is still possible. It may only take
// the unit the member was shown (`takeoverUnit`, which matches any unit they chose).
// A Force override may take any member reservation there.
function confirmedTarget(request, candidate, approved) {
  const { allowTakeover, requestedUnit, takeoverUnit, forceOverride } = request;
  if (!allowTakeover || !takeoverUnit || (requestedUnit && requestedUnit !== takeoverUnit)) return null;
  return takeoverTarget(request.type, candidate, approved, takeoverUnit, new Date(), forceOverride === true);
}

function takenMessage(request) {
  if (request.allowTakeover) return 'The schedule changed. Check the time and confirm again.';
  return request.requestedUnit
    ? `${unitName(request.requestedUnit)} is taken for part of that time. Choose another time.`
    : `No ${inSentence(RESOURCES[request.type].plural)} are free for that whole time. Choose another time.`;
}

function takeOver(transaction, db, request, target, approved, newId, now) {
  const type = request.type;
  const notice = fields => ({
    type, fromUnit: target.unitId, byPurpose: request.purpose, byBookingId: newId, forced: request.forceOverride === true, at: now, ...fields
  });
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
  // Higher priority first, then the older reservation, so they get first pick
  // of the units still free.
  for (const holder of displaced) {
    const toUnit = freeUnit(type, { date: holder.date, start: holder.start, end: holder.end }, pool);
    const assignments = { ...emptyAssignments(), ...heldAssignments(holder), [type]: toUnit };
    const ref = db.collection(BOOKINGS).doc(holder.id);
    if (toUnit) {
      pool.push({ ...holder, assignments });
      transaction.update(ref, { assignments, priorityNotice: notice({ kind: 'moved', toUnit }), updatedAt: now });
    } else if (typesHeld({ assignments }).length) {
      // An Admin reservation with a room and a TV, say, keeps the TV. Once it
      // holds nothing it is replaced like any other.
      transaction.update(ref, { assignments, priorityNotice: notice({ kind: 'released', toUnit: null }), updatedAt: now });
    } else {
      transaction.update(ref, { status: 'overridden', assignments, priorityNotice: notice({ kind: 'released', toUnit: null }), updatedAt: now });
    }
  }
}

// A member may cancel until the reservation ends.
async function cancelReservation(db, id, uid, now = new Date()) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  await db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (booking.ownerUid !== uid) throw new HttpsError('permission-denied', 'Only the device that made this reservation can cancel it.');
    if (booking.status !== 'approved') throw new HttpsError('failed-precondition', INACTIVE);
    if (hasEnded(booking.date, booking.end, now)) throw new HttpsError('failed-precondition', ENDED);
    transaction.update(ref, { status: 'cancelled', cancelledBy: 'member', updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  });
}

// Moves the end time earlier, to an end that has not passed; the unit and the
// rest of the record stay. `uid` is the member's device, or null when the
// Admin does it; `actor` is recorded as `updatedBy`.
async function endEarly(db, id, end, uid, actor, now = new Date()) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  return db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (uid && booking.ownerUid !== uid) throw new HttpsError('permission-denied', 'Only the device that made this reservation can end it early.');
    if (booking.status !== 'approved') throw new HttpsError('failed-precondition', INACTIVE);
    if (hasEnded(booking.date, booking.end, now)) throw new HttpsError('failed-precondition', ENDED);
    const problem = earlyEndError(booking, end, now);
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
    if (conflict) throw conflictError(fields, conflict);
    const now = FieldValue.serverTimestamp();
    transaction.create(ref, { ...fields, status: 'approved', ownerUid: null, createdAt: now, updatedAt: now, updatedBy: uid });
    if (note) transaction.set(db.collection(NOTES).doc(ref.id), { bookingId: ref.id, note, updatedAt: now, updatedBy: uid });
  });
  return { id: ref.id };
}

// Admin may cancel any active reservation, even one that has ended.
async function adminCancel(db, id, uid) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  await db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    if (booking.status !== 'approved') throw new HttpsError('failed-precondition', INACTIVE);
    transaction.update(ref, { status: 'cancelled', cancelledBy: 'admin', updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  });
}

// Makes a cancelled or released booking active again on the units chosen, or
// gives an active booking the unit a priority reservation took from it (it
// kept its other units). Only the types it needs and lacks are assigned.
async function adminRestore(db, id, assignments, uid) {
  const ref = db.collection(BOOKINGS).doc(bookingId(id));
  await db.runTransaction(async transaction => {
    const booking = await existing(transaction, ref);
    const active = booking.status === 'approved';
    const needed = neededTypes(booking);
    const types = active ? needed.filter(type => !heldUnit(booking, type)) : needed;
    if (active && !types.length) throw new HttpsError('failed-precondition', 'This reservation is already confirmed.');
    if (!types.length) throw new HttpsError('failed-precondition', 'This reservation has no room, whiteboard or TV to restore.');
    const chosen = active ? heldAssignments(booking) : emptyAssignments();
    for (const type of types) {
      const unit = assignments?.[type];
      if (!unitIds(type).includes(unit)) throw new HttpsError('invalid-argument', `Choose a ${inSentence(RESOURCES[type].label)}.`);
      chosen[type] = unit;
    }
    const approved = await approvedOn(transaction, db, booking.date);
    const conflict = conflictWith({ ...booking, id, assignments: chosen }, approved, id);
    if (conflict) throw conflictError({ assignments: chosen }, conflict);
    transaction.update(ref, {
      status: 'approved',
      assignments: chosen,
      priorityNotice: FieldValue.delete(),
      cancelledBy: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid
    });
  });
}

// Deletes up to REMOVE_LIMIT records dated more than KEEP_DAYS ago, with their
// notes, and expired Admin sessions and attempt counters. `more` is true when
// older records are left for another call.
async function removeOldRecords(db, now = new Date()) {
  const cutoff = addDays(todayAt(now), -KEEP_DAYS);
  const snapshot = await db.collection(BOOKINGS).where('date', '<', cutoff).limit(REMOVE_LIMIT + 1).get();
  const old = snapshot.docs.slice(0, REMOVE_LIMIT);
  if (old.length) {
    const batch = db.batch();
    old.forEach(document => {
      batch.delete(document.ref);
      batch.delete(db.collection(NOTES).doc(document.id));
    });
    await batch.commit();
  }
  await removeExpired(db, now);
  return { removed: old.length, more: snapshot.size > REMOVE_LIMIT };
}

// Private notes by booking id, for ids already checked.
async function notesFor(db, ids) {
  const unique = [...new Set(ids)];
  const chunks = [];
  for (let index = 0; index < unique.length; index += NOTES_PER_READ) chunks.push(unique.slice(index, index + NOTES_PER_READ));
  const snapshots = (await Promise.all(chunks.map(chunk => db.getAll(...chunk.map(id => db.collection(NOTES).doc(id)))))).flat();
  return Object.fromEntries(snapshots.filter(snapshot => snapshot.exists).map(snapshot => [snapshot.id, String(snapshot.data().note || '')]));
}

// For Admin pages opened before notes came with the schedule.
async function readNotes(db, ids) {
  if (!Array.isArray(ids)) throw new HttpsError('invalid-argument', 'Choose reservations to read notes for.');
  if (ids.length > 400) throw new HttpsError('invalid-argument', 'Too many notes requested.');
  return notesFor(db, ids.map(bookingId));
}

async function saveNote(db, id, value, uid) {
  const ref = db.collection(NOTES).doc(bookingId(id));
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', 'Notes must be text.');
  let note;
  try {
    note = text(value, NOTE_MAX, 'Notes', false, true);
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message);
  }
  if (note) await ref.set({ bookingId: id, note, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
  else await ref.delete();
}

module.exports = {
  allRecordsFor,
  scheduleRecordsFor,
  repeatedReservation,
  submitReservation,
  cancelReservation,
  endEarly,
  adminAdd,
  adminCancel,
  adminRestore,
  removeOldRecords,
  notesFor,
  readNotes,
  saveNote
};
