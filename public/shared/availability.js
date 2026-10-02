// Which times and units are open, worked out from the rules the server sends
// (`config` and each `day`) and the rows on the schedule. The server makes
// the same checks again when a reservation is sent; this only decides what
// to offer. Times inside this module are minutes after midnight.

import { toMinutes, toTime, nowIn } from './format.js';

export function unitsOf(config, type) {
  return config.resources[type]?.units || [];
}

// { type, unit } for a unit id such as 'wb-4', or null.
export function findUnit(config, id) {
  for (const [type, resource] of Object.entries(config.resources)) {
    const unit = resource.units.find(item => item.id === id);
    if (unit) return { type, unit };
  }
  return null;
}

export function unitName(config, id) {
  return findUnit(config, id)?.unit.name || '';
}

// Every slot start in the day, in minutes.
export function slotStarts(config) {
  const starts = [];
  for (let time = toMinutes(config.open); time < toMinutes(config.close); time += config.slotMinutes) starts.push(time);
  return starts;
}

export function serviceAt(day, minute) {
  return day.services.find(service => toMinutes(service.start) <= minute && minute < toMinutes(service.end)) || null;
}

function overlaps(row, start, end) {
  return toMinutes(row.start) < end && start < toMinutes(row.end);
}

// The row holding `unitId` at `minute`, if any.
export function occupant(rows, date, unitId, minute) {
  return rows.find(row => row.date === date && row.unit === unitId && overlaps(row, minute, minute + 1)) || null;
}

function holders(rows, date, unitId, start, end) {
  return rows.filter(row => row.date === date && row.unit === unitId && overlaps(row, start, end));
}

// On the grid, inside hours, and clear of services.
export function validRange(config, day, start, end) {
  const slot = config.slotMinutes;
  return Number.isInteger(start) && Number.isInteger(end) && start % slot === 0 && end % slot === 0
    && start >= toMinutes(config.open) && end <= toMinutes(config.close) && start < end
    && !day.services.some(service => start < toMinutes(service.end) && toMinutes(service.start) < end);
}

function candidates(config, type, unitId) {
  return unitsOf(config, type).map(unit => unit.id).filter(id => unitId == null || id === unitId);
}

// How `purpose` could get a unit of `type` for the whole range:
// { unit, takeover: false } when one is free, { unit, takeover: true } when it
// would take a lower-priority reservation's unit, or null. A takeover is only
// offered when no unit of that type is free at all, never takes an Admin hold
// or a reservation already under way that cannot be shortened (one that began
// this very minute),
// and takes from the lowest priorities first: a unit held only by Other comes
// before one with a New Member reservation, then fewer reservations, then unit
// order. `unitId` limits the choice to one unit. Mirrors takeoverTarget in
// functions/lib/bookings.js.
export function rangeChoice(config, rows, day, type, start, end, purpose, unitId = null, now = new Date()) {
  if (!validRange(config, day, start, end)) return null;
  const isFree = id => holders(rows, day.date, id, start, end).length === 0;
  const units = candidates(config, type, unitId);
  const free = units.find(isFree);
  if (free) return { unit: free, takeover: false };
  if (candidates(config, type, null).some(isFree)) return null;
  const option = takeoverOption(config, rows, day, type, start, end, purpose, units, now);
  return option ? { unit: option.id, takeover: true } : null;
}

function rankOf(config, purpose) {
  const order = Object.keys(config.purposes);
  return order.includes(purpose) ? order.indexOf(purpose) : order.length;
}

function takeoverOption(config, rows, day, type, start, end, purpose, units, now) {
  const canTake = config.purposes[purpose]?.canTake || [];
  if (!canTake.length) return null;
  const clock = nowIn(config.timeZone, now);
  const inUse = row => toMinutes(row.start) >= start
    && (day.date < clock.date || (day.date === clock.date && toMinutes(row.start) <= clock.minutes));
  // The most important reservation on a unit decides how protected it is.
  const protection = taken => Math.min(...taken.map(row => rankOf(config, row.purpose)));
  const options = units
    .map(id => ({ id, taken: holders(rows, day.date, id, start, end) }))
    .filter(option => option.taken.length
      && option.taken.every(row => row.purpose !== config.hold && canTake.includes(row.purpose) && !inUse(row)));
  options.sort((a, b) => protection(b.taken) - protection(a.taken)
    || a.taken.length - b.taken.length
    || units.indexOf(a.id) - units.indexOf(b.id));
  return options[0] || null;
}

