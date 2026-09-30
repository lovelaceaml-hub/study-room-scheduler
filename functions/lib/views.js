'use strict';

// What each page is allowed to see. Browsers never read booking records
// directly; they get one of these views from a Cloud Function.

const config = require('./config');
const { dayInfo, earlierEnds } = require('./schedule');
const { TYPES, unitIds, purposeOf } = require('./bookings');
const { publicName } = require('./names');

// The rules the pages need to draw the schedule and check a request before
// sending it. The server checks everything again.
function clientConfig() {
  return {
    timeZone: config.TIME_ZONE,
    open: config.OPEN,
    close: config.CLOSE,
    slotMinutes: config.SLOT_MINUTES,
    resources: config.RESOURCES,
    purposes: config.PURPOSES
  };
}

function daysView(dates) {
  return dates.map(dayInfo);
}

// Older records kept the Other description in `purposeOther`.
function reservedForOf(booking) {
  if (purposeOf(booking) === config.HOLD) return '';
  const value = typeof booking.reservedFor === 'string' && booking.reservedFor.trim()
    ? booking.reservedFor
    : booking.purposeOther;
  return typeof value === 'string' ? value.trim() : '';
}

function namesOnSchedule(records) {
  return records
    .filter(booking => booking.status === 'approved' && booking.purpose !== config.HOLD)
    .map(booking => booking.name)
    .filter(Boolean);
}

function displayName(booking, others) {
  return purposeOf(booking) === config.HOLD ? 'Reserved' : publicName(booking.name, others);
}

// One row per unit an approved booking holds, for the member schedule.
function scheduleRows(records, dates, uid) {
  const others = namesOnSchedule(records);
  const rows = [];
  for (const booking of records) {
    if (booking.status !== 'approved' || !dates.includes(booking.date)) continue;
    for (const type of TYPES) {
      const unit = booking.assignments?.[type];
      if (!booking.needs?.[type] || !unitIds(type).includes(unit)) continue;
      rows.push({
        id: booking.id,
        date: booking.date,
        type,
        unit,
        start: booking.start,
        end: booking.end,
        name: displayName(booking, others),
        purpose: purposeOf(booking),
        reservedFor: reservedForOf(booking),
        mine: Boolean(uid) && booking.ownerUid === uid
      });
    }
  }
  return rows;
}

// The signed-in device's own reservations, in any status.
function myReservations(records, dates, uid) {
  if (!uid) return [];
  return records
    .filter(booking => booking.ownerUid === uid && dates.includes(booking.date))
    .map(booking => {
      const type = TYPES.find(item => booking.needs?.[item]) || 'room';
      const active = booking.status === 'approved';
      return {
        id: booking.id,
        date: booking.date,
        start: booking.start,
        end: booking.end,
        endedEarlyFrom: typeof booking.endedEarlyFrom === 'string' ? booking.endedEarlyFrom : null,
        status: booking.status,
        type,
        unit: booking.assignments?.[type] || null,
        purpose: purposeOf(booking),
        name: String(booking.name || ''),
        reservedFor: reservedForOf(booking),
        notice: noticeView(booking.priorityNotice),
        canCancel: active,
        canEndEarly: active && earlierEnds(booking.start, booking.end).length > 0
      };
    });
}

// What a priority reservation changed: 'moved' to another unit, 'shortened'
// to end earlier, or 'released' because nothing else was free.
function noticeView(notice) {
  if (!notice || !['moved', 'shortened', 'released'].includes(notice.kind)) return null;
  return {
    kind: notice.kind,
    fromUnit: notice.fromUnit || null,
    toUnit: notice.toUnit || null,
    toEnd: notice.toEnd || null,
    byPurpose: notice.byPurpose || null
  };
}

function memberView(records, dates, uid) {
  return {
    version: 2,
    config: clientConfig(),
    days: daysView(dates),
    bookings: scheduleRows(records, dates, uid),
    mine: myReservations(records, dates, uid)
  };
}

// The lobby TV shows study rooms only, with public names and nothing else.
function lobbyView(records, dates, now = new Date()) {
  const others = records
    .filter(booking => booking.status === 'approved' && booking.purpose !== config.HOLD && booking.needs?.room)
    .map(booking => booking.name)
    .filter(Boolean);
  const bookings = records
    .filter(booking => booking.status === 'approved' && booking.needs?.room
      && unitIds('room').includes(booking.assignments?.room) && dates.includes(booking.date))
    .map(booking => ({
      date: booking.date,
      start: booking.start,
      end: booking.end,
      room: booking.assignments.room,
      name: displayName(booking, others)
    }));
  return {
    version: 1,
    generatedAt: now.toISOString(),
    config: clientConfig(),
    days: daysView(dates),
    bookings
  };
}

module.exports = { clientConfig, daysView, memberView, lobbyView };
