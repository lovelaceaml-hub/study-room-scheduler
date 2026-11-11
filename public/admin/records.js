// What the Admin page reads from a reservation record: the kinds of unit it
// needs, its labels, and what Admin may still do with it. `config()` is the
// schedule's current rules and `holdId()` the purpose id of an Admin hold.

import { formatTime, inSentence, toMinutes } from '../shared/format.js';
import { unitsOf, unitName, findUnit, hasEnded, earlyEndChoices } from '../shared/availability.js';

// Lowercase, without accents, so "jose" finds "José".
export const folded = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export const named = record => String(record.name || '').trim();
export const displayName = record => named(record) || 'No name';
export const whose = record => (named(record) ? `${named(record)}'s reservation` : 'The reservation');
export const byMember = record => (typeof record.byMember === 'boolean' ? record.byMember : Boolean(record.ownerUid));

// The end a priority reservation cut short. Ending early later is a
// separate line, so the two times are never mixed up.
export function shortenedFrom(record) {
  return record.notice?.kind === 'shortened' ? record.notice.fromEnd || null : null;
}

export function recordHelpers({ config, holdId }) {
  const types = () => Object.keys(config().resources);
  const isUnit = (type, id) => unitsOf(config(), type).some(unit => unit.id === id);

  // The types a record needs. Older records may lack `needs`.
  function neededTypes(record) {
    return types().filter(type => record.needs?.[type] || isUnit(type, record.assignments?.[type]));
  }

  // Needed types with no unit; the server sends this as `missing`.
  function missingOf(record) {
    if (Array.isArray(record.missing)) return types().filter(type => record.missing.includes(type));
    if (record.status !== 'approved') return [];
    return neededTypes(record).filter(type => !isUnit(type, record.assignments?.[type]));
  }

  function restorable(record) {
    if (typeof record.restorable === 'boolean') return record.restorable;
    return record.status !== 'approved' || missingOf(record).length > 0;
  }

  // Admin sees 'Hold' where members see 'Reserved'.
  function purposeLabel(purpose) {
    if (purpose === holdId()) return 'Hold';
    return config().purposes[purpose]?.label || 'Other';
  }

  function detailLabel(purpose) {
    return purpose === holdId() ? 'Reason (private)' : config().purposes[purpose]?.detailLabel || 'Details';
  }

  function places(record) {
    return neededTypes(record)
      .map(type => unitName(config(), record.assignments?.[type]) || `No ${inSentence(config().resources[type].label)}`)
      .join(', ');
  }

  // What a priority reservation did to this one, in a sentence. Members get
  // their own wording for this in My reservations (app/text.js).
  function noticeText(record) {
    const notice = record.notice;
    if (!notice || record.status === 'cancelled') return '';
    const by = config().purposes[notice.byPurpose]?.label || 'priority';
    const type = findUnit(config(), notice.fromUnit)?.type;
    const noun = type ? inSentence(config().resources[type].label) : 'unit';
    if (notice.kind === 'moved') return `Moved from ${unitName(config(), notice.fromUnit) || `another ${noun}`} for a ${by} reservation.`;
    if (notice.kind === 'shortened') {
      const was = shortenedFrom(record);
      return `Shortened for a ${by} reservation${was ? `; it was booked until ${formatTime(was)}` : ''}.`;
    }
    if (notice.kind === 'released') return `Replaced by a ${by} reservation; no other ${noun} was free.`;
    return '';
  }

  // The ends End early may offer. The server sends them (`earlyEnds`, already
  // without passed ends) and says when a reservation has `ended`; an older
  // server does not, so the page works them out on its own clock.
  function endChoices(record) {
    if (record.status !== 'approved') return [];
    const ended = typeof record.ended === 'boolean' ? record.ended : hasEnded(config(), record.date, record.end);
    if (ended) return [];
    if (Array.isArray(record.earlyEnds)) {
      return record.earlyEnds.filter(end => toMinutes(record.start) < toMinutes(end) && toMinutes(end) < toMinutes(record.end));
    }
    return earlyEndChoices(config(), record.date, record.start, record.end);
  }

  return { types, isUnit, neededTypes, missingOf, restorable, purposeLabel, detailLabel, places, noticeText, endChoices };
}
