// Stands in for the Cloud Functions in demo mode (?demo=1). It answers the
// same calls with the sample schedule, following the server's rules, and
// keeps practice reservations in memory until the page is closed.

import { DEMO_CONFIG, demoDays, demoRows } from '../shared/demo.js';
import {
  rangeChoice, takeoverEffect, earliestStart, earlierEnds, earlyEndChoices, hasEnded, unitsOf, validRange
} from '../shared/availability.js';
import { hasText, toMinutes, toTime, inSentence } from '../shared/format.js';

// ---------- Public names (mirrors publicName in functions/lib/names.js) ----------

const TITLES = {
  brother: 'B', bro: 'B', sister: 'S', sis: 'S', elder: 'E', missionary: 'M', deacon: 'D', deaconess: 'D', pastor: 'P'
};

function nameKey(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function parseName(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  let title = '';
  let titleWord = '';
  if (words.length) {
    const first = words[0].replace(/[.,]+$/g, '');
    title = TITLES[first.toLocaleLowerCase('en-US')] || (/^[BSEMDP]$/i.test(first) ? first.toUpperCase() : '');
    if (title) titleWord = words.shift().replace(/,+$/, '');
  }
  const given = words.shift() || '';
  const surname = words.join(' ');
  const bareSurname = surname.replace(/[.,]+/g, '');
  const surnameKey = words.length === 1 && /^\p{L}$/u.test(bareSurname)
    ? `initial:${nameKey(bareSurname)}`
    : `name:${nameKey(surname)}`;
  const initial = [...surname.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '';
  return { title, titleWord, given, givenKey: nameKey(given), surnameKey, initial: initial.toLocaleUpperCase('en-US') };
}

// How a name appears on the schedule: "Brother John Smith" and "Bro. John
// Smith" become "B John"; with another John on the same day, "B John S".
// A name that is only a title shows that word as typed. `others` are the full
// names of everyone else on the schedule that day.
export function shortName(value, others = []) {
  const name = parseName(value);
  if (!name.given) return name.titleWord || 'Reserved';
  const shared = others.some(other => {
    const parsed = parseName(other);
    return parsed.givenKey === name.givenKey && parsed.surnameKey !== name.surnameKey;
  });
  return [name.title, name.given, shared ? name.initial : ''].filter(Boolean).join(' ');
}

// ---------- The fake server ----------

function refusal(code, message) {
  return Object.assign(new Error(message), { code: `functions/${code}` });
}

function overlaps(row, start, end) {
  return toMinutes(row.start) < end && start < toMinutes(row.end);
}

export function demoBackend() {
  const config = DEMO_CONFIG;
  const days = demoDays();
  let sample = demoRows(days);
  const mine = []; // practice reservations, with full names
  const answered = new Map(); // requestId -> first result
  let count = 0;

  // Every row on the schedule. Practice names are shortened against
  // everyone else on the same day, as the server does.
  function scheduleRows() {
    const active = mine.filter(item => item.status === 'approved' && item.unit);
    const namesOn = date => [...sample, ...active].filter(row => row.date === date && row.purpose !== config.hold).map(row => row.name);
    return [
      ...sample.map(row => ({ ...row })),
      ...active.map(item => ({
        id: item.id, date: item.date, type: item.type, unit: item.unit, start: item.start, end: item.end,
        name: shortName(item.name, namesOn(item.date)), purpose: item.purpose, reservedFor: item.reservedFor, mine: true
      }))
    ];
  }

  // A practice reservation as My reservations sees it.
  function view(item) {
    const active = item.status === 'approved';
    const ended = active && hasEnded(config, item.date, item.end);
    const earlyEnds = active && !ended ? earlyEndChoices(config, item.date, item.start, item.end) : [];
    return {
      ...item,
      notice: item.status === 'cancelled' ? null : item.notice,
      ended,
      earlyEnds,
      canEndEarly: earlyEnds.length > 0,
      canCancel: active && !ended,
      byAdmin: false
    };
  }

  function ownRow(id) {
    const reservation = mine.find(item => item.id === id);
    if (!reservation) throw refusal('not-found', 'That reservation no longer exists.');
    if (reservation.status !== 'approved') throw refusal('failed-precondition', 'This reservation was already cancelled or replaced.');
    if (hasEnded(config, reservation.date, reservation.end)) throw refusal('failed-precondition', 'This reservation has already ended.');
    return reservation;
  }

  // Applies a takeover the way the server does: a reservation that began
  // earlier now ends when the new one starts; any other moves to a free unit,
  // or is replaced when none is free.
  function takeOver(effect, day, type, start, end, purpose, forced) {
    const notice = fields => ({ fromUnit: effect.unit, byPurpose: purpose, toUnit: null, toEnd: null, forced, ...fields });
    const practice = row => (row.mine ? mine.find(item => item.id === row.id) : null);
    const pool = scheduleRows().filter(row => row.type === type && !effect.affected.some(item => item.row.id === row.id));
    pool.push({ date: day.date, unit: effect.unit, start: toTime(start), end: toTime(end) });
    for (const { row, toEnd } of effect.affected.filter(item => item.effect === 'shortened')) {
      pool.push({ ...row, end: toEnd });
      const own = practice(row);
      if (own) Object.assign(own, { end: toEnd, notice: notice({ kind: 'shortened', toUnit: effect.unit, toEnd }) });
      else sample = sample.map(item => (item.id === row.id ? { ...item, end: toEnd } : item));
    }
    for (const { row } of effect.affected.filter(item => item.effect !== 'shortened')) {
      const free = unitsOf(config, type).map(unit => unit.id).find(unit => !pool.some(other => other.date === row.date
        && other.unit === unit && overlaps(other, toMinutes(row.start), toMinutes(row.end))));
      const own = practice(row);
      if (free) {
        pool.push({ ...row, unit: free });
        if (own) Object.assign(own, { unit: free, notice: notice({ kind: 'moved', toUnit: free }) });
        else sample = sample.map(item => (item.id === row.id ? { ...item, unit: free } : item));
      } else if (own) {
        Object.assign(own, { status: 'overridden', unit: null, notice: notice({ kind: 'released' }) });
      } else {
        sample = sample.filter(item => item.id !== row.id);
      }
    }
  }

  const calls = {
    memberSchedule() {
      return { version: 2, serverTime: Date.now(), config, days, bookings: scheduleRows(), mine: mine.map(view) };
    },

    memberSubmitBooking(data) {
      if (data.requestId && answered.has(data.requestId)) return { ...answered.get(data.requestId), repeated: true };
      const day = days.find(item => item.date === data.date);
      const purpose = Object.hasOwn(config.purposes, data.purpose ?? '') ? config.purposes[data.purpose] : null;
      const type = data.resourceType;
      const start = toMinutes(data.start);
      const end = toMinutes(data.end);
      if (!day || !validRange(config, day, start, end)) throw refusal('invalid-argument', 'That day is not open for reservations.');
      if (start < earliestStart(config, data.date)) throw refusal('invalid-argument', 'That start time has already passed. Choose a later time.');
      if (!Object.hasOwn(config.resources, type ?? '')) throw refusal('invalid-argument', 'Choose a study room, whiteboard or TV.');
      if (!purpose) throw refusal('invalid-argument', 'Choose what the reservation is for.');
      if (!hasText(data.name)) throw refusal('invalid-argument', 'Your name is required.');
      if (!hasText(data.reservedFor)) throw refusal('invalid-argument', `${purpose.detailLabel} is required.`);
      const rows = scheduleRows().filter(row => row.type === type);
      const requested = data.requestedUnit ?? null;
      const shown = data.takeoverUnit ?? null;
      const force = data.forceOverride === true;
      const allowTakeover = data.allowTakeover === true || force;
      if (allowTakeover && !shown) throw refusal('invalid-argument', 'This page is out of date. Reload the page and try again.');
      const choice = rangeChoice(config, rows, day, type, start, end, data.purpose, requested, undefined, force);
      // With a takeover, only the unit the member was shown may be taken.
      const confirmed = allowTakeover && !(requested && requested !== shown);
      const effect = choice?.takeover && confirmed
        ? takeoverEffect(config, rows, day, type, start, end, data.purpose, shown, undefined, force)
        : null;
      if (!choice || (choice.takeover && !effect)) {
        const unitName = unitsOf(config, type).find(unit => unit.id === requested)?.name;
        throw refusal('already-exists', allowTakeover ? 'The schedule changed. Check the time and confirm again.'
          : unitName ? `${unitName} is taken for part of that time. Choose another time.`
          : `No ${inSentence(config.resources[type].plural)} are free for that whole time. Choose another time.`);
      }
      if (effect) takeOver(effect, day, type, start, end, data.purpose, force);
      count += 1;
      const result = { id: `demo-mine-${count}`, unit: effect ? effect.unit : choice.unit, takeover: Boolean(effect) };
      mine.push({
        id: result.id,
        date: data.date,
        start: data.start,
        end: data.end,
        type,
        unit: result.unit,
        purpose: data.purpose,
        name: data.name.trim(),
        reservedFor: data.reservedFor.trim(),
        status: 'approved',
        endedEarlyFrom: null,
        notice: null
      });
      if (data.requestId) answered.set(data.requestId, result);
      return result;
    },

    memberCancelBooking({ bookingId }) {
      const reservation = ownRow(bookingId);
      reservation.status = 'cancelled';
      return { ok: true };
    },

    memberEndBookingEarly({ bookingId, end }) {
      const reservation = ownRow(bookingId);
      if (!earlierEnds(config, reservation.start, reservation.end).includes(end)) {
        throw refusal('failed-precondition', `Choose an earlier end time on the ${config.slotMinutes}-minute grid.`);
      }
      if (!earlyEndChoices(config, reservation.date, reservation.start, reservation.end).includes(end)) {
        throw refusal('failed-precondition', 'Choose an end time from now on.');
      }
      reservation.endedEarlyFrom ??= reservation.end;
      reservation.end = end;
      return { end };
    }
  };

  return {
    uid: 'demo',
    async call(name, data = {}) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return structuredClone(calls[name](data));
    }
  };
}
