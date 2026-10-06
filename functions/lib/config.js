'use strict';

// What can be reserved, and when. The member app, the Admin page and the lobby
// TV all get these rules from the server, so changing them here and deploying
// Functions is the whole change.

const TIME_ZONE = 'America/Los_Angeles';

// Reservations use a 30-minute grid between these times.
const OPEN = '10:00';
const CLOSE = '23:00';
const SLOT_MINUTES = 30;

// How far ahead members and Admin can book, counting today: today plus the
// next 3 days.
const BOOKING_WINDOW_DAYS = 4;

// Regular booking days by weekday (0 = Sunday, 6 = Saturday), each with the
// services that block reservations on that day. Every day can be booked; days
// with no services are open the whole time.
const WEEKLY_DAYS = {
  0: [],
  1: [],
  2: [
    { start: '19:30', end: '20:30', label: 'Evening service' }
  ],
  3: [],
  4: [],
  5: [],
  6: [
    { start: '10:00', end: '11:00', label: 'Morning service' },
    { start: '14:30', end: '15:30', label: 'Afternoon service' },
    { start: '19:30', end: '20:30', label: 'Evening service' }
  ]
};

// One-off booking days. Members can book a special day from `opens` through
// the day itself, whatever the booking window says. A special day on a
// regular weekday replaces that day entirely: its services and its `opens`.
// Example:
//   { date: '2026-12-21', opens: '2026-12-13', services: [
//     { start: '10:00', end: '11:00', label: 'Morning service' }
//   ] }
const SPECIAL_DAYS = [];

const RESOURCES = {
  room: {
    label: 'Study room',
    plural: 'Study rooms',
    units: [
      { id: 'room-1', name: 'Room 1' },
      { id: 'room-2', name: 'Room 2' },
      { id: 'room-3', name: 'Room 3' },
      { id: 'room-4', name: 'Room 4' }
    ]
  },
  whiteboard: {
    label: 'Whiteboard',
    plural: 'Whiteboards',
    units: [
      { id: 'wb-1', name: 'Board 1', note: 'Large' },
      { id: 'wb-2', name: 'Board 2', note: 'Large' },
      { id: 'wb-3', name: 'Board 3', note: 'Large' },
      { id: 'wb-4', name: 'Board 4', note: 'Vertical' },
      { id: 'wb-5', name: 'Board 5', note: 'Vertical' }
    ]
  },
  tv: {
    label: 'TV',
    plural: 'TVs',
    units: [
      { id: 'tv-1', name: 'TV 1' },
      { id: 'tv-2', name: 'TV 2' },
      { id: 'tv-3', name: 'TV 3' }
    ]
  }
};

// What a reservation is for, highest priority first. When every unit is taken
// for the whole time asked for, a reservation may take a unit held only by the
// purposes in its `canTake` list. `detailLabel` names the second field members
// fill in, and `detailMax` is its length limit.
const PURPOSES = {
  contact: {
    label: 'Contact',
    detailLabel: 'Contact name',
    detailMax: 120,
    canTake: ['new-member', 'other']
  },
  'new-member': {
    label: 'New Member',
    detailLabel: 'Member name',
    detailMax: 120,
    canTake: ['other']
  },
  other: {
    label: 'Other',
    detailLabel: 'Purpose',
    detailMax: 240,
    canTake: []
  }
};

// Admin-only purpose. It holds a unit and shows "Reserved" instead of a name.
const HOLD = 'blocked';

const NAME_MAX = 120;
const NOTE_MAX = 1000;
// The reason Admin gives for a hold. Only Admin sees it.
const HOLD_REASON_MAX = 240;

// Admin PIN: wrong PINs allowed per address, and in total, in one window. The
// next attempt is still checked, but it locks PIN sign-in (for that address,
// or for everyone) for RATE_WINDOW_MINUTES from that attempt. A correct PIN
// clears its address and is not counted in the total.
const MAX_PIN_FAILURES = 5;
const MAX_PIN_FAILURES_TOTAL = 20;
const RATE_WINDOW_MINUTES = 15;
// Admin stays unlocked this long after the PIN or the last Admin change.
const ADMIN_SESSION_MINUTES = 20;

// "Remove old records" deletes reservations dated more than this many days ago.
const KEEP_DAYS = 56;

module.exports = {
  TIME_ZONE,
  OPEN,
  CLOSE,
  SLOT_MINUTES,
  BOOKING_WINDOW_DAYS,
  WEEKLY_DAYS,
  SPECIAL_DAYS,
  RESOURCES,
  PURPOSES,
  HOLD,
  NAME_MAX,
  NOTE_MAX,
  HOLD_REASON_MAX,
  MAX_PIN_FAILURES,
  MAX_PIN_FAILURES_TOTAL,
  RATE_WINDOW_MINUTES,
  ADMIN_SESSION_MINUTES,
  KEEP_DAYS
};
