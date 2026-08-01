'use strict';

const ROOM_IDS = new Set(['room-1', 'room-2', 'room-3', 'room-4']);

function publicName(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(part => !/^(brother|sister|elder|missionary|deacon|deaconess|pastor)$/i.test(part));
  if (parts.length > 1 && /^[BSEMDP]\.$/i.test(parts[0])) parts.shift();
  if (!parts.length) return 'Reserved';
  if (parts.length === 1) return parts[0];
  if (parts.length >= 3 && /^[A-Z]$/i.test(parts[0])) {
    return `${parts[0].toUpperCase()} ${parts[1]} ${parts.at(-1).charAt(0).toUpperCase()}.`;
  }
  return `${parts[0]} ${parts.at(-1).charAt(0).toUpperCase()}.`;
}

function isTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Return exactly the fields needed for the public lobby's four room timelines.
 * It deliberately omits Firestore ids, full names, owner ids, purposes, notes,
 * equipment requests, timestamps, and every other private booking field.
 */
function publicLobbyBooking(booking) {
  const room = booking?.assignments?.room;
  if (
    !booking ||
    booking.status !== 'approved' ||
    booking.needs?.room !== true ||
    !ROOM_IDS.has(room) ||
    typeof booking.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(booking.date) ||
    !isTime(booking.start) ||
    !isTime(booking.end) ||
    booking.start >= booking.end
  ) return null;
  return {
    date: booking.date,
    start: booking.start,
    end: booking.end,
    room,
    name: publicName(booking.name),
  };
}

module.exports = { publicLobbyBooking, publicName };
