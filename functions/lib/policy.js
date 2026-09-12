'use strict';

const ALLOWED_UNITS = Object.freeze({
  room: Object.freeze(['room-1', 'room-2', 'room-3', 'room-4']),
  whiteboard: Object.freeze(['wb-1', 'wb-2', 'wb-3', 'wb-4', 'wb-5']),
  tv: Object.freeze(['tv-1', 'tv-2', 'tv-3'])
});

// `meeting`, `group` and `study-member` are retained only so earlier records
// still validate. Members now choose Contact, New Member or Other.
const PURPOSES = Object.freeze(['contact', 'new-member', 'group', 'study-member', 'meeting', 'other', 'blocked']);
// What a member may choose today, and what a priority takeover may claim.
const MEMBER_PURPOSES = Object.freeze(['contact', 'new-member', 'other']);
const OVERRIDE_PURPOSES = Object.freeze(['contact', 'new-member']);
// The only purpose that can be taken from someone.
const OVERRIDABLE_PURPOSE = 'other';
const CERTAINTIES = Object.freeze(['confirmed', 'tentative']);
const RESOURCE_TYPES = Object.freeze(['room', 'whiteboard', 'tv']);

function parseMinutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

function isoWeekday(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString))) return NaN;
  const date = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return NaN;
  if (date.toISOString().slice(0, 10) !== dateString) return NaN;
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function isoDateInLosAngeles(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/* Every reservation on a valid booking day is confirmed immediately — no day
   waits for approval any more. Availability is still the real gate: the
   submission is refused when no unit of the requested type is free. The
   signature keeps `now` so callers and tests do not have to change. */
function shouldAutoApproveMemberBooking(date, now = new Date()) {
  const weekday = isoWeekday(date);
  return weekday === 2 || weekday === 6;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function upcomingTuesdayAndSaturday(now = new Date()) {
  const today = isoDateInLosAngeles(now);
  const dates = [];
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = addDays(today, offset);
    const weekday = isoWeekday(candidate);
    if (weekday === 2 || weekday === 6) dates.push(candidate);
  }
  return dates.sort();
}

function overlaps(start, end, blockStart, blockEnd) {
  return start < blockEnd && blockStart < end;
}

function validateBookingTime(date, startValue, endValue, now = new Date(), requireUpcoming = true) {
  const start = parseMinutes(startValue);
  const end = parseMinutes(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Times must use HH:MM format.';
  if (start % 30 !== 0 || end % 30 !== 0) return 'Times must use 30-minute boundaries.';
  if (start < 10 * 60 || end > 23 * 60 || start >= end) {
    return 'Bookings must be between 10:00 and 23:00.';
  }
  const weekday = isoWeekday(date);
  if (weekday !== 2 && weekday !== 6) return 'Bookings are available only on Tuesday or Saturday.';
  if (requireUpcoming && !upcomingTuesdayAndSaturday(now).includes(date)) {
    return 'Choose the upcoming Tuesday or Saturday.';
  }
  // Service times changed on 12 September 2026. Saturday holds all three,
  // Tuesday only the evening one.
  const serviceBlocks = weekday === 2
    ? [[19 * 60 + 30, 20 * 60 + 30]]
    : [[10 * 60, 11 * 60], [14 * 60 + 30, 15 * 60 + 30], [19 * 60 + 30, 20 * 60 + 30]];
  if (serviceBlocks.some(([blockStart, blockEnd]) => overlaps(start, end, blockStart, blockEnd))) {
    return 'This time overlaps a service.';
  }
  return null;
}

/* Shortening an existing reservation. The new ending must stay on the same
   30-minute grid, leave at least one 30-minute block standing, and remain a
   valid range for that day — a booking that no longer keeps any time should
   be cancelled instead. Returns an error message, or null when allowed. */
function earlyEndError(booking, requestedEnd, now = new Date()) {
  if (!booking || typeof booking !== 'object') return 'This reservation cannot be shortened.';
  const start = parseMinutes(booking.start);
  const current = parseMinutes(booking.end);
  const next = parseMinutes(requestedEnd);
  if (!Number.isFinite(start) || !Number.isFinite(current)) return 'This reservation cannot be shortened.';
  if (!Number.isFinite(next)) return 'Times must use HH:MM format.';
  if (next % 30 !== 0) return 'Times must use 30-minute boundaries.';
  if (next >= current) return 'Choose an earlier ending than the current one.';
  if (next <= start) return 'A reservation must keep at least 30 minutes. Cancel it instead.';
  return validateBookingTime(booking.date, booking.start, requestedEnd, now, true);
}

function priorityForPurpose(purpose) {
  return ({ contact: 0, 'new-member': 1, group: 2, 'study-member': 2, meeting: 2, other: 3 }[purpose] ?? 3);
}

function sortBookingsByPriority(bookings) {
  return bookings.slice().sort((first, second) => {
    const priorityDifference = priorityForPurpose(first.purpose) - priorityForPurpose(second.purpose);
    if (priorityDifference) return priorityDifference;
    const firstCreated = typeof first.createdAt === 'number' ? first.createdAt : (first.createdAt?.toMillis?.() ?? first.createdAt?.seconds * 1000 ?? 0);
    const secondCreated = typeof second.createdAt === 'number' ? second.createdAt : (second.createdAt?.toMillis?.() ?? second.createdAt?.seconds * 1000 ?? 0);
    return firstCreated - secondCreated;
  });
}

function validateNeeds(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) return 'At least one resource is required.';
  const keys = Object.keys(needs);
  if (keys.some(key => !['room', 'whiteboard', 'tv'].includes(key))) return 'Unknown resource type.';
  if (keys.some(key => typeof needs[key] !== 'boolean')) return 'Resource choices must be true or false.';
  if (!needs.room && !needs.whiteboard && !needs.tv) return 'At least one resource is required.';
  return null;
}

function normalizeLegacyResourceMaps(needs, assignments, options = {}) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('At least one resource is required.');
  const sourceAssignments = assignments && typeof assignments === 'object' && !Array.isArray(assignments)
    ? assignments
    : {};
  const allowedKeys = RESOURCE_TYPES.concat('podium');
  if (Object.keys(needs).some(key => !allowedKeys.includes(key))) throw new Error('Unknown resource type.');
  if (Object.keys(sourceAssignments).some(key => !allowedKeys.includes(key))) throw new Error('Unknown assignment type.');
  const legacyPodiumValues = [undefined, null, false];
  if (!options.dropAnyPodiumValue
      && (!legacyPodiumValues.includes(needs.podium) || !legacyPodiumValues.includes(sourceAssignments.podium))) {
    throw new Error('Legacy podium data must be empty before approval.');
  }
  const normalizedNeeds = {};
  const normalizedAssignments = {};
  for (const type of RESOURCE_TYPES) {
    if (typeof needs[type] !== 'boolean') throw new Error('Resource choices must be true or false.');
    normalizedNeeds[type] = needs[type];
    const value = sourceAssignments[type];
    normalizedAssignments[type] = typeof value === 'string' ? value : null;
  }
  if (!normalizedNeeds.room && !normalizedNeeds.whiteboard && !normalizedNeeds.tv) {
    throw new Error('At least one resource is required.');
  }
  return { needs: normalizedNeeds, assignments: normalizedAssignments };
}

