// Contract of functions/lib/views.js:lobbyView and public/tv/tv.js.
// CDN caches for 60 seconds; TV considers a copy stale after 3 minutes.
// Use generatedAt's Pacific day, not the runner's day or opening hours.
export function assertLobbySchedule(payload, receivedAt = Date.now()) {
  const fail = message => { throw new Error(`lobby schedule: ${message}`); };
  if (payload?.version !== 1) fail('unsupported or missing version');
  const generated = typeof payload.generatedAt === 'string' ? Date.parse(payload.generatedAt) : NaN;
  if (!Number.isFinite(generated)) fail('invalid generatedAt');
  if (receivedAt - generated > 180000 || generated - receivedAt > 60000) fail('generatedAt is stale or in the future');
  const config = payload.config;
  if (config?.timeZone !== 'America/Los_Angeles') fail('unexpected timeZone');
  const units = config.resources?.room?.units;
  if (!Array.isArray(units) || !units.length || !units.every(unit => typeof unit.id === 'string' && unit.id && typeof unit.name === 'string' && unit.name)) fail('missing room configuration');
  if (!Array.isArray(payload.days) || !payload.days.length || !payload.days.every(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && typeof day.scheduled === 'boolean' && Array.isArray(day.services))) fail('invalid days');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(generated);
  const part = type => parts.find(item => item.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  if (!payload.days.some(day => day.date === today)) fail('days omit the generated Pacific date');
  if (!Array.isArray(payload.bookings)) fail('missing bookings');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!payload.bookings.every(row => payload.days.some(day => day.date === row.date) && units.some(unit => unit.id === row.room) && time.test(row.start) && time.test(row.end) && row.start < row.end && typeof row.name === 'string')) fail('invalid booking');
}
