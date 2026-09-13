const SPECIAL_BOOKING_DATE = '2026-09-21';
const SPECIAL_BOOKING_DATE_OPENS = '2026-09-13';

async function loadTvWithSpecialSchedule() {
  const response = await fetch('./tv.js', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the lobby schedule (${response.status}).`);
  let source = await response.text();

  const replaceOnce = (before, after) => {
    if (!source.includes(before)) throw new Error('The lobby schedule changed and the September 21 patch no longer matches.');
    source = source.replace(before, after);
  };

  replaceOnce(
`function offeredDates(today = localISO()) {
  return [...new Set([today, dateForWeekday(today, 2), dateForWeekday(today, 6)])];
}`,
`const SPECIAL_BOOKING_DATE = '${SPECIAL_BOOKING_DATE}';
const SPECIAL_BOOKING_DATE_OPENS = '${SPECIAL_BOOKING_DATE_OPENS}';
function offeredDates(today = localISO()) {
  const dates = [today, dateForWeekday(today, 2), dateForWeekday(today, 6)];
  if (today >= SPECIAL_BOOKING_DATE_OPENS && today <= SPECIAL_BOOKING_DATE) dates.push(SPECIAL_BOOKING_DATE);
  return [...new Set(dates)].sort();
}`
  );

  replaceOnce(
`function selectedConfig() {
  return dayConfig[dateFromISO(selectedDate).getDay()];
}`,
`function selectedConfig() {
  if (selectedDate === SPECIAL_BOOKING_DATE) {
    return {
      name: 'Monday',
      start: '10:00',
      end: '23:00',
      services: [
        { start: '10:00', end: '11:00', label: 'Service' },
        { start: '14:30', end: '15:30', label: 'Service' }
      ]
    };
  }
  return dayConfig[dateFromISO(selectedDate).getDay()];
}`
  );

  source += '\n//# sourceURL=tv.js?september-21-special-schedule\n';
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

loadTvWithSpecialSchedule().catch(error => {
  console.error(error);
  const schedule = document.getElementById('schedule');
  if (schedule) schedule.innerHTML = '<section class="empty-state"><h2>Schedule unavailable</h2><p>Please reload the display.</p></section>';
});