function migrationResourceUpdate(booking) {
  const normalized = normalizeLegacyResourceMaps(
    booking && booking.needs,
    booking && booking.assignments,
    { dropAnyPodiumValue: true }
  );
  const retiredBaptismRoom = normalized.assignments.room === 'room-baptism';
  return {
    needs: normalized.needs,
    assignments: retiredBaptismRoom
      ? { room: null, whiteboard: null, tv: null }
      : normalized.assignments,
    preferredRoom: normalized.needs.room && ALLOWED_UNITS.room.includes(booking.preferredRoom)
      ? booking.preferredRoom
      : null,
    status: retiredBaptismRoom ? 'pending' : booking.status,
    retiredBaptismRoom
  };
}

function normalizeBookingIds(values, maximum = 50) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) {
    throw new Error(`Provide between 1 and ${maximum} booking IDs.`);
  }
  const bookingIds = Array.from(new Set(values));
  if (bookingIds.some(id => typeof id !== 'string' || !id || id.length > 160 || id.includes('/'))) {
    throw new Error('One or more booking IDs are invalid.');
  }
  return bookingIds;
}

function canonicalAssignments(needs, assignments) {
  const source = assignments && typeof assignments === 'object' ? assignments : {};
  const result = { room: null, whiteboard: null, tv: null };
  for (const type of Object.keys(result)) {
    if (!needs[type]) continue;
    if (!ALLOWED_UNITS[type].includes(source[type])) throw new Error(`A valid ${type} assignment is required.`);
    result[type] = source[type];
  }
  return result;
}

function rangesOverlap(first, second) {
  return first.date === second.date
    && parseMinutes(first.start) < parseMinutes(second.end)
    && parseMinutes(second.start) < parseMinutes(first.end);
}

