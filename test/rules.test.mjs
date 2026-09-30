// Browser-side rules (public/shared) and their agreement with the server
// rules (functions/lib). Every name here is fictional.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rangeChoice, startChoices, endChoices, earlierEnds, validRange, unitName, findUnit } from '../public/shared/availability.js';
import { formatTime, formatRange, formatDuration, formatDay, toMinutes, toTime, nowIn, hasText, escapeHtml } from '../public/shared/format.js';
import { DEMO_CONFIG, demoDays } from '../public/shared/demo.js';

const require = createRequire(import.meta.url);
const serverConfig = require('../functions/lib/config.js');
const serverBookings = require('../functions/lib/bookings.js');
const { clientConfig } = require('../functions/lib/views.js');
const { servicesOn } = require('../functions/lib/schedule.js');

const config = clientConfig();
const SATURDAY = { date: '2026-10-03', scheduled: true, services: servicesOn('2026-10-03') };
const TUESDAY = { date: '2026-10-06', scheduled: true, services: servicesOn('2026-10-06') };

function row(unit, start, end, purpose = 'other', date = SATURDAY.date) {
  return { id: `${unit}-${start}`, date, type: findUnit(config, unit).type, unit, start, end, purpose, name: 'Sample', reservedFor: '', mine: false };
}

test('times and dates read the same everywhere', () => {
  assert.equal(formatTime('00:30'), '12:30 AM');
  assert.equal(formatTime(870), '2:30 PM');
  assert.equal(formatRange('11:00', '12:30'), '11:00 AM to 12:30 PM');
  assert.equal(formatDuration(90), '1 hr 30 min');
  assert.equal(formatDuration(30), '30 min');
  assert.equal(formatDay('2026-10-03'), 'Saturday, Oct 3');
  assert.equal(toTime(toMinutes('22:30')), '22:30');
  assert.deepEqual(nowIn('America/Los_Angeles', new Date('2026-10-04T06:30:00Z')), { date: '2026-10-03', minutes: 23 * 60 + 30 });
  assert.equal(hasText(' ​ '), false);
  assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('a range must be on the grid, inside hours and clear of services', () => {
  assert.equal(validRange(config, SATURDAY, 660, 870), true);
  assert.equal(validRange(config, SATURDAY, 840, 900), false);
  assert.equal(validRange(config, TUESDAY, 600, 660), true);
  assert.equal(validRange(config, SATURDAY, 1350, 1410), false);
  assert.equal(validRange(config, SATURDAY, 675, 720), false);
});

test('start times skip services and times with no open unit', () => {
  const full = ['room-1', 'room-2', 'room-3', 'room-4'].map(unit => row(unit, '11:00', '12:00', 'contact'));
  const starts = startChoices(config, full, SATURDAY, 'room', 'other').map(choice => choice.start);
  assert.equal(starts.includes(600), false, 'morning service');
  assert.equal(starts.includes(660), false, 'every room taken by Contact');
  assert.equal(starts.includes(720), true);
  assert.equal(starts.at(-1), 1350, '10:30 PM is the last start');
});

test('an end time never crosses a service and a tapped unit is never swapped', () => {
  const ends = endChoices(config, [row('room-1', '12:00', '13:00')], SATURDAY, 'room', 660, 'other').map(choice => choice.end);
  assert.deepEqual(ends.map(toTime), ['11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30']);
  const exact = endChoices(config, [row('room-1', '12:00', '13:00')], SATURDAY, 'room', 660, 'other', 'room-1');
  assert.deepEqual(exact.map(choice => toTime(choice.end)), ['11:30', '12:00']);
});

test('only Contact and New Member see priority overrides', () => {
  const day = [row('room-1', '11:00', '12:00', 'contact'), row('room-2', '11:00', '12:00', 'blocked'), row('room-3', '11:00', '12:00', 'new-member'), row('room-4', '11:00', '12:00', 'other')];
  assert.deepEqual(rangeChoice(config, day, SATURDAY, 'room', 660, 720, 'contact'), { unit: 'room-3', takeover: true });
  assert.deepEqual(rangeChoice(config, day, SATURDAY, 'room', 660, 720, 'new-member'), { unit: 'room-4', takeover: true });
  assert.equal(rangeChoice(config, day, SATURDAY, 'room', 660, 720, 'other'), null);
  const starts = startChoices(config, day, SATURDAY, 'room', 'contact');
  assert.deepEqual(starts.find(choice => choice.start === 660), { start: 660, takeover: true });
});

test('End early offers every slot after the first and before the current end', () => {
  assert.deepEqual(earlierEnds(config, '11:00', '12:30'), ['11:30', '12:00']);
  assert.deepEqual(earlierEnds(config, '11:00', '11:30'), []);
});

test('unit names come from the server config', () => {
  assert.equal(unitName(config, 'wb-4'), 'Board 4');
  assert.deepEqual(findUnit(config, 'tv-2'), { type: 'tv', unit: { id: 'tv-2', name: 'TV 2' } });
  assert.equal(unitName(config, 'room-9'), '');
});

// The browser only decides what to offer; the server decides what happens.
// They must agree, or members would see times the server refuses.
test('the browser and the server pick the same unit, on hundreds of random days', () => {
  const units = config.resources.room.units.map(unit => unit.id);
  const purposes = ['contact', 'new-member', 'other', 'blocked'];
  let seed = 7;
  const random = max => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
  for (let round = 0; round < 400; round += 1) {
    const rows = [];
    for (let count = random(8); count > 0; count -= 1) {
      const start = 660 + 30 * random(7);
      rows.push(row(units[random(4)], toTime(start), toTime(start + 30 * (1 + random(4))), purposes[random(4)]));
    }
    const records = rows.map(item => ({ ...item, status: 'approved', assignments: { room: item.unit } }));
    const start = 660 + 30 * random(6);
    const end = Math.min(870, start + 30 * (1 + random(4)));
    const purpose = purposes[random(3)];
    const requested = random(3) === 0 ? units[random(4)] : null;
    const candidate = { date: SATURDAY.date, start: toTime(start), end: toTime(end), purpose };
    const free = serverBookings.freeUnit('room', candidate, records, requested);
    const takeover = serverBookings.takeoverTarget('room', candidate, records, requested);
    const expected = free ? { unit: free, takeover: false } : takeover ? { unit: takeover.unitId, takeover: true } : null;
    assert.deepEqual(rangeChoice(config, rows, SATURDAY, 'room', start, end, purpose, requested), expected, JSON.stringify({ rows, start, end, purpose, requested }));
  }
});

test('demo mode uses the same rules as the server', () => {
  assert.deepEqual(DEMO_CONFIG, JSON.parse(JSON.stringify(config)));
  for (const day of demoDays('2026-10-01')) {
    assert.deepEqual(day.services, servicesOn(day.date), day.date);
  }
  assert.deepEqual(demoDays('2026-10-01').map(day => day.date), ['2026-10-03', '2026-10-06']);
  assert.deepEqual(Object.keys(serverConfig.WEEKLY_DAYS).map(Number), [2, 6]);
});