// What a takeover would do to each reservation on the unit it takes:
// { unit, affected: [{ row, effect, toEnd }] }, or null when the range is not
// a takeover. `effect` is 'shortened' (it began earlier, so it now ends when
// this one starts, `toEnd`), 'moved' (another unit is free for its whole
// time), 'replaced' (none is) or 'released' (none is, but the reservation
// also holds a unit of another type, which it keeps: an Admin reservation
// with a room and a TV keeps the TV). Reservations on one unit never overlap each
// other, so the order the server places them in cannot change the outcome.
// Mirrors takeOver in functions/lib/actions.js.
export function takeoverEffect(config, rows, day, type, start, end, purpose, unitId = null, now = new Date()) {
  const choice = rangeChoice(config, rows, day, type, start, end, purpose, unitId, now);
  if (!choice?.takeover) return null;
  const taken = holders(rows, day.date, choice.unit, start, end);
  const pool = rows.filter(row => !taken.includes(row))
    .concat({ date: day.date, unit: choice.unit, start: toTime(start), end: toTime(end) });
  const affected = taken.map(row => {
    if (toMinutes(row.start) < start) {
      pool.push({ ...row, end: toTime(start) });
      return { row, effect: 'shortened', toEnd: toTime(start) };
    }
    return { row, effect: null, toEnd: null };
  });
  for (const item of affected.filter(entry => !entry.effect)) {
    const unit = candidates(config, type, null)
      .find(id => holders(pool, day.date, id, toMinutes(item.row.start), toMinutes(item.row.end)).length === 0);
    const keepsOther = rows.some(row => row.id === item.row.id && row.date === day.date && row.type !== type);
    item.effect = unit ? 'moved' : keepsOther ? 'released' : 'replaced';
  }
  return { unit: choice.unit, affected };
}

// Start times from `earliest` on with at least one possible end. `takeover`
// is true when every end from that start would take a lower-priority
// reservation.
export function startChoices(config, rows, day, type, purpose, unitId = null, earliest = 0) {
  const choices = [];
  for (const start of slotStarts(config)) {
    if (start < earliest || serviceAt(day, start)) continue;
    const ends = endChoices(config, rows, day, type, start, purpose, unitId);
    if (ends.length) choices.push({ start, takeover: ends.every(end => end.takeover) });
  }
  return choices;
}

export function endChoices(config, rows, day, type, start, purpose, unitId = null) {
  const choices = [];
  for (let end = start + config.slotMinutes; end <= toMinutes(config.close); end += config.slotMinutes) {
    const choice = rangeChoice(config, rows, day, type, start, end, purpose, unitId);
    if (choice) choices.push({ end, ...choice });
  }
  return choices;
}

// The first start that has not passed. A time that has already begun cannot
// be reserved: on `date` itself that is the current time rounded up to the
// grid (11:30 at 11:10, 11:00 at exactly 11:00); on any later day, 0. Mirrors
// hasPassed in functions/lib/schedule.js.
export function earliestStart(config, date, now = new Date()) {
  const clock = nowIn(config.timeZone, now);
  if (date !== clock.date) return date < clock.date ? Infinity : 0;
  return Math.ceil(clock.minutes / config.slotMinutes) * config.slotMinutes;
}

// True once a reservation ending at `end` on `date` is over.
export function hasEnded(config, date, end, now = new Date()) {
  const clock = nowIn(config.timeZone, now);
  return date < clock.date || (date === clock.date && toMinutes(end) <= clock.minutes);
}

// Every time a reservation could end at instead, as 'HH:MM': after its first
// slot and before its current end.
export function earlierEnds(config, start, end) {
  const ends = [];
  for (let time = toMinutes(start) + config.slotMinutes; time < toMinutes(end); time += config.slotMinutes) ends.push(toTime(time));
  return ends;
}

// The ends End early can choose now: after the first slot, before the current
// end, and not already passed. Mirrors earlyEnds in functions/lib/schedule.js.
export function earlyEndChoices(config, date, start, end, now = new Date()) {
  const earliest = earliestStart(config, date, now);
  return earlierEnds(config, start, end).filter(time => toMinutes(time) >= earliest);
}
