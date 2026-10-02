// Sample schedule for demo mode (?demo=1) on the member app and the lobby TV.
// Every name is fictional and nothing is sent to the server. The rules below
// are a copy for the sample only; the real ones live in functions/lib/config.js.

import { nowIn } from './format.js';

const SERVICES = {
  2: [{ start: '19:30', end: '20:30', label: 'Evening service' }],
  6: [
    { start: '10:00', end: '11:00', label: 'Morning service' },
    { start: '14:30', end: '15:30', label: 'Afternoon service' },
    { start: '19:30', end: '20:30', label: 'Evening service' }
  ]
};

export const DEMO_CONFIG = {
  timeZone: 'America/Los_Angeles',
  open: '10:00',
  close: '23:00',
  slotMinutes: 30,
  resources: {
    room: { label: 'Study room', plural: 'Study rooms', units: [1, 2, 3, 4].map(n => ({ id: `room-${n}`, name: `Room ${n}` })) },
    whiteboard: {
      label: 'Whiteboard',
      plural: 'Whiteboards',
      units: [1, 2, 3, 4, 5].map(n => ({ id: `wb-${n}`, name: `Board ${n}`, note: n <= 3 ? 'Large' : 'Vertical' }))
    },
    tv: { label: 'TV', plural: 'TVs', units: [1, 2, 3].map(n => ({ id: `tv-${n}`, name: `TV ${n}` })) }
  },
  purposes: {
    contact: { label: 'Contact', detailLabel: 'Contact name', detailMax: 120, canTake: ['new-member', 'other'] },
    'new-member': { label: 'New Member', detailLabel: 'Member name', detailMax: 120, canTake: ['other'] },
    other: { label: 'Other', detailLabel: 'Purpose', detailMax: 240, canTake: [] }
  },
  windowDays: 4,
  hold: 'blocked',
  nameMax: 120,
  noteMax: 1000,
  holdReasonMax: 240,
  keepDays: 56,
  sessionMinutes: 20,
  maxActivePerDay: 4
};

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function demoToday() {
  return nowIn(DEMO_CONFIG.timeZone).date;
}

// The booking days from today through the next three, as the server would give them.
export function demoDays(today = demoToday()) {
  const days = [];
  for (let offset = 0; offset < DEMO_CONFIG.windowDays; offset += 1) {
    const date = addDays(today, offset);
    if (SERVICES[weekday(date)]) days.push(demoDay(date));
  }
  return days;
}

export function demoDay(date) {
  const services = SERVICES[weekday(date)];
  return { date, scheduled: Boolean(services), services: (services || []).map(service => ({ ...service })) };
}

// Schedule rows in the shape the server sends the member app.
export function demoRows(days) {
  return days.flatMap(({ date }) => {
    const morning = weekday(date) === 6 ? '11:00' : '10:00';
    return [
      { unit: 'room-1', start: morning, end: '12:30', name: 'Robin', purpose: 'contact', reservedFor: 'Sample contact' },
      { unit: 'room-2', start: '11:30', end: '12:30', name: 'Jordan', purpose: 'new-member', reservedFor: 'Sample member' },
      { unit: 'room-3', start: '12:00', end: '13:00', name: 'Reserved', purpose: 'blocked', reservedFor: '' },
      { unit: 'room-4', start: '17:00', end: '18:30', name: 'Casey', purpose: 'other', reservedFor: 'Bible study' },
      { unit: 'wb-1', start: '11:30', end: '12:30', name: 'Avery', purpose: 'other', reservedFor: 'Sample study' },
      { unit: 'tv-2', start: '12:00', end: '13:00', name: 'Morgan', purpose: 'new-member', reservedFor: 'Sample member' }
    ].map((row, index) => ({
      id: `demo-${date}-${index}`,
      date,
      type: row.unit.startsWith('wb-') ? 'whiteboard' : row.unit.startsWith('tv-') ? 'tv' : 'room',
      mine: false,
      ...row
    }));
  });
}
