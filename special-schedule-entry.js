const SPECIAL_BOOKING_DATE = '2026-09-21';
const SPECIAL_BOOKING_DATE_OPENS = '2026-09-13';

async function loadClassicAppWithSpecialSchedule() {
  const response = await fetch('./app.js', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the Study Rooms app (${response.status}).`);
  let source = await response.text();

  const replaceOnce = (before, after) => {
    if (!source.includes(before)) throw new Error('The Study Rooms app changed and the September 21 schedule patch no longer matches.');
    source = source.replace(before, after);
  };

  replaceOnce(
`function upcomingBookingDates() {
  return [upcomingTuesdayISO(), upcomingSaturdayISO()].sort();
}`,
`const SPECIAL_BOOKING_DATE = '${SPECIAL_BOOKING_DATE}';
const SPECIAL_BOOKING_DATE_OPENS = '${SPECIAL_BOOKING_DATE_OPENS}';
function isSpecialBookingDate(date) { return date === SPECIAL_BOOKING_DATE; }
function bookingDayLabel(date) {
  return dateObj(date).toLocaleDateString(undefined, { weekday: 'long' });
}
function upcomingBookingDates() {
  const dates = [upcomingTuesdayISO(), upcomingSaturdayISO()];
  const today = todayISO();
  if (today >= SPECIAL_BOOKING_DATE_OPENS && today <= SPECIAL_BOOKING_DATE) dates.push(SPECIAL_BOOKING_DATE);
  return [...new Set(dates)].sort();
}`
  );

  replaceOnce(
`function shouldAutoApproveMemberBooking(date, now = new Date()) {
  return isTuesday(date) || isSaturday(date);
}`,
`function shouldAutoApproveMemberBooking(date, now = new Date()) {
  return isTuesday(date) || isSaturday(date) || isSpecialBookingDate(date);
}`
  );

  replaceOnce(
`function scheduleSegments(date) {
  if (isSaturday(date)) return [`,
`function scheduleSegments(date) {
  if (isSpecialBookingDate(date)) return [
    { start: '10:00', end: '11:00', label: 'Morning service', service: true },
    { start: '11:00', end: '14:30', label: 'Late morning and early afternoon' },
    { start: '14:30', end: '15:30', label: 'Afternoon service', service: true },
    { start: '15:30', end: '23:00', label: 'Afternoon and evening' }
  ];
  if (isSaturday(date)) return [`
  );

  source = source.replaceAll("(isTuesday(date) ? 'Tuesday' : 'Saturday')", 'bookingDayLabel(date)');
  source += '\n//# sourceURL=app.js?september-21-special-schedule\n';

  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

loadClassicAppWithSpecialSchedule().catch(error => {
  console.error(error);
  const app = document.getElementById('app');
  if (app) app.innerHTML = '<section class="member-booking"><div class="member-intro"><h1>Study Rooms could not load.</h1><p>Please reload the page.</p></div></section>';
});
