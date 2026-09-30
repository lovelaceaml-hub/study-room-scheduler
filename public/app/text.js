// Labels and sentences the member app shows, built from the server's config.

import { unitName } from '../shared/availability.js';
import { formatTime, formatDay } from '../shared/format.js';

export const HOLD = 'blocked';

const STATUS_LABELS = {
  approved: 'Confirmed',
  cancelled: 'Cancelled',
  overridden: 'Replaced',
  pending: 'Pending',
  declined: 'Declined'
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || '';
}

export function purposeLabel(config, purpose) {
  if (purpose === HOLD) return 'Reserved';
  return config.purposes[purpose]?.label || 'Other';
}

export function detailLabel(config, purpose) {
  return config.purposes[purpose]?.detailLabel || 'Details';
}

// 'Room 2', or 'Study room' when no unit is assigned.
export function placeLabel(config, type, unit) {
  return unitName(config, unit) || config.resources[type]?.label || 'Reservation';
}

export function dayLabel(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? formatDay(date) : '';
}

// What a priority reservation changed about this one, or ''.
export function noticeText(config, reservation) {
  const notice = reservation.notice;
  if (!notice) return '';
  const by = config.purposes[notice.byPurpose]?.label || 'priority';
  const kind = (config.resources[reservation.type]?.label || 'unit').toLowerCase();
  const from = unitName(config, notice.fromUnit) || `your ${kind}`;
  if (notice.kind === 'shortened') return `A ${by} reservation needed ${from}, so this reservation now ends at ${formatTime(notice.toEnd)}.`;
  if (notice.kind === 'moved') return `A ${by} reservation needed ${from}, so this reservation moved to ${unitName(config, notice.toUnit) || `another ${kind}`}.`;
  return `A ${by} reservation needed ${from} and no other ${kind} was free, so this reservation was released. Choose another time.`;
}
