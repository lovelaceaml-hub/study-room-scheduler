'use strict';

const { publicName } = require('./public-lobby-schedule');

const UNITS = Object.freeze({
  room: 4,
  whiteboard: 5,
  tv: 3
});
const PREFIXES = Object.freeze({ room: 'room-', whiteboard: 'wb-', tv: 'tv-' });

function minutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function publicPurpose(value) {
  if (value === 'blocked') return 'blocked';
  if (value === 'contact') return 'contact';
  if (value === 'new-member' || value === 'new') return 'new';
  return 'other';
}

function reservedForOf(booking, purpose) {
  const direct = typeof booking.reservedFor === 'string' ? booking.reservedFor.trim() : '';
  if (direct) return direct;
  return purpose === 'other' && typeof booking.purposeOther === 'string'
    ? booking.purposeOther.trim()
    : '';
}

function assignmentsOf(booking) {
  return Object.fromEntries(Object.keys(UNITS).map(type => {
    const raw = booking.assignments && booking.assignments[type];
    return [type, typeof raw === 'string' && raw.startsWith(PREFIXES[type]) ? raw : null];
  }));
}

function publicRows(records, dates, ownerUid) {
  const source = Array.isArray(records) ? records : [];
  const dateSet = new Set(Array.isArray(dates) ? dates : []);
  const peers = source
    .filter(booking => booking && booking.status === 'approved' && booking.purpose !== 'blocked')
    .map(booking => booking.name)
    .filter(Boolean);
  const rows = [];
  source.forEach(booking => {
    if (!booking || booking.status !== 'approved' || !dateSet.has(booking.date)) return;
    const start = minutes(booking.start);
    const end = minutes(booking.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return;
    const purpose = publicPurpose(booking.purpose);
    const assignments = assignmentsOf(booking);
    Object.keys(UNITS).forEach(type => {
      const assignment = assignments[type];
      const unit = assignment ? Number(assignment.slice(PREFIXES[type].length)) : NaN;
      if (!booking.needs?.[type] || !Number.isInteger(unit) || unit < 1 || unit > UNITS[type]) return;
      const displayName = purpose === 'blocked' ? 'Reserved' : publicName(booking.name, peers);
      const row = {
        id: `${String(booking.id || '')}:${type}`,
        bookingId: String(booking.id || ''),
        key: `slot-${booking.date}-${type}-${unit}-${start}-${end}`,
        day: booking.date,
        date: booking.date,
        type,
        unit,
        start,
        end,
        name: displayName,
        publicName: displayName,
        displayName,
        purpose,
        reservedFor: purpose === 'blocked' ? '' : reservedForOf(booking, purpose),
        blocked: purpose === 'blocked',
        status: booking.status,
        needs: { ...booking.needs },
        assignments,
        override: false
      };
      if (booking.ownerUid === ownerUid) {
        row.ownerDetail = {
          authorized: true,
          bookingId: String(booking.id || ''),
          name: displayName,
          displayName,
          reservedFor: row.reservedFor,
          canCancel: true,
          canEndEarly: end - start > 30
        };
      }
      rows.push(row);
    });
  });
  return rows;
}

function ownerRows(records, dates, ownerUid) {
  const source = Array.isArray(records) ? records : [];
  const dateSet = new Set(Array.isArray(dates) ? dates : []);
  const peers = source
    .filter(booking => booking && booking.status === 'approved' && booking.purpose !== 'blocked')
    .map(booking => booking.name)
    .filter(Boolean);
  return source.filter(booking => booking && booking.ownerUid === ownerUid && dateSet.has(booking.date)).map(booking => {
    const purpose = publicPurpose(booking.purpose);
    const start = minutes(booking.start);
    const end = minutes(booking.end);
    const displayName = purpose === 'blocked' ? 'Reserved' : publicName(booking.name, peers);
    const assignments = assignmentsOf(booking);
    return {
      id: String(booking.id || ''),
      bookingId: String(booking.id || ''),
      key: `booking-${booking.id || ''}`,
      day: booking.date,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      name: displayName,
      displayName,
      purpose,
      reservedFor: purpose === 'blocked' ? '' : reservedForOf(booking, purpose),
      status: String(booking.status || ''),
      blocked: purpose === 'blocked',
      needs: { ...(booking.needs || {}) },
      assignments,
      endedEarlyFrom: typeof booking.endedEarlyFrom === 'string' ? booking.endedEarlyFrom : null,
      priorityNotice: booking.priorityNotice || null,
      canCancel: booking.status === 'pending' || booking.status === 'approved',
      canEndEarly: booking.status === 'approved' && Number.isFinite(start) && Number.isFinite(end) && end - start > 30
    };
  });
}

function projectMemberSchedule(records, dates, ownerUid) {
  return {
    version: 1,
    bookings: publicRows(records, dates, ownerUid),
    myBookings: ownerRows(records, dates, ownerUid)
  };
}

module.exports = { projectMemberSchedule, publicRows, ownerRows };
