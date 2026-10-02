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
//   takeover                true when a member's reservation took a lower-priority unit
//   endedEarlyFrom          the end time before the first "End early"
//   priorityNotice          what a priority reservation changed (see takeOver in actions.js)
//   cancelledBy             'member' | 'admin' once cancelled (older records have none)
//   updatedBy               the device or Admin that last changed it
//
// A unit counts as held when `assignments[type]` is one of that type's unit
// ids. `needs` says which types a reservation asked for; older records may
// have no `needs`, and then the types they hold stand in for it.

const { RESOURCES, PURPOSES, HOLD, NAME_MAX, NOTE_MAX, HOLD_REASON_MAX } = require('./config');
const { toMinutes, timeError, hasPassed, clockAt } = require('./schedule');

const TYPES = Object.keys(RESOURCES);
const PURPOSE_ORDER = Object.keys(PURPOSES);

// Own keys only, so names like 'constructor' are never taken for a purpose.
function isPurpose(value) {
  return typeof value === 'string' && Object.hasOwn(PURPOSES, value);
}

function unitIds(type) {
  return (RESOURCES[type]?.units || []).map(unit => unit.id);
}

// 'room-2' -> 'Room 2'
function unitName(id) {
  for (const resource of Object.values(RESOURCES)) {
    const unit = resource.units.find(item => item.id === id);
    if (unit) return unit.name;
  }
  return '';
}

// 'Study room' -> 'study room', but 'TV' stays 'TV'.
function inSentence(label) {
  return label.replace(/(^|\s)([A-Z])(?=[a-z])/g, (match, space, letter) => space + letter.toLowerCase());
}

function emptyAssignments() {
  return Object.fromEntries(TYPES.map(type => [type, null]));
}

// The unit of `type` that `booking` holds, or null.
function heldUnit(booking, type) {
  const unit = booking?.assignments?.[type];
  return unitIds(type).includes(unit) ? unit : null;
}

// { room, whiteboard, tv } with only the units `booking` really holds.
function heldAssignments(booking) {
  return Object.fromEntries(TYPES.map(type => [type, heldUnit(booking, type)]));
}

// The types `booking` holds a unit of.
function typesHeld(booking) {
  return TYPES.filter(type => heldUnit(booking, type));
}

// The types `booking` asked for. Older records without `needs` count the
// types they hold.
function neededTypes(booking) {
  if (!booking?.needs || typeof booking.needs !== 'object') return typesHeld(booking);
  return TYPES.filter(type => booking.needs[type] === true);
}

// Needed types with no unit, such as a room a priority reservation took from
// a reservation that kept its TV.
function missingTypes(booking) {
  return neededTypes(booking).filter(type => !heldUnit(booking, type));
}

// Records from before September 2026 may carry retired purposes such as
// 'meeting'; they are treated as Other.
function purposeOf(booking) {
  if (booking?.purpose === HOLD) return HOLD;
  return isPurpose(booking?.purpose) ? booking.purpose : 'other';
}

function overlaps(first, second) {
  return first.date === second.date
    && toMinutes(first.start) < toMinutes(second.end)
    && toMinutes(second.start) < toMinutes(first.end);
}

// Approved bookings holding `unitId` during `candidate`'s time.
function holdersOf(type, unitId, candidate, approved) {
  return approved.filter(existing => existing.status === 'approved'
    && heldUnit(existing, type) === unitId
    && overlaps(candidate, existing));
}

// The first unit of `type` that is free for the whole of `candidate`'s time,
// or null. When `requestedUnit` is set, only that unit is considered.
function freeUnit(type, candidate, approved, requestedUnit = null) {
  const units = unitIds(type).filter(id => requestedUnit == null || id === requestedUnit);
  return units.find(id => holdersOf(type, id, candidate, approved).length === 0) || null;
}

// When no unit of `type` is free, the unit a priority reservation may take:
// one whose every holder has a purpose in `canTake`. Lowest priority first:
// the unit whose most important holder is least important (a unit held only
// by Other before one held by any New Member), then the fewest holders, then
// unit order. When `requestedUnit` is set, only that unit is considered.
// Returns { unitId, holders } with holders most important first, or null.
function takeoverTarget(type, candidate, approved, requestedUnit = null, now = new Date()) {
  if (freeUnit(type, candidate, approved)) return null;
  const canTake = PURPOSES[candidate.purpose]?.canTake || [];
  if (!canTake.length) return null;
  const units = unitIds(type).filter(id => requestedUnit == null || id === requestedUnit);
  const options = units.map(unitId => {
    const holders = holdersOf(type, unitId, candidate, approved);
    const takeable = holders.every(holder => holder.purpose !== HOLD && canTake.includes(purposeOf(holder))
      && !inUse(holder, candidate, now));
    return holders.length && takeable ? { unitId, holders: sortByPriority(holders) } : null;
  }).filter(Boolean);
  const topRank = option => rankOf(option.holders[0]);
  options.sort((a, b) => topRank(b) - topRank(a)
    || a.holders.length - b.holders.length
    || units.indexOf(a.unitId) - units.indexOf(b.unitId));
  return options[0] || null;
}

// A reservation already under way is never moved or replaced. One that began
// earlier than the priority reservation is shortened instead; one that began
// this very minute, at the same time, cannot be, so its unit is not taken.
function inUse(holder, candidate, now) {
  if (shortenedEnd(holder, candidate)) return false;
  const clock = clockAt(now);
  return holder.date < clock.date || (holder.date === clock.date && toMinutes(holder.start) <= clock.minutes);
}

