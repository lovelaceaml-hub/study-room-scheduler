// What a room card on the lobby TV says. Pure functions of the rules, the
// day and the room's reservations, so they can be tested without a browser.
// Minutes are minutes after midnight on the church's clock.

import { formatTime, toMinutes } from '../shared/format.js';

const serviceCache = new WeakMap();

function timedServices(day) {
  let services = serviceCache.get(day);
  if (!services) {
    services = day.services
      .map(service => ({ ...service, startMinute: toMinutes(service.start), endMinute: toMinutes(service.end) }))
      .sort((a, b) => a.startMinute - b.startMinute);
    serviceCache.set(day, services);
  }
  return services;
}

// The first minute at or after `minute` when rooms can be used: inside
// opening hours and outside every service. Null when none is left that day.
export function nextOpenMinute(config, day, minute) {
  let time = Math.max(minute, toMinutes(config.open));
  let service = timedServices(day).find(item => item.startMinute <= time && time < item.endMinute);
  while (service) {
    time = service.endMinute;
    service = timedServices(day).find(item => item.startMinute <= time && time < item.endMinute);
  }
  return time < toMinutes(config.close) ? time : null;
}

// { state, detail, kind } for one room. `minute` is now, or null for a day
// other than today. `kind` is 'busy', 'free', 'closed' or 'later'.
export function roomStatus(config, day, bookings, minute = null) {
  return statusFor(config, day, bookings, minute, false);
}

export function roomStatusSorted(config, day, bookings, minute = null) {
  return statusFor(config, day, bookings, minute, true);
}

function statusFor(config, day, bookings, minute, alreadySorted) {
  const sorted = alreadySorted ? bookings : bookings.slice().sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const range = booking => `${formatTime(booking.start)} to ${formatTime(booking.end)}`;
  const nextText = booking => `Next: ${booking.name}, ${range(booking)}`;

  if (minute === null) {
    if (sorted.length) {
      return { state: `${sorted.length} reservation${sorted.length === 1 ? '' : 's'}`, detail: `First: ${sorted[0].name}, ${range(sorted[0])}`, kind: 'later' };
    }
    return { state: day.services.length ? 'Open except during services' : 'Open all day', detail: '', kind: 'later' };
  }

  const close = toMinutes(config.close);
  if (minute >= close) return { state: 'Closed for today', detail: '', kind: 'closed' };
  const current = sorted.find(booking => toMinutes(booking.start) <= minute && minute < toMinutes(booking.end));
  const next = sorted.find(booking => toMinutes(booking.start) > minute);
  if (current) {
    return { state: 'In use', detail: `${current.name} until ${formatTime(current.end)}${next ? `. ${nextText(next)}` : ''}`, kind: 'busy' };
  }

  const opens = nextOpenMinute(config, day, minute);
  if (opens === null) return { state: 'Closed for today', detail: '', kind: 'closed' };
  if (opens > minute) return { state: `Opens at ${formatTime(opens)}`, detail: next ? nextText(next) : '', kind: 'closed' };

  // Free now: until the next reservation, the next service or closing.
  const service = timedServices(day).find(item => item.startMinute > minute);
  const until = Math.min(next ? toMinutes(next.start) : close, service ? service.startMinute : close);
  if (until >= close) return { state: 'Open now', detail: `Open until ${formatTime(close)}`, kind: 'free' };
  const serviceFirst = service && service.startMinute === until && !(next && toMinutes(next.start) === until);
  const detail = [serviceFirst ? `${service.label} at ${formatTime(service.startMinute)}` : '', next ? nextText(next) : ''].filter(Boolean).join('. ');
  return { state: `Free until ${formatTime(until)}`, detail, kind: 'free' };
}
