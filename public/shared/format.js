// Text and time helpers used by the member app, the Admin page and the lobby TV.
// Dates are 'YYYY-MM-DD' strings and times are 'HH:MM' strings.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// True when the text has at least one letter or number.
export function hasText(value) {
  return /[\p{L}\p{N}]/u.test(String(value ?? ''));
}

export function toMinutes(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

export function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// '14:30' or 870 -> '2:30 PM'
export function formatTime(time) {
  const minutes = typeof time === 'number' ? time : toMinutes(time);
  if (!Number.isFinite(minutes)) return '';
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

// '14:00' -> '2 PM'
export function formatHour(time) {
  return formatTime(time).replace(':00', '');
}

export function formatRange(start, end) {
  return `${formatTime(start)} to ${formatTime(end)}`;
}

// 90 -> '1 hr 30 min'
export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} hr` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ');
}

function calendarDate(date) {
  return new Date(`${date}T12:00:00Z`);
}

// 'Study rooms' -> 'study rooms', but 'TVs' stays 'TVs'.
export function inSentence(label) {
  return String(label).replace(/(^|\s)([A-Z])(?=[a-z])/g, (match, space, letter) => space + letter.toLowerCase());
}

// ['Tuesday', 'Saturday'] -> 'Tuesday and Saturday'
export function listOf(items) {
  return new Intl.ListFormat('en-US', { type: 'conjunction' }).format(items);
}

// '2026-10-03' -> 'Saturday, Oct 3'
export function formatDay(date) {
  return calendarDate(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

// '2026-10-03' -> 'Saturday, October 3, 2026'
export function formatLongDay(date) {
  return calendarDate(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function weekdayName(date) {
  return calendarDate(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
}

export function monthDay(date) {
  return calendarDate(date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

// The date and minute of the day on the church's clock.
export function nowIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute'))
  };
}

// localStorage can throw when storage is blocked; these never do.
export function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
