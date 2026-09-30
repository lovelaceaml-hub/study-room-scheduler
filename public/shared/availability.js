// Which times and units are open, worked out from the rules the server sends
// (`config` and each `day`) and the rows on the schedule. The server makes
// the same checks again when a reservation is sent; this only decides what
// to offer. Times inside this module are minutes after midnight.

import { toMinutes, toTime } from './format.js';

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
// would take a lower-priority reservation's unit, or null.
export function rangeChoice(config, rows, day, type, start, end, purpose, unitId = null) {
  if (!validRange(config, day, start, end)) return null;
  const units = candidates(config, type, unitId);
  const free = units.find(id => holders(rows, day.date, id, start, end).length === 0);
  if (free) return { unit: free, takeover: false };
  const canTake = config.purposes[purpose]?.canTake || [];
  if (!canTake.length) return null;
  const options = units
    .map(id => ({ id, taken: holders(rows, day.date, id, start, end) }))
    .filter(option => option.taken.length && option.taken.every(row => canTake.includes(row.purpose)));
  options.sort((a, b) => a.taken.length - b.taken.length || units.indexOf(a.id) - units.indexOf(b.id));
  return options.length ? { unit: options[0].id, takeover: true } : null;
}

// Start times with at least one possible end. `takeover` is true when every
// end from that start would take a lower-priority reservation.
export function startChoices(config, rows, day, type, purpose, unitId = null) {
  const choices = [];
  for (const start of slotStarts(config)) {
    if (serviceAt(day, start)) continue;
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

// Every time a reservation could end at instead, as 'HH:MM': after its first
// slot and before its current end.
export function earlierEnds(config, start, end) {
  const ends = [];
  for (let time = toMinutes(start) + config.slotMinutes; time < toMinutes(end); time += config.slotMinutes) ends.push(toTime(time));
  return ends;
}
