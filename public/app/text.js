// Labels and sentences the member app shows, built from the server's config.

import { findUnit, hasEnded, earlyEndChoices } from '../shared/availability.js';
import { formatTime, inSentence } from '../shared/format.js';

export const HOLD = 'blocked';

// The member app's sheets import this from here with the other labels.
export { statusLabel } from '../shared/labels.js';

export function purposeLabel(config, purpose) {
  if (purpose === HOLD) return 'Reserved';
  return config.purposes[purpose]?.label || 'Other';
}

export function detailLabel(config, purpose) {
  return config.purposes[purpose]?.detailLabel || 'Details';
}

// 'Room 2', or 'Board 4 (Vertical)' when the unit has a note; '' if unknown.
export function unitLabel(config, id) {
  const unit = findUnit(config, id)?.unit;
  if (!unit) return '';
  return unit.note ? `${unit.name} (${unit.note})` : unit.name;
}

// The unit, or 'Study room' when no unit is assigned.
export function placeLabel(config, type, unit) {
  return unitLabel(config, unit) || config.resources[type]?.label || 'Reservation';
}

// What a member can still do with one of their reservations. The server sends
// `ended`, `earlyEnds`, `canCancel` and `byAdmin`; an older server leaves some
// out, so they are worked out here from the same rules.
export function reservationActions(config, item) {
  const active = item.status === 'approved';
  const ended = active && (typeof item.ended === 'boolean' ? item.ended : hasEnded(config, item.date, item.end));
  const earlyEnds = !active || ended ? []
    : Array.isArray(item.earlyEnds) ? item.earlyEnds : earlyEndChoices(config, item.date, item.start, item.end);
  return { active, ended, earlyEnds, canCancel: active && !ended && item.canCancel !== false, byAdmin: item.byAdmin === true };
}

// What a priority reservation changed about this one, or ''.
export function noticeText(config, reservation) {
  const notice = reservation.notice;
  if (!notice || reservation.status === 'cancelled') return '';
  const by = config.purposes[notice.byPurpose]?.label || 'priority';
  const kind = inSentence(config.resources[reservation.type]?.label || 'unit');
  const from = unitLabel(config, notice.fromUnit) || `your ${kind}`;
  const took = notice.forced ? `Another member used Force override on ${from}` : `A ${by} reservation needed ${from}`;
  if (notice.kind === 'shortened') return `${took}, so this reservation now ends at ${formatTime(notice.toEnd)}.`;
  if (notice.kind === 'moved') return `${took}, so this reservation moved to ${unitLabel(config, notice.toUnit) || `another ${kind}`}.`;
  return `${took} and no other ${kind} was free, so this reservation was replaced. Choose another time.`;
}

// The connection problem a page or sheet explains, with the button that helps.
export function connectionText(status) {
  switch (status) {
    case 'offline': return { text: 'You’re offline. The schedule will update when you reconnect.', action: 'retry' };
    case 'error': return { text: 'The schedule didn’t load.', action: 'retry' };
    case 'slow': return { text: 'The schedule is taking too long to load. Check your connection, then reload.', action: 'reload' };
    case 'outdated': return { text: 'This page is out of date. Reload to update it.', action: 'reload' };
    default: return null;
  }
}

export const ACTION_LABELS = { retry: 'Try again', reload: 'Reload' };
