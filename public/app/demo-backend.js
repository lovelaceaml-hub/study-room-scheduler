// Stands in for the Cloud Functions in demo mode (?demo=1). It answers the
// same calls with the sample schedule, and keeps practice reservations in
// memory until the page is closed.

import { DEMO_CONFIG, demoDays, demoRows } from '../shared/demo.js';
import { rangeChoice, earlierEnds } from '../shared/availability.js';
import { hasText, toMinutes } from '../shared/format.js';

// Roughly how the server shortens names on the schedule: "Brother Sam Lee" -> "B Sam".
function shortName(name) {
  const words = name.trim().split(/\s+/);
  const title = { brother: 'B', sister: 'S', elder: 'E', missionary: 'M', deacon: 'D', deaconess: 'D', pastor: 'P' }[words[0].toLowerCase()];
  return title && words[1] ? `${title} ${words[1]}` : words[0];
}

function refusal(code, message) {
  return Object.assign(new Error(message), { code: `functions/${code}` });
}

export function demoBackend() {
  const days = demoDays();
  let rows = demoRows(days);
  const mine = [];
  let count = 0;

  function ownRow(id) {
    const reservation = mine.find(item => item.id === id);
    if (!reservation || reservation.status !== 'approved') throw refusal('failed-precondition', 'This reservation is no longer active.');
    return reservation;
  }

  const calls = {
    memberSchedule() {
      return { version: 2, config: DEMO_CONFIG, days, bookings: rows.map(row => ({ ...row })), mine: mine.map(row => ({ ...row })) };
    },

    memberSubmitBooking(data) {
      const day = days.find(item => item.date === data.date);
      const purpose = DEMO_CONFIG.purposes[data.purpose];
      if (!day || !purpose) throw refusal('invalid-argument', 'Choose an open day and what the reservation is for.');
      if (!hasText(data.name)) throw refusal('invalid-argument', 'Your name is required.');
      if (!hasText(data.reservedFor)) throw refusal('invalid-argument', `${purpose.detailLabel} is required.`);
      const start = toMinutes(data.start);
      const end = toMinutes(data.end);
      const choice = rangeChoice(DEMO_CONFIG, rows, day, data.resourceType, start, end, data.purpose, data.requestedUnit ?? null);
      if (!choice || (choice.takeover && !data.allowTakeover)) throw refusal('already-exists', 'That time was just taken. Choose another time.');
      if (choice.takeover) {
        rows = rows.filter(row => !(row.date === data.date && row.unit === choice.unit
          && toMinutes(row.start) < end && start < toMinutes(row.end)));
      }
      count += 1;
      const reservation = {
        id: `demo-mine-${count}`,
        date: data.date,
        start: data.start,
        end: data.end,
        type: data.resourceType,
        unit: choice.unit,
        purpose: data.purpose,
        name: data.name.trim(),
        reservedFor: data.reservedFor.trim()
      };
      rows.push({ ...reservation, name: shortName(reservation.name), mine: true });
      mine.push({
        ...reservation,
        status: 'approved',
        endedEarlyFrom: null,
        notice: null,
        canCancel: true,
        canEndEarly: earlierEnds(DEMO_CONFIG, data.start, data.end).length > 0
      });
      return { id: reservation.id, unit: choice.unit };
    },

    memberCancelBooking({ bookingId }) {
      const reservation = ownRow(bookingId);
      Object.assign(reservation, { status: 'cancelled', canCancel: false, canEndEarly: false });
      rows = rows.filter(row => row.id !== bookingId);
      return { ok: true };
    },

    memberEndBookingEarly({ bookingId, end }) {
      const reservation = ownRow(bookingId);
      if (!earlierEnds(DEMO_CONFIG, reservation.start, reservation.end).includes(end)) {
        throw refusal('failed-precondition', 'Choose an earlier end time on the 30-minute grid.');
      }
      reservation.endedEarlyFrom ??= reservation.end;
      reservation.end = end;
      reservation.canEndEarly = earlierEnds(DEMO_CONFIG, reservation.start, end).length > 0;
      rows = rows.map(row => row.id === bookingId ? { ...row, end } : row);
      return { end };
    }
  };

  return {
    uid: 'demo',
    async call(name, data = {}) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return calls[name](data);
    }
  };
}
