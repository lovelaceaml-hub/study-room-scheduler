'use strict';

// Shared test setup: a fixed clock, fictional bookings and calls. Tests never
// depend on today's real date or on the special days in config.js.

const { mock, before, beforeEach, after } = require('node:test');
const config = require('../../lib/config');
const { parseMemberRequest, takeoverTarget, emptyAssignments, unitIds } = require('../../lib/bookings');

// Thursday, October 1, 2026, 9:00 AM in Las Vegas. Saturday is the only day
// open for reservations (today plus the next 3 days).
const THURSDAY = new Date('2026-10-01T16:00:00Z');
const SATURDAY = '2026-10-03';
const TUESDAY = '2026-10-06';

// A moment on the church's clock in October 2026 (Pacific Daylight Time).
function local(date, time) {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}-07:00`);
}

// Mocks Date (and so Timestamp.now) for every test in the file, starting each
// test on Thursday morning, and keeps SPECIAL_DAYS empty. The array is shared
// by reference with schedule.js, so it is emptied and refilled in place.
function useFixedClock() {
  const saved = [...config.SPECIAL_DAYS];
  before(() => mock.timers.enable({ apis: ['Date'], now: THURSDAY }));
  beforeEach(() => {
    mock.timers.setTime(THURSDAY.getTime());
    config.SPECIAL_DAYS.length = 0;
  });
  after(() => {
    mock.timers.reset();
    config.SPECIAL_DAYS.splice(0, config.SPECIAL_DAYS.length, ...saved);
  });
}

function setClock(date) {
  mock.timers.setTime(date.getTime());
}

function seedBooking(db, id, fields = {}) {
  db.seed('bookings', id, {
    date: SATURDAY, start: '11:00', end: '12:00', name: `Holder ${id}`, purpose: 'other', reservedFor: 'Study',
    needs: { room: true, whiteboard: false, tv: false }, status: 'approved', ownerUid: `owner-${id}`,
    ...fields,
    assignments: { room: null, whiteboard: null, tv: null, ...fields.assignments }
  });
}

// A member request as the server parses it, at the mocked time.
function memberRequest(fields = {}) {
  return parseMemberRequest({
    date: SATURDAY, start: '11:00', end: '12:00', resourceType: 'room', purpose: 'contact',
    name: 'Sam Sample', reservedFor: 'Sample Contact', ...fields
  });
}

// A confirmed takeover as the page sends it: with the unit the page shows
// (takeoverTarget's choice, which the browser mirrors), unless `fields` names
// one. When nothing can be taken now, it names the unit the member was shown
// earlier, so the server finds the schedule changed.
function takeoverRequest(db, fields = {}) {
  const request = memberRequest({ ...fields, allowTakeover: false, takeoverUnit: null });
  const approved = db.all('bookings').filter(record => record.status === 'approved' && record.date === request.date);
  const target = takeoverTarget(request.type, { ...request, assignments: emptyAssignments() }, approved, request.requestedUnit);
  const shown = fields.takeoverUnit ?? target?.unitId ?? request.requestedUnit ?? unitIds(request.type)[0];
  return memberRequest({ ...fields, allowTakeover: true, takeoverUnit: shown });
}

// A callable request from `uid` (null: signed out) at `address`.
const call = (uid, data = {}, address = '203.0.113.5') => ({
  auth: uid ? { uid } : null,
  data,
  rawRequest: { headers: { 'x-forwarded-for': `198.51.100.9, ${address}` } }
});

// { ok } or { code, message }, never a rejection.
async function settle(promise) {
  try {
    return { ok: await promise };
  } catch (error) {
    return { code: error.code, message: error.message };
  }
}

const hasCode = code => error => error.code === code;

module.exports = {
  THURSDAY, SATURDAY, TUESDAY, local, useFixedClock, setClock, seedBooking, memberRequest, takeoverRequest, call, settle, hasCode
};
