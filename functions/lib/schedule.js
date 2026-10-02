'use strict';

// Dates, times and which days can be booked. All dates are 'YYYY-MM-DD'
// strings and all times are 'HH:MM' strings on the church's local clock.

const {
  TIME_ZONE, OPEN, CLOSE, SLOT_MINUTES, BOOKING_WINDOW_DAYS, WEEKLY_DAYS, SPECIAL_DAYS
} = require('./config');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(time) {
  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) return NaN;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// '14:30' -> '2:30 PM'
function clockLabel(time) {
  const minutes = toMinutes(time);
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

// 0 (Sunday) to 6 (Saturday), or NaN when `date` is not a real calendar date.
function weekdayOf(date) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return NaN;
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) return NaN;
  return value.getUTCDay();
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// The date and minute of the day on the church's clock.
function clockAt(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, minutes: Number(part('hour')) * 60 + Number(part('minute')) };
}

function todayAt(now = new Date()) {
  return clockAt(now).date;
}

// Compares a time on `date` with the current minute: negative when it is
// earlier (or `date` is past), 0 in the current minute, positive when later.
function sinceNow(date, time, now) {
  const clock = clockAt(now);
  if (date !== clock.date) return date < clock.date ? -1 : 1;
  return toMinutes(time) - clock.minutes;
}

// True when `start` on `date` is before the current minute. Nothing that has
// already started can be reserved: at 11:10 the earliest start is 11:30, and
// at exactly 11:00 it is 11:00.
function hasPassed(date, start, now = new Date()) {
  return sinceNow(date, start, now) < 0;
}

// True once a reservation ending at `end` on `date` is over.
function hasEnded(date, end, now = new Date()) {
  return sinceNow(date, end, now) <= 0;
}

// What decides a date: its special day if it has one, otherwise its weekday.
// Returns { services, opens } or null when `date` is not a booking day. A
// regular day opens BOOKING_WINDOW_DAYS before it, counting the day itself.
function dayRule(date) {
  const special = SPECIAL_DAYS.find(day => day.date === date);
  if (special) return { services: special.services, opens: special.opens };
  const weekly = WEEKLY_DAYS[weekdayOf(date)];
  return weekly ? { services: weekly, opens: addDays(date, 1 - BOOKING_WINDOW_DAYS) } : null;
}

// The services on a booking day, or null when `date` is not a booking day.
function servicesOn(date) {
  const rule = dayRule(date);
  return rule ? rule.services.map(service => ({ ...service })) : null;
}

// The days that can be booked right now, in order.
function bookableDates(now = new Date()) {
  const today = todayAt(now);
  const candidates = SPECIAL_DAYS.map(day => day.date);
  for (let offset = 0; offset < BOOKING_WINDOW_DAYS; offset += 1) candidates.push(addDays(today, offset));
  return [...new Set(candidates)].filter(date => {
    const rule = dayRule(date);
    return rule !== null && rule.opens <= today && today <= date;
  }).sort();
}

// The lobby TV also shows today, even when today is not a booking day.
function lobbyDates(now = new Date()) {
  return [...new Set([todayAt(now), ...bookableDates(now)])].sort();
}

// A day as the pages see it. `scheduled` is false on days with no room
// schedule (the lobby TV still shows today).
function dayInfo(date) {
  const services = servicesOn(date);
  return { date, scheduled: services !== null, services: services || [] };
}

// Why a reservation time is not allowed, or null when it is.
function timeError(date, start, end, now = new Date()) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Times must use HH:MM format.';
  if (from % SLOT_MINUTES || to % SLOT_MINUTES) return `Times must be on the ${SLOT_MINUTES}-minute grid.`;
  if (from < toMinutes(OPEN) || to > toMinutes(CLOSE) || from >= to) {
    return `Reservations must be between ${clockLabel(OPEN)} and ${clockLabel(CLOSE)}.`;
  }
  if (!bookableDates(now).includes(date)) return 'That day is not open for reservations.';
  if (servicesOn(date).some(service => from < toMinutes(service.end) && toMinutes(service.start) < to)) {
    return 'That time overlaps a service.';
  }
  return null;
}

// Every time a reservation could end at instead: after its first slot and
// before its current end.
function earlierEnds(start, end) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  const ends = [];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return ends;
  for (let value = from + SLOT_MINUTES; value < to; value += SLOT_MINUTES) ends.push(toTime(value));
  return ends;
}

// The ends End early may choose for `booking` now: earlier ends that have not
// already passed. At 11:10 the earliest is 11:30.
function earlyEnds(booking, now = new Date()) {
  if (!booking) return [];
  return earlierEnds(booking.start, booking.end).filter(end => !hasPassed(booking.date, end, now));
}

// Why a reservation cannot be moved to end at `end`, or null when it can.
function earlyEndError(booking, end, now = new Date()) {
  if (!booking || !earlierEnds(booking.start, booking.end).includes(end)) {
    return `Choose an earlier end time on the ${SLOT_MINUTES}-minute grid.`;
  }
  return earlyEnds(booking, now).includes(end) ? null : 'Choose an end time from now on.';
}

module.exports = {
  toMinutes,
  toTime,
  weekdayOf,
  addDays,
  todayAt,
  hasPassed,
  hasEnded,
  servicesOn,
  bookableDates,
  lobbyDates,
  dayInfo,
  timeError,
  earlierEnds,
  earlyEnds,
  earlyEndError
};
