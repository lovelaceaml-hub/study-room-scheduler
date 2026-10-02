'use strict';

// Mistakes in config.js that would otherwise show up only as odd schedules:
// a special day that never opens, a service off the grid, two units sharing
// an id. index.js refuses to load with any of these, so a deploy fails before
// it reaches members, and the tests check the real config too.

const { toMinutes, weekdayOf } = require('./schedule');

// Every problem in `rules` (the exports of config.js), as sentences.
function configProblems(rules) {
  const problems = [];
  const open = toMinutes(rules.OPEN);
  const close = toMinutes(rules.CLOSE);
  const onGrid = time => Number.isFinite(toMinutes(time)) && toMinutes(time) % rules.SLOT_MINUTES === 0;

  if (!onGrid(rules.OPEN) || !onGrid(rules.CLOSE) || open >= close) {
    problems.push('OPEN and CLOSE must be on the grid, OPEN first.');
  }
  if (!Number.isInteger(rules.BOOKING_WINDOW_DAYS) || rules.BOOKING_WINDOW_DAYS < 1) {
    problems.push('BOOKING_WINDOW_DAYS must be 1 or more.');
  }

  const checkServices = (where, services) => {
    if (!Array.isArray(services)) {
      problems.push(`${where}: services must be a list.`);
      return;
    }
    for (const service of services) {
      const fits = onGrid(service?.start) && onGrid(service?.end)
        && open <= toMinutes(service.start) && toMinutes(service.start) < toMinutes(service.end) && toMinutes(service.end) <= close;
      if (!fits) problems.push(`${where}: service ${JSON.stringify(service)} must be on the grid, inside opening hours, start before end.`);
    }
  };
  for (const [weekday, services] of Object.entries(rules.WEEKLY_DAYS)) {
    if (!/^[0-6]$/.test(weekday)) problems.push(`WEEKLY_DAYS: ${weekday} is not a weekday (0 to 6).`);
    checkServices(`WEEKLY_DAYS ${weekday}`, services);
  }
  const specialDates = new Set();
  for (const day of rules.SPECIAL_DAYS) {
    const where = `SPECIAL_DAYS ${day?.date}`;
    if (Number.isNaN(weekdayOf(day?.date)) || Number.isNaN(weekdayOf(day?.opens))) {
      problems.push(`${where}: date and opens must be real dates (YYYY-MM-DD).`);
    } else if (day.opens > day.date) {
      problems.push(`${where}: opens must be on or before the day.`);
    }
    if (specialDates.has(day?.date)) problems.push(`${where}: listed twice.`);
    specialDates.add(day?.date);
    checkServices(where, day?.services);
  }

  const ids = Object.values(rules.RESOURCES).flatMap(resource => resource.units.map(unit => unit.id));
  for (const id of ids) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) problems.push(`RESOURCES: unit id ${JSON.stringify(id)} must be letters, digits, - or _.`);
  }
  if (new Set(ids).size !== ids.length) problems.push('RESOURCES: every unit id must be different.');

  const order = Object.keys(rules.PURPOSES);
  if (order.includes(rules.HOLD)) problems.push(`PURPOSES: ${rules.HOLD} is the Admin hold, not a purpose.`);
  for (const [purpose, details] of Object.entries(rules.PURPOSES)) {
    for (const taken of details.canTake) {
      if (order.indexOf(taken) <= order.indexOf(purpose)) problems.push(`PURPOSES: ${purpose} may only take lower purposes, not ${taken}.`);
    }
    if (!Number.isInteger(details.detailMax) || details.detailMax < 1) problems.push(`PURPOSES: ${purpose} needs a detailMax.`);
  }
  return problems;
}

module.exports = { configProblems };
