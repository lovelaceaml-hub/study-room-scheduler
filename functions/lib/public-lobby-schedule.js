'use strict';

const { isoDateInLosAngeles, upcomingTuesdayAndSaturday } = require('./policy');

const ROOM_IDS = new Set(['room-1', 'room-2', 'room-3', 'room-4']);

function publicLobbyScheduleDates(now = new Date()) {
  const today = isoDateInLosAngeles(now);
  return [...new Set([today, ...upcomingTuesdayAndSaturday(now)])].sort();
}

function parsePublicName(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  let titleInitial = '';
  if (tokens.length) {
    const candidate = tokens[0].replace(/[.,]+$/g, '').toLowerCase();
    const titles = { brother: 'B', sister: 'S', elder: 'E', missionary: 'M', deacon: 'D', deaconess: 'D', pastor: 'P' };
    titleInitial = titles[candidate] || (/^[BSEMDP]$/i.test(candidate) ? candidate.toUpperCase() : '');
    if (titleInitial) tokens.shift();
  }
  const givenName = tokens.shift() || '';
  const surname = tokens.join(' ');
  const surnameParts = surname.split(/\s+/).filter(Boolean);
  const surnameKey = surnameParts.length === 1 && /^[\p{L}]$/u.test(surname.replace(/[.,]+/g, '')) ? `initial:${surname.toLowerCase()}` : `name:${surname.toLowerCase()}`;
  return { titleInitial, givenName, givenKey: givenName.toLowerCase(), surnameKey, surnameInitial: surname.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() };
}

function publicName(value, peers = []) {
  const parsed = parsePublicName(value);
  if (!parsed.givenName) return 'Reserved';
  const collision = peers.some(peer => {
    const other = parsePublicName(peer);
    return other.givenKey === parsed.givenKey && other.surnameKey !== parsed.surnameKey;
  });
  return [parsed.titleInitial, parsed.givenName, collision ? parsed.surnameInitial : ''].filter(Boolean).join(' ');
}

function isTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Return exactly the fields needed for the public lobby's four room timelines.
 * It deliberately omits Firestore ids, full names, owner ids, purposes, notes,
 * equipment requests, timestamps, and every other private booking field.
 */
function publicLobbyBooking(booking, peers = []) {
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
    name: publicName(booking.name, peers),
  };
}

module.exports = { publicLobbyBooking, publicLobbyScheduleDates, publicName };