function availableUnitForType(type, candidate, approvedBookings) {
  const units = ALLOWED_UNITS[type] || [];
  return units.find(unitId => !approvedBookings.some(existing =>
    existing.status === 'approved' &&
    existing.assignments && existing.assignments[type] === unitId &&
    rangesOverlap(candidate, existing)
  )) || null;
}

/* Units of `type` a higher priority could take for `candidate`'s range: the
   unit must be occupied, and every approved reservation touching it in that
   range must be an overridable Other. A unit with nothing on it is simply
   free and is never listed here. Ordered so the least disruptive comes first. */
function reclaimableUnitsForType(type, candidate, approvedBookings) {
  const units = ALLOWED_UNITS[type] || [];
  return units.map(unitId => {
    const holders = approvedBookings.filter(existing =>
      existing.status === 'approved' &&
      existing.assignments && existing.assignments[type] === unitId &&
      rangesOverlap(candidate, existing));
    if (!holders.length) return null;
    if (!holders.every(existing => existing.purpose === OVERRIDABLE_PURPOSE)) return null;
    return { unitId, holders: sortBookingsByPriority(holders) };
  }).filter(Boolean).sort((first, second) => first.holders.length - second.holders.length
    || units.indexOf(first.unitId) - units.indexOf(second.unitId));
}

/* The single unit an override would claim, or null when the caller should
   simply book a free unit (or has nothing to take). */
function overrideTarget(type, candidate, approvedBookings) {
  if (availableUnitForType(type, candidate, approvedBookings)) return null;
  return reclaimableUnitsForType(type, candidate, approvedBookings)[0] || null;
}

function shorterAvailableEnd(type, candidate, approvedBookings) {
  const start = parseMinutes(candidate.start);
  const attemptedEnd = parseMinutes(candidate.end);
  let suggestion = null;
  for (let end = start + 30; end < attemptedEnd; end += 30) {
    const value = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    if (availableUnitForType(type, { ...candidate, end: value }, approvedBookings)) suggestion = value;
    else break;
  }
  return suggestion;
}

function conflictingBooking(candidate, approvedBookings, excludeId = null) {
  return approvedBookings.find(existing => {
    if (existing.id === excludeId || existing.status !== 'approved' || !rangesOverlap(candidate, existing)) return false;
    return ['room', 'whiteboard', 'tv'].some(type => (
      candidate.assignments[type] && candidate.assignments[type] === (existing.assignments || {})[type]
    ));
  }) || null;
}

function trimmedText(value, max, field, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} is too long.`);
  return text;
}

function validateDirectBooking(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Booking details are required.');
  const date = trimmedText(input.date, 10, 'Date', true);
  const timeError = validateBookingTime(date, input.start, input.end, now, true);
  if (timeError) throw new Error(timeError);
  const needsError = validateNeeds(input.needs);
  if (needsError) throw new Error(needsError);
  const name = trimmedText(input.name, 120, 'Name', true);
  const purpose = PURPOSES.includes(input.purpose) ? input.purpose : 'other';
  const purposeOther = trimmedText(input.purposeOther, 240, 'Purpose details');
  if (purpose === 'other' && !purposeOther) throw new Error('Purpose details are required.');
  const certainty = CERTAINTIES.includes(input.certainty) ? input.certainty : 'confirmed';
  const preferredRoom = input.preferredRoom == null ? null : input.preferredRoom;
  if (preferredRoom && !ALLOWED_UNITS.room.includes(preferredRoom)) throw new Error('Preferred room is invalid.');
  return {
    schemaVersion: 3,
    date,
    start: input.start,
    end: input.end,
    name,
    needs: { room: !!input.needs.room, whiteboard: !!input.needs.whiteboard, tv: !!input.needs.tv },
    preferredRoom: input.needs.room ? preferredRoom : null,
    purpose,
    purposeOther,
    certainty,
    status: 'approved',
    assignments: canonicalAssignments(input.needs, input.assignments)
  };
}

module.exports = {
  ALLOWED_UNITS,
  MEMBER_PURPOSES,
  OVERRIDABLE_PURPOSE,
  OVERRIDE_PURPOSES,
  overrideTarget,
  reclaimableUnitsForType,
  addDays,
  availableUnitForType,
  canonicalAssignments,
  conflictingBooking,
  earlyEndError,
  isoDateInLosAngeles,
  isoWeekday,
  migrationResourceUpdate,
  normalizeBookingIds,
  normalizeLegacyResourceMaps,
  parseMinutes,
  priorityForPurpose,
  rangesOverlap,
  sortBookingsByPriority,
  shorterAvailableEnd,
  shouldAutoApproveMemberBooking,
  upcomingTuesdayAndSaturday,
  validateBookingTime,
  validateDirectBooking,
  validateNeeds
};
