// Browser-side rules (public/shared) and their agreement with the server
// rules (functions/lib). Every name here is fictional.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  rangeChoice, startChoices, endChoices, earlierEnds, earliestStart, earlyEndChoices, hasEnded, takeoverEffect,
  validRange, unitName, findUnit
} from '../public/shared/availability.js';
import { formatTime, formatRange, formatDuration, formatDay, toMinutes, toTime, nowIn, hasText, escapeHtml } from '../public/shared/format.js';
import { DEMO_CONFIG, demoDays } from '../public/shared/demo.js';

const require = createRequire(import.meta.url);
const serverConfig = require('../functions/lib/config.js');
const serverBookings = require('../functions/lib/bookings.js');
const schedule = require('../functions/lib/schedule.js');
const { clientConfig, memberView } = require('../functions/lib/views.js');
const actions = require('../functions/lib/actions.js');
const { FakeFirestore } = require('../functions/test/support/fake-firestore.js');

const { servicesOn, bookableDates, dayInfo, hasPassed, timeError } = schedule;
const config = clientConfig();
const SATURDAY = { date: '2026-10-03', scheduled: true, services: servicesOn('2026-10-03') };
const TUESDAY = { date: '2026-10-06', scheduled: true, services: servicesOn('2026-10-06') };
// Saturday, October 3, 2026 at the given church-clock time.
const saturdayAt = time => new Date(`2026-10-03T${time}:00-07:00`);

function row(unit, start, end, purpose = 'other', date = SATURDAY.date) {
  return { id: `${unit}-${start}`, date, type: findUnit(config, unit).type, unit, start, end, purpose, name: 'Sample', reservedFor: '', mine: false };
}

