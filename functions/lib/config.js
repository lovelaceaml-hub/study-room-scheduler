'use strict';

// What can be reserved, and when. The member app, the Admin page and the lobby
// TV all get these rules from the server, so changing them here and deploying
// Functions is the whole change.

const TIME_ZONE = 'America/Los_Angeles';

// Reservations use a 30-minute grid between these times.
const OPEN = '10:00';
const CLOSE = '23:00';
const SLOT_MINUTES = 30;

// How far ahead members can book, counting today.
const BOOKING_WINDOW_DAYS = 7;

// Regular booking days by weekday (0 = Sunday, 6 = Saturday), each with the
// services that block reservations on that day.
const WEEKLY_DAYS = {
  2: [
    { start: '19:30', end: '20:30', label: 'Evening service' }
  ],
  6: [
    { start: '10:00', end: '11:00', label: 'Morning service' },
    { start: '14:30', end: '15:30', label: 'Afternoon service' },
    { start: '19:30', end: '20:30', label: 'Evening service' }
  ]
};

// One-off booking days. Members can book a special day from `opens` through
// the day itself. A special day on a regular weekday replaces that day's
// services. Example:
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

// Per device, per day: active reservations one device may hold.
const MAX_ACTIVE_PER_DAY = 4;

// Reservation requests allowed in a 15-minute window, per device and per
// network address (everyone on the church Wi-Fi shares one address).
const MAX_REQUESTS_PER_DEVICE = 8;
const MAX_REQUESTS_PER_NETWORK = 60;

// Admin PIN: wrong PINs allowed per address, and in total, per window. The
// next wrong PIN locks Admin for the rest of the window.
const MAX_PIN_FAILURES = 5;
const MAX_PIN_FAILURES_TOTAL = 20;
const RATE_WINDOW_MINUTES = 15;
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
  MAX_ACTIVE_PER_DAY,
  MAX_REQUESTS_PER_DEVICE,
  MAX_REQUESTS_PER_NETWORK,
  MAX_PIN_FAILURES,
  MAX_PIN_FAILURES_TOTAL,
  RATE_WINDOW_MINUTES,
  ADMIN_SESSION_MINUTES,
  KEEP_DAYS
};
