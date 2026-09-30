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

function todayAt(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function specialDay(date) {
  return SPECIAL_DAYS.find(day => day.date === date) || null;
}

// The services on a booking day, or null when `date` is not a booking day.
function servicesOn(date) {
  const special = specialDay(date);
  if (special) return special.services.map(service => ({ ...service }));
  const weekly = WEEKLY_DAYS[weekdayOf(date)];
  return weekly ? weekly.map(service => ({ ...service })) : null;
}

// The days members can book right now, in order.
function bookableDates(now = new Date()) {
  const today = todayAt(now);
  const dates = [];
  for (let offset = 0; offset < BOOKING_WINDOW_DAYS; offset += 1) {
    const date = addDays(today, offset);
    if (WEEKLY_DAYS[weekdayOf(date)]) dates.push(date);
  }
  for (const day of SPECIAL_DAYS) {
    if (day.opens <= today && today <= day.date) dates.push(day.date);
  }
  return [...new Set(dates)].sort();
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

// Every time this reservation could end at instead: after its first slot and
// before its current end.
function earlierEnds(start, end) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  const ends = [];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return ends;
  for (let value = from + SLOT_MINUTES; value < to; value += SLOT_MINUTES) ends.push(toTime(value));
  return ends;
}

// Why a reservation cannot be moved to end at `end`, or null when it can.
function earlyEndError(booking, end, now = new Date()) {
  if (!booking || !earlierEnds(booking.start, booking.end).includes(end)) {
    return 'Choose an earlier end time on the 30-minute grid.';
  }
  return timeError(booking.date, booking.start, end, now);
}

module.exports = {
  toMinutes,
  toTime,
  weekdayOf,
  addDays,
  todayAt,
  servicesOn,
  bookableDates,
  lobbyDates,
  dayInfo,
  timeError,
  earlierEnds,
  earlyEndError
};
