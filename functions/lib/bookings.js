'use strict';

// Booking rules that need no database: checking requests, finding a free
// unit, and working out what a priority reservation may take.
//
// A booking record, as stored in Firestore:
//   date, start, end        'YYYY-MM-DD', 'HH:MM', 'HH:MM'
//   name                    full name of the person who booked
//   purpose                 'contact' | 'new-member' | 'other' | 'blocked'
//   reservedFor             contact name, member name, or purpose text
//   needs                   { room, whiteboard, tv } booleans
//   assignments             { room, whiteboard, tv } unit ids or null
//   status                  'approved' | 'cancelled' | 'overridden' (older records may be 'pending' or 'declined')
//   ownerUid                the device that booked it; null for Admin bookings
//   endedEarlyFrom          the end time before the first "End early"
//   priorityNotice          what a priority reservation changed (see takeOver in actions.js)

const { RESOURCES, PURPOSES, HOLD, NAME_MAX, NOTE_MAX } = require('./config');
const { toMinutes, timeError } = require('./schedule');

const TYPES = Object.keys(RESOURCES);
const PURPOSE_ORDER = Object.keys(PURPOSES);

function unitIds(type) {
  return (RESOURCES[type]?.units || []).map(unit => unit.id);
}

function emptyAssignments() {
  return Object.fromEntries(TYPES.map(type => [type, null]));
}

// Records from before September 2026 may carry retired purposes such as
// 'meeting'; they are treated as Other.
function purposeOf(booking) {
  if (booking?.purpose === HOLD) return HOLD;
  return PURPOSES[booking?.purpose] ? booking.purpose : 'other';
}

function overlaps(first, second) {
  return first.date === second.date
    && toMinutes(first.start) < toMinutes(second.end)
    && toMinutes(second.start) < toMinutes(first.end);
}

// Approved bookings holding `unitId` during `candidate`'s time.
function holdersOf(type, unitId, candidate, approved) {
  return approved.filter(existing => existing.status === 'approved'
    && existing.assignments?.[type] === unitId
    && overlaps(candidate, existing));
}

// The first unit of `type` that is free for the whole of `candidate`'s time,
// or null. When `requestedUnit` is set, only that unit is considered.
function freeUnit(type, candidate, approved, requestedUnit = null) {
  const units = unitIds(type).filter(id => requestedUnit == null || id === requestedUnit);
  return units.find(id => holdersOf(type, id, candidate, approved).length === 0) || null;
}

// When no unit is free, the unit a priority reservation may take: one whose
// every holder has a purpose in `canTake`. Fewest holders first, then unit
// order. Returns { unitId, holders } or null.
function takeoverTarget(type, candidate, approved, requestedUnit = null) {
  if (freeUnit(type, candidate, approved, requestedUnit)) return null;
  const canTake = PURPOSES[candidate.purpose]?.canTake || [];
  if (!canTake.length) return null;
  const units = unitIds(type).filter(id => requestedUnit == null || id === requestedUnit);
  const options = units.map(unitId => {
    const holders = holdersOf(type, unitId, candidate, approved);
    const takeable = holders.every(holder => holder.purpose !== HOLD && canTake.includes(purposeOf(holder)));
    return holders.length && takeable ? { unitId, holders: sortByPriority(holders) } : null;
  }).filter(Boolean);
  options.sort((a, b) => a.holders.length - b.holders.length || units.indexOf(a.unitId) - units.indexOf(b.unitId));
  return options[0] || null;
}

function sortByPriority(bookings) {
  const rank = booking => PURPOSE_ORDER.indexOf(purposeOf(booking));
  const created = booking => (typeof booking.createdAt?.toMillis === 'function'
    ? booking.createdAt.toMillis()
    : Number(booking.createdAt)) || 0;
  return bookings.slice().sort((a, b) => rank(a) - rank(b) || created(a) - created(b));
}

// A reservation that started before the priority reservation keeps its unit
// and ends when the priority reservation begins. Returns that end, or null.
function shortenedEnd(holder, candidate) {
  return toMinutes(holder.start) < toMinutes(candidate.start) ? candidate.start : null;
}

// Any approved booking that already uses one of `candidate`'s units.
function conflictWith(candidate, approved, excludeId = null) {
  return approved.find(existing => existing.id !== excludeId
    && existing.status === 'approved'
    && overlaps(candidate, existing)
    && TYPES.some(type => candidate.assignments[type] && candidate.assignments[type] === existing.assignments?.[type])) || null;
}

function text(value, max, field, required) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !/[\p{L}\p{N}]/u.test(result)) throw new Error(`${field} is required.`);
  if (result.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return result;
}

// A member's reservation request. Throws an Error with a message for the member.
function parseMemberRequest(data, now = new Date()) {
  const input = data && typeof data === 'object' ? data : {};
  const date = typeof input.date === 'string' ? input.date : '';
  const problem = timeError(date, input.start, input.end, now);
  if (problem) throw new Error(problem);
  const type = input.resourceType;
  if (!TYPES.includes(type)) throw new Error('Choose a study room, whiteboard or TV.');
  if (!PURPOSES[input.purpose]) throw new Error('Choose what the reservation is for.');
  const requestedUnit = input.requestedUnit == null ? null : input.requestedUnit;
  if (requestedUnit !== null && !unitIds(type).includes(requestedUnit)) throw new Error('Choose a valid unit.');
  return {
    date,
    start: input.start,
    end: input.end,
    type,
    requestedUnit,
    purpose: input.purpose,
    // Taking a lower-priority reservation's unit only happens when the member
    // was shown that and confirmed it.
    allowTakeover: input.allowTakeover === true,
    name: text(input.name, NAME_MAX, 'Your name', true),
    reservedFor: text(input.reservedFor, PURPOSES[input.purpose].detailMax, PURPOSES[input.purpose].detailLabel, true)
  };
}

// A booking the Admin adds directly. Units are chosen by the Admin.
function parseAdminBooking(data, now = new Date()) {
  const input = data && typeof data === 'object' ? data : {};
  const date = typeof input.date === 'string' ? input.date : '';
  const problem = timeError(date, input.start, input.end, now);
  if (problem) throw new Error(problem);
  const purpose = input.purpose === HOLD || PURPOSES[input.purpose] ? input.purpose : '';
  if (!purpose) throw new Error('Choose what the booking is for.');
  const needs = {};
  const assignments = emptyAssignments();
  for (const type of TYPES) {
    const unit = input.assignments?.[type];
    needs[type] = unit != null;
    if (unit == null) continue;
    if (!unitIds(type).includes(unit)) throw new Error(`Choose a valid ${RESOURCES[type].label.toLowerCase()}.`);
    assignments[type] = unit;
  }
  if (!TYPES.some(type => needs[type])) throw new Error('Choose at least one room, whiteboard or TV.');
  return {
    date,
    start: input.start,
    end: input.end,
    name: text(input.name, NAME_MAX, 'Name', true),
    purpose,
    reservedFor: purpose === HOLD
      ? text(input.reservedFor, 240, 'Reason', false)
      : text(input.reservedFor, PURPOSES[purpose].detailMax, PURPOSES[purpose].detailLabel, false),
    needs,
    assignments,
    note: text(input.note, NOTE_MAX, 'Note', false)
  };
}

module.exports = {
  TYPES,
  unitIds,
  emptyAssignments,
  purposeOf,
  overlaps,
  freeUnit,
  takeoverTarget,
  shortenedEnd,
  conflictWith,
  parseMemberRequest,
  parseAdminBooking
};