// A seeded random number source, so a failure can be replayed.
function randomSource(seed) {
  return max => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
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

test('the browser and the server accept exactly the same ranges', () => {
  const now = saturdayAt('09:00');
  for (const day of [SATURDAY, TUESDAY]) {
    for (let start = 0; start < 24 * 60; start += 15) {
      for (let end = start + 15; end <= 24 * 60 - 1; end += 15) {
        const browser = validRange(config, day, start, end);
        const server = timeError(day.date, toTime(start), toTime(end), now) === null;
        assert.equal(browser, server, `${day.date} ${toTime(start)}-${toTime(end)}`);
      }
    }
  }
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

test('a time that has already begun cannot be reserved', () => {
  assert.equal(earliestStart(config, SATURDAY.date, saturdayAt('11:10')), 690, '11:30 at 11:10');
  assert.equal(earliestStart(config, SATURDAY.date, saturdayAt('11:00')), 660, '11:00 at exactly 11:00');
  assert.equal(earliestStart(config, SATURDAY.date, saturdayAt('11:01')), 690);
  assert.equal(earliestStart(config, SATURDAY.date, saturdayAt('09:00')), 540);
  assert.equal(earliestStart(config, TUESDAY.date, saturdayAt('22:59')), 0, 'a later day starts at opening');
  assert.equal(earliestStart(config, '2026-10-02', saturdayAt('09:00')), Infinity, 'an earlier day has nothing left');
  const starts = startChoices(config, [], SATURDAY, 'room', 'other', null, earliestStart(config, SATURDAY.date, saturdayAt('16:10')));
  assert.equal(starts[0].start, 990, 'the first start at 4:10 PM is 4:30 PM');
});

test('the browser and the server agree on which starts have passed, minute by minute', () => {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const now = new Date(saturdayAt('00:00').getTime() + minute * 60000);
    const earliest = earliestStart(config, SATURDAY.date, now);
    for (let start = 600; start < 1380; start += 30) {
      assert.equal(start < earliest, hasPassed(SATURDAY.date, toTime(start), now), `${toTime(start)} at ${toTime(minute)}`);
    }
  }
});

test('End early offers only later slots that have not passed, and nothing once it is over', () => {
  assert.deepEqual(earlierEnds(config, '11:00', '12:30'), ['11:30', '12:00']);
  assert.deepEqual(earlierEnds(config, '11:00', '11:30'), []);
  assert.deepEqual(earlyEndChoices(config, SATURDAY.date, '11:00', '14:00', saturdayAt('09:00')), ['11:30', '12:00', '12:30', '13:00', '13:30']);
  assert.deepEqual(earlyEndChoices(config, SATURDAY.date, '11:00', '14:00', saturdayAt('12:10')), ['12:30', '13:00', '13:30']);
  assert.deepEqual(earlyEndChoices(config, SATURDAY.date, '11:00', '14:00', saturdayAt('16:00')), []);
  assert.equal(hasEnded(config, SATURDAY.date, '14:00', saturdayAt('13:59')), false);
  assert.equal(hasEnded(config, SATURDAY.date, '14:00', saturdayAt('14:00')), true);
  assert.equal(hasEnded(config, '2026-10-02', '23:00', saturdayAt('09:00')), true);
});

test('only Contact and New Member see priority overrides, and the lowest priority goes first', () => {
  const day = [row('room-1', '11:00', '12:00', 'contact'), row('room-2', '11:00', '12:00', 'blocked'), row('room-3', '11:00', '12:00', 'new-member'), row('room-4', '11:00', '12:00', 'other')];
  assert.deepEqual(rangeChoice(config, day, SATURDAY, 'room', 660, 720, 'contact'), { unit: 'room-4', takeover: true }, 'Other before New Member');
  assert.deepEqual(rangeChoice(config, day, SATURDAY, 'room', 660, 720, 'new-member'), { unit: 'room-4', takeover: true });
  assert.equal(rangeChoice(config, day, SATURDAY, 'room', 660, 720, 'other'), null);
  const starts = startChoices(config, day, SATURDAY, 'room', 'contact');
  assert.deepEqual(starts.find(choice => choice.start === 660), { start: 660, takeover: true });
  // Two Other reservations on one room still come before one New Member.
  const crowded = [row('room-1', '11:00', '12:00', 'contact'), row('room-2', '11:00', '12:00', 'contact'), row('room-3', '11:00', '12:00', 'new-member'),
    row('room-4', '11:00', '11:30', 'other'), { ...row('room-4', '11:30', '12:00', 'other'), id: 'room-4-b' }];
  assert.deepEqual(rangeChoice(config, crowded, SATURDAY, 'room', 660, 720, 'contact'), { unit: 'room-4', takeover: true });
});

test('the takeover preview says what happens to the reservation it affects', () => {
  // Saturday 12:00 to 1:00 PM, every room taken; Contact reservations hold rooms 1 to 3.
  const contacts = ['room-1', 'room-2', 'room-3'].map(unit => row(unit, '12:00', '13:00', 'contact'));
  const preview = rows => takeoverEffect(config, rows, SATURDAY, 'room', 720, 780, 'contact')
    .affected.map(item => [item.row.unit, item.row.start, item.effect, item.toEnd]);
  assert.deepEqual(preview([...contacts, row('room-4', '11:00', '13:00')]), [['room-4', '11:00', 'shortened', '12:00']], 'began earlier');
  assert.deepEqual(preview([...contacts, row('room-4', '12:00', '13:00')]), [['room-4', '12:00', 'replaced', null]], 'nothing else free');
  const roomThreeLater = [contacts[0], contacts[1], row('room-3', '12:30', '13:00', 'contact')];
  assert.deepEqual(preview([...roomThreeLater, row('room-4', '12:00', '12:30')]), [['room-4', '12:00', 'moved', null]], 'Room 3 is free for its half hour');
  assert.deepEqual(preview([...contacts, row('room-4', '11:30', '12:30'), { ...row('room-4', '12:30', '14:00'), id: 'late' }]),
    [['room-4', '11:30', 'shortened', '12:00'], ['room-4', '12:30', 'replaced', null]]);
  assert.equal(takeoverEffect(config, contacts, SATURDAY, 'room', 720, 780, 'contact'), null, 'a free room is not a takeover');
});

// Builds the rows the browser gets from the records the server holds.
function browserRows(records, dates) {
  return memberView(records, dates, 'device-a').bookings;
}

// A crowded day for one unit type: most units held around 11:00 to 1:00 PM
// by one or two reservations of mixed priority, plus noise in other types,
// statuses and older formats, so full times and takeovers come up often.
function randomRecords(random, date, type) {
  const purposes = ['contact', 'new-member', 'other', 'other', 'blocked', 'meeting', undefined];
  const statuses = ['approved', 'approved', 'approved', 'approved', 'cancelled', 'overridden', 'pending', 'declined'];
  const records = [];
  const add = (unitType, unit, start, end, extra = {}) => {
    const index = records.length;
    const needs = { room: false, whiteboard: false, tv: false, [unitType]: true };
    const assignments = { room: null, whiteboard: null, tv: null, [unitType]: unit };
    records.push({
      id: `r${index}`, date, start: toTime(start), end: toTime(end), name: `Brother Sample${random(3)} Person${index}`,
      purpose: purposes[random(purposes.length)], reservedFor: 'Study', needs, assignments,
      status: statuses[random(statuses.length)], ownerUid: random(4) === 0 ? 'device-a' : `device-${index}`, createdAt: index, ...extra
    });
  };
  for (const unit of config.resources[type].units) {
    if (random(6) === 0) continue;
    const split = 660 + 30 * (1 + random(3));
    if (random(2)) add(type, unit.id, 660 - 30 * random(2), split);
    add(type, unit.id, split, Math.min(870, split + 30 * (1 + random(3))));
  }
  // An Admin reservation holding a room and a TV together.
  if (random(3) === 0) {
    records.push({ ...records[0] || {}, id: 'multi', date, start: '11:00', end: '12:30', name: 'Admin Sample', purpose: ['other', 'new-member', 'blocked'][random(3)],
      reservedFor: '', needs: { room: true, whiteboard: false, tv: true }, assignments: { room: `room-${1 + random(4)}`, whiteboard: null, tv: `tv-${1 + random(3)}` },
      status: 'approved', ownerUid: null, createdAt: 99 });
  }
  for (let noise = random(4); noise > 0; noise -= 1) {
    const other = ['room', 'whiteboard', 'tv'][random(3)];
    const units = config.resources[other].units;
    const start = 660 + 30 * random(5);
    add(other, units[random(units.length)].id, start, start + 30 * (1 + random(3)));
  }
  return records;
}

// The browser only decides what to offer; the server decides what happens.
// They must agree, or members would see times the server refuses.
test('the browser and the server pick the same unit for every unit type, holds and older records', () => {
  const random = randomSource(7);
  let takeovers = 0;
  for (let round = 0; round < 4000; round += 1) {
    const type = ['room', 'whiteboard', 'tv'][random(3)];
    const records = randomRecords(random, SATURDAY.date, type);
    const rows = browserRows(records, [SATURDAY.date]);
    const units = config.resources[type].units.map(unit => unit.id);
    const start = 660 + 30 * random(4);
    const end = Math.min(870, start + 30 * (1 + random(3)));
    const purpose = ['contact', 'new-member', 'other'][random(3)];
    const requested = random(3) === 0 ? units[random(units.length)] : null;
    const candidate = { date: SATURDAY.date, start: toTime(start), end: toTime(end), purpose };
    const free = serverBookings.freeUnit(type, candidate, records, requested);
    const takeover = serverBookings.takeoverTarget(type, candidate, records, requested);
    const expected = free ? { unit: free, takeover: false } : takeover ? { unit: takeover.unitId, takeover: true } : null;
    if (takeover) takeovers += 1;
    assert.deepEqual(rangeChoice(config, rows, SATURDAY, type, start, end, purpose, requested), expected,
      JSON.stringify({ round, records, type, start, end, purpose, requested }));
  }
  assert.ok(takeovers > 300, `only ${takeovers} takeovers came up`);
});

// Runs the real reservation code on an in-memory database and compares what
// happened to each holder with what the browser previewed.
test('the takeover preview matches what the server does', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: saturdayAt('09:00') });
  const random = randomSource(11);
  let checked = 0;
  for (let round = 0; round < 1500; round += 1) {
    const records = randomRecords(random, SATURDAY.date, 'room');
    const rows = browserRows(records, [SATURDAY.date]);
    const start = 660 + 30 * random(5);
    const end = start + 30 * (1 + random(3));
    const purpose = random(2) ? 'contact' : 'new-member';
    const preview = takeoverEffect(config, rows, SATURDAY, 'room', start, end, purpose);
    if (!preview) continue;
    const db = new FakeFirestore();
    for (const record of records) db.seed('bookings', record.id, record);
    const request = serverBookings.parseMemberRequest({
      date: SATURDAY.date, start: toTime(start), end: toTime(end), resourceType: 'room', purpose,
      name: 'Sam Sample', reservedFor: 'Sample', allowTakeover: true, takeoverUnit: preview.unit
    });
    const result = await actions.submitReservation(db, request, 'device-z');
    assert.equal(result.unit, preview.unit);
    for (const { row: holder, effect, toEnd } of preview.affected) {
      const after = db.get('bookings', holder.id);
      const actual = after.status === 'overridden' ? 'replaced' : after.end !== holder.end ? 'shortened' : 'moved';
      assert.equal(actual, effect, JSON.stringify({ round, records, start, end, purpose, holder }));
      if (effect === 'shortened') assert.equal(after.end, toEnd);
    }
    checked += 1;
  }
  assert.ok(checked > 100, `only ${checked} takeovers were checked`);
});

test('unit names come from the server config', () => {
  assert.equal(unitName(config, 'wb-4'), 'Board 4');
  assert.deepEqual(findUnit(config, 'tv-2'), { type: 'tv', unit: { id: 'tv-2', name: 'TV 2' } });
  assert.equal(unitName(config, 'room-9'), '');
});

test('demo mode uses the same rules and days as the server, every day of the week', t => {
  assert.deepEqual(DEMO_CONFIG, JSON.parse(JSON.stringify(config)));
  assert.deepEqual(Object.keys(serverConfig.WEEKLY_DAYS).map(Number), [2, 6]);
  const special = serverConfig.SPECIAL_DAYS.splice(0);
  t.after(() => serverConfig.SPECIAL_DAYS.push(...special));
  for (let offset = 0; offset < 14; offset += 1) {
    const now = new Date(saturdayAt('12:00').getTime() + offset * 86400000);
    const today = nowIn(config.timeZone, now).date;
    assert.deepEqual(demoDays(today), bookableDates(now).map(dayInfo), today);
  }
});
