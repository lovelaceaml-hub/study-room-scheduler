'use strict';

// What each page is allowed to see. Browsers never read booking records
// directly; they get one of these views from a Cloud Function.

const config = require('./config');
const { dayInfo, earlyEnds, hasEnded } = require('./schedule');
const {
  TYPES, heldUnit, heldAssignments, neededTypes, missingTypes, purposeOf
} = require('./bookings');
const { publicName } = require('./names');

// The rules the pages need to draw the schedule and check a request before
// sending it. The server checks everything again. Purposes are listed most
// important first.
function clientConfig() {
  return {
    timeZone: config.TIME_ZONE,
    open: config.OPEN,
    close: config.CLOSE,
    slotMinutes: config.SLOT_MINUTES,
    windowDays: config.BOOKING_WINDOW_DAYS,
    resources: config.RESOURCES,
    purposes: config.PURPOSES,
    hold: config.HOLD,
    nameMax: config.NAME_MAX,
    noteMax: config.NOTE_MAX,
    holdReasonMax: config.HOLD_REASON_MAX,
    keepDays: config.KEEP_DAYS,
    sessionMinutes: config.ADMIN_SESSION_MINUTES,
    maxActivePerDay: config.MAX_ACTIVE_PER_DAY
  };
}

function daysView(dates) {
  return dates.map(dayInfo);
}

// Older records kept the Other description in `purposeOther`.
function detailOf(booking) {
  const value = typeof booking.reservedFor === 'string' && booking.reservedFor.trim()
    ? booking.reservedFor
    : booking.purposeOther;
  return typeof value === 'string' ? value.trim() : '';
}

// Members never see why Admin holds a unit.
function reservedForOf(booking) {
  return purposeOf(booking) === config.HOLD ? '' : detailOf(booking);
}

// Full names of everyone with an active reservation (holds aside), by date.
// Short names are worked out within one date, over every kind of unit, so the
// member app and the lobby TV always show the same short name.
function namesByDate(records) {
  const byDate = new Map();
  for (const booking of records) {
    if (booking.status !== 'approved' || purposeOf(booking) === config.HOLD || !booking.name) continue;
    if (!byDate.has(booking.date)) byDate.set(booking.date, []);
    byDate.get(booking.date).push(booking.name);
  }
  return byDate;
}

function displayName(booking, names) {
  return purposeOf(booking) === config.HOLD ? 'Reserved' : publicName(booking.name, names.get(booking.date) || []);
}

// One row per unit an approved booking holds, for the member schedule.
function scheduleRows(records, dates, uid) {
  const names = namesByDate(records);
  const rows = [];
  for (const booking of records) {
    if (booking.status !== 'approved' || !dates.includes(booking.date)) continue;
    for (const type of TYPES) {
      const unit = heldUnit(booking, type);
      if (!unit) continue;
      rows.push({
        id: booking.id,
        date: booking.date,
        type,
        unit,
        start: booking.start,
        end: booking.end,
        name: displayName(booking, names),
        purpose: purposeOf(booking),
        reservedFor: reservedForOf(booking),
        mine: Boolean(uid) && booking.ownerUid === uid
      });
    }
  }
  return rows;
}

// True when Admin cancelled it. Records cancelled before `cancelledBy` existed
// are not guessed at: their `updatedBy` may come from an earlier Admin change.
function cancelledByAdmin(booking) {
  return booking.status === 'cancelled' && booking.cancelledBy === 'admin';
}

// What a priority reservation changed: 'moved' to another unit, 'shortened'
// to end earlier, or 'released' because nothing else was free. Nothing once
// the reservation is cancelled.
function noticeView(booking) {
  const notice = booking.priorityNotice;
  if (booking.status === 'cancelled' || !notice || !['moved', 'shortened', 'released'].includes(notice.kind)) return null;
  return {
    kind: notice.kind,
    fromUnit: notice.fromUnit || null,
    toUnit: notice.toUnit || null,
    fromEnd: notice.fromEnd || null,
    toEnd: notice.toEnd || null,
    byPurpose: notice.byPurpose || null
  };
}

// What the reservation's own device, or Admin, may still do with it now.
function timing(booking, now) {
  const active = booking.status === 'approved';
  const ended = hasEnded(booking.date, booking.end, now);
  return { active, ended, ends: active && !ended ? earlyEnds(booking, now) : [] };
}

// The signed-in device's own reservations, in any status.
function myReservations(records, dates, uid, now) {
  if (!uid) return [];
  return records
    .filter(booking => booking.ownerUid === uid && dates.includes(booking.date))
    .map(booking => {
      const type = neededTypes(booking)[0] || 'room';
      const { active, ended, ends } = timing(booking, now);
      return {
        id: booking.id,
        date: booking.date,
        start: booking.start,
        end: booking.end,
        endedEarlyFrom: typeof booking.endedEarlyFrom === 'string' ? booking.endedEarlyFrom : null,
        status: booking.status,
        type,
        unit: heldUnit(booking, type),
        purpose: purposeOf(booking),
        name: String(booking.name || ''),
        reservedFor: reservedForOf(booking),
        notice: noticeView(booking),
        ended,
        byAdmin: cancelledByAdmin(booking),
        earlyEnds: ends,
        canCancel: active && !ended,
        canEndEarly: ends.length > 0
      };
    });
}

function memberView(records, dates, uid, now = new Date()) {
  return {
    version: 2,
    config: clientConfig(),
    days: daysView(dates),
    bookings: scheduleRows(records, dates, uid),
    mine: myReservations(records, dates, uid, now)
  };
}

// The lobby TV shows study rooms only, with public names and nothing else.
function lobbyView(records, dates, now = new Date()) {
  const names = namesByDate(records);
  const bookings = records
    .filter(booking => booking.status === 'approved' && heldUnit(booking, 'room') && dates.includes(booking.date))
    .map(booking => ({
      date: booking.date,
      start: booking.start,
      end: booking.end,
      room: heldUnit(booking, 'room'),
      name: displayName(booking, names)
    }));
  return {
    version: 1,
    generatedAt: now.toISOString(),
    config: clientConfig(),
    days: daysView(dates),
    bookings
  };
}

function millisOf(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return Number.isFinite(value) ? value : null;
}

// Every booking in any status, for Admin, with its private note. No device
// ids or raw timestamps.
function adminRows(records, notes = {}, now = new Date()) {
  return records.map(booking => {
    const needed = neededTypes(booking);
    const missing = missingTypes(booking);
    const { active, ended, ends } = timing(booking, now);
    return {
      id: booking.id,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      name: String(booking.name || ''),
      purpose: purposeOf(booking),
      reservedFor: detailOf(booking),
      needs: Object.fromEntries(TYPES.map(type => [type, needed.includes(type)])),
      assignments: heldAssignments(booking),
      status: booking.status,
      byMember: Boolean(booking.ownerUid),
      endedEarlyFrom: typeof booking.endedEarlyFrom === 'string' ? booking.endedEarlyFrom : null,
      notice: noticeView(booking),
      byAdmin: cancelledByAdmin(booking),
      note: typeof notes[booking.id] === 'string' ? notes[booking.id] : '',
      restorable: needed.length > 0 && (!active || missing.length > 0),
      missing,
      createdAt: millisOf(booking.createdAt),
      ended,
      earlyEnds: ends
    };
  });
}

module.exports = { clientConfig, daysView, memberView, lobbyView, adminRows };
