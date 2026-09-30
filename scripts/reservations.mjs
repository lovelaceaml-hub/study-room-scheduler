// Lists reservations from today on, straight from the live database, using
// the read-only account claude-reader@lvz-rooms. It cannot change anything.
//
//   npm run reservations           as members see them (short names)
//   npm run reservations -- --full  with full names, device and private notes
//
// Needs gcloud signed in as an account allowed to act as claude-reader (see
// "Looking at live data" in the README).

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { todayAt } = require('../functions/lib/schedule.js');
const { publicName } = require('../functions/lib/names.js');
const { RESOURCES, PURPOSES, HOLD } = require('../functions/lib/config.js');

const READER = process.env.READER || 'claude-reader@lvz-rooms.iam.gserviceaccount.com';
const DATABASE = 'https://firestore.googleapis.com/v1/projects/lvz-rooms/databases/(default)/documents';
const full = process.argv.includes('--full');

// --billing-project keeps gcloud from charging this to another default project.
const token = execFileSync('gcloud', [
  'auth', 'print-access-token', `--impersonate-service-account=${READER}`, '--billing-project=lvz-rooms'
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function post(path, body) {
  const response = await fetch(`${DATABASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

// Firestore's typed values ({ stringValue: 'x' }) to plain values.
function plain(value) {
  if (!value || 'nullValue' in value) return null;
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, plain(item)]));
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(plain);
  if ('integerValue' in value) return Number(value.integerValue);
  return Object.values(value)[0];
}

const rows = await post(':runQuery', {
  structuredQuery: {
    from: [{ collectionId: 'bookings' }],
    where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: todayAt() } } },
    orderBy: [{ field: { fieldPath: 'date' } }]
  }
});
const bookings = rows.filter(row => row.document).map(row => ({
  id: row.document.name.split('/').pop(),
  ...Object.fromEntries(Object.entries(row.document.fields).map(([key, value]) => [key, plain(value)]))
}));

let notes = {};
if (full && bookings.length) {
  const result = await post(':batchGet', { documents: bookings.map(booking => `projects/lvz-rooms/databases/(default)/documents/privateBookingNotes/${booking.id}`) });
  notes = Object.fromEntries(result.filter(item => item.found).map(item => [item.found.name.split('/').pop(), plain(item.found.fields.note)]));
}

const unitName = id => Object.values(RESOURCES).flatMap(resource => resource.units).find(unit => unit.id === id)?.name || id;
const onSchedule = bookings.filter(booking => booking.status === 'approved' && booking.purpose !== HOLD).map(booking => booking.name);

if (!bookings.length) console.log(`No reservations from ${todayAt()} on.`);
let day = '';
for (const booking of bookings.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))) {
  if (booking.date !== day) {
    day = booking.date;
    console.log(`\n${day}`);
  }
  const places = Object.entries(booking.assignments || {}).filter(([, unit]) => unit).map(([, unit]) => unitName(unit)).join(', ') || 'no unit';
  const purpose = booking.purpose === HOLD ? 'Hold' : PURPOSES[booking.purpose]?.label || booking.purpose;
  const name = full ? booking.name : booking.purpose === HOLD ? 'Reserved' : publicName(booking.name, onSchedule);
  const parts = [`${booking.start}-${booking.end}`, places, booking.status, name, purpose, booking.reservedFor || booking.purposeOther || ''];
  if (full) parts.push(booking.ownerUid ? `device ${booking.ownerUid.slice(0, 6)}` : 'Admin', notes[booking.id] ? `note: ${notes[booking.id]}` : '');
  console.log(`  ${parts.filter(Boolean).join(' | ')}`);
}