// 0 for the most important purpose.
function rankOf(booking) {
  return PURPOSE_ORDER.indexOf(purposeOf(booking));
}

// Most important first; the older reservation first within a purpose.
function sortByPriority(bookings) {
  const created = booking => (typeof booking.createdAt?.toMillis === 'function'
    ? booking.createdAt.toMillis()
    : Number(booking.createdAt)) || 0;
  return bookings.slice().sort((a, b) => rankOf(a) - rankOf(b) || created(a) - created(b));
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
    && TYPES.some(type => heldUnit(candidate, type) && heldUnit(candidate, type) === heldUnit(existing, type))) || null;
}

// Control characters and the bidi controls that could reorder what other
// people see. Joiners (ZWJ, ZWNJ) stay: some names and emoji need them.
const CONTROLS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

// Typed text, cleaned: one space between words, no control characters, NFC.
// With `lines`, line breaks are kept (private notes). Lengths count UTF-16
// units, as a browser's maxlength does.
function cleanText(value, lines = false) {
  if (typeof value !== 'string') return '';
  const normal = value.normalize('NFC');
  if (lines) {
    const kept = { '\n': '\n', '\t': ' ' };
    return normal.replace(/\r\n?/g, '\n').replace(CONTROLS, match => kept[match] ?? '').trim();
  }
  return normal.replace(/\s/gu, ' ').replace(CONTROLS, '').replace(/ {2,}/g, ' ').trim();
}

function text(value, max, field, required, lines = false) {
  const result = cleanText(value, lines);
  if (required && !/[\p{L}\p{N}]/u.test(result)) throw new Error(`${field} is required.`);
  if (result.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return result;
}

// A browser's id for one reservation request, so a retry is not a second booking.
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

// The date and times every request shares, checked against the clock.
function parseWhen(input, now) {
  const date = typeof input.date === 'string' ? input.date : '';
  const problem = timeError(date, input.start, input.end, now);
  if (problem) throw new Error(problem);
  if (hasPassed(date, input.start, now)) throw new Error('That start time has already passed. Choose a later time.');
  return { date, start: input.start, end: input.end };
}

// null, or a unit id of `type`.
function optionalUnit(value, type) {
  if (value == null) return null;
  if (!unitIds(type).includes(value)) throw new Error('Choose a valid unit.');
  return value;
}

// A member's reservation request. Throws an Error with a message for the member.
function parseMemberRequest(data, now = new Date()) {
  const input = data && typeof data === 'object' ? data : {};
  const when = parseWhen(input, now);
  const type = input.resourceType;
  if (!TYPES.includes(type)) throw new Error('Choose a study room, whiteboard or TV.');
  if (!isPurpose(input.purpose)) throw new Error('Choose what the reservation is for.');
  if (input.requestId != null && !(typeof input.requestId === 'string' && REQUEST_ID.test(input.requestId))) {
    throw new Error('Reload the page and try again.');
  }
  return {
    ...when,
    type,
    requestedUnit: optionalUnit(input.requestedUnit, type),
    purpose: input.purpose,
    // Taking a lower-priority reservation's unit only happens when the member
    // was shown that and confirmed it, and then only the unit they were shown
    // (`takeoverUnit`; older pages do not send it).
    allowTakeover: input.allowTakeover === true,
    takeoverUnit: optionalUnit(input.takeoverUnit, type),
    // Makes a repeated request (a lost response, a double tap) harmless.
    requestId: input.requestId ?? null,
    name: text(input.name, NAME_MAX, 'Your name', true),
    reservedFor: text(input.reservedFor, PURPOSES[input.purpose].detailMax, PURPOSES[input.purpose].detailLabel, true)
  };
}

// A booking the Admin adds directly. Units are chosen by the Admin.
function parseAdminBooking(data, now = new Date()) {
  const input = data && typeof data === 'object' ? data : {};
  const when = parseWhen(input, now);
  const purpose = input.purpose === HOLD || isPurpose(input.purpose) ? input.purpose : '';
  if (!purpose) throw new Error('Choose what the reservation is for.');
  const needs = {};
  const assignments = emptyAssignments();
  for (const type of TYPES) {
    const unit = input.assignments?.[type];
    needs[type] = unit != null;
    if (unit == null) continue;
    if (!unitIds(type).includes(unit)) throw new Error(`Choose a valid ${inSentence(RESOURCES[type].label)}.`);
    assignments[type] = unit;
  }
  if (!TYPES.some(type => needs[type])) throw new Error('Choose at least one room, whiteboard or TV.');
  return {
    ...when,
    name: text(input.name, NAME_MAX, 'Name', true),
    purpose,
    reservedFor: purpose === HOLD
      ? text(input.reservedFor, HOLD_REASON_MAX, 'Reason', false)
      : text(input.reservedFor, PURPOSES[purpose].detailMax, PURPOSES[purpose].detailLabel, false),
    needs,
    assignments,
    note: text(input.note, NOTE_MAX, 'Note', false, true)
  };
}

module.exports = {
  TYPES,
  REQUEST_ID,
  isPurpose,
  unitIds,
  unitName,
  inSentence,
  emptyAssignments,
  heldUnit,
  heldAssignments,
  typesHeld,
  neededTypes,
  missingTypes,
  purposeOf,
  overlaps,
  freeUnit,
  takeoverTarget,
  shortenedEnd,
  conflictWith,
  text,
  parseMemberRequest,
  parseAdminBooking
};
