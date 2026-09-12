import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const root = normalize(new URL('..', import.meta.url).pathname);
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.setItem('srs-my-bookings', JSON.stringify(['real-cache-booking']));
  localStorage.setItem('srs-data-v2', JSON.stringify({
    queryDates: ['2026-07-21', '2026-07-25'],
    bookings: {
      'real-cache-booking': {
        date: '2026-07-21', start: '10:00', end: '11:00', name: 'Real Cached Person', status: 'approved',
        needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }
      }
    }
  }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=1&test=1`, { waitUntil: 'networkidle' });
  // No day waits for approval any more: Tuesday and Saturday are both instant,
  // at any hour, and other weekdays are still not booking days at all.
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.shouldAutoApproveMemberBooking('2026-07-25', new Date('2026-07-25T16:59:00Z'))), true);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.shouldAutoApproveMemberBooking('2026-07-25', new Date('2026-07-25T17:00:00Z'))), true);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.shouldAutoApproveMemberBooking('2026-07-21', new Date('2026-07-17T19:00:00Z'))), true);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.shouldAutoApproveMemberBooking('2026-07-24', new Date('2026-07-17T19:00:00Z'))), false);
  assert.match(await page.locator('.home-date-selector .date-current').innerText(), /Confirmed instantly when open/);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.setTabForTest('schedule')), 'home', 'Stale Reservations state falls back to Home');
  assert.equal(await page.getByRole('tab').count(), 3, 'Reservations is removed at every layout width');
  assert.equal(await page.locator('#tab-schedule').count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected'), 'true');
  const demoScheduleHref = await page.getByRole('link', { name: 'Schedule' }).getAttribute('href');
  assert.equal(demoScheduleHref, 'tv.html?tv=1&demo=1', 'The demo Schedule action retains fixture-only TV mode');
  const tvPreview = await context.newPage();
  const tvFirebaseRequests = [];
  tvPreview.on('request', request => {
    if (request.url().includes('gstatic.com/firebasejs')) tvFirebaseRequests.push(request.url());
  });
  await tvPreview.goto(`http://127.0.0.1:${port}/${demoScheduleHref}`, { waitUntil: 'networkidle' });
  assert.match(tvPreview.url(), /tv=1&demo=1/, 'Opening the demo Schedule action keeps demo mode in the TV URL');
  assert.equal(tvFirebaseRequests.length, 0, 'Demo Schedule TV view does not load Firebase');
  await tvPreview.close();
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.getByRole('tab').count(), 3, 'Desktop keeps the simplified three-tab navigation');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByText('Real Cached Person').count(), 0, 'Demo never reads cached member data');
  assert.deepEqual(await page.evaluate(() => ({
    number: window.__SRS_TEST_HELPERS__.timestampMillis(42),
    date: window.__SRS_TEST_HELPERS__.timestampMillis(new Date(1700000000000)),
    iso: window.__SRS_TEST_HELPERS__.timestampMillis('2023-11-14T22:13:20.000Z'),
    firestore: window.__SRS_TEST_HELPERS__.timestampMillis({ seconds: 1700000000, nanoseconds: 500000000 })
  })), {
    number: 42, date: 1700000000000, iso: 1700000000000, firestore: 1700000000500
  }, 'Live update timestamps normalize number, Date, ISO, and Firestore Timestamp values');

  assert.equal(await page.locator('.member-intro h1').count(), 0, 'Home no longer repeats an introductory heading');
  assert.ok(await page.getByRole('heading', { name: 'Day overview' }).isVisible());
  assert.equal(await page.locator('.home-day-overview .section-note').count(), 0);
  assert.ok(await page.locator('.dashboard-feed .activity-row').count() > 2, 'Home keeps every live update in the scrollable feed');
  assert.equal(await page.locator('.dashboard-feed .activity-list').evaluate(node => node.scrollHeight > node.clientHeight), true, 'Live updates has an independent vertical scroller');
  assert.match(await page.locator('.dashboard-feed .activity-row').first().innerText(), /Jordan A\./, 'The visually first live update is the latest decision, including ISO timestamps');
  const fullyVisibleUpdates = await page.locator('.dashboard-feed .activity-list').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return [...node.querySelectorAll('.activity-row')].filter(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }).length;
  });
  assert.equal(fullyVisibleUpdates, 2, 'The compact Live updates viewport shows two complete rows at a time');
  assert.equal(await page.locator('.activity-scroll-cue').getAttribute('data-state'), 'top');
  assert.equal(await page.locator('.activity-scroll-cue').innerText(), 'More updates below ↓', 'The live feed gives an obvious downward scroll affordance');
  assert.equal(await page.locator('.dashboard-feed .activity-list').getAttribute('aria-describedby'), 'live-updates-scroll-cue');
  const cueDoesNotOverlapUpdates = await page.locator('.dashboard-feed').evaluate(feed => {
    const cue = feed.querySelector('.activity-scroll-cue').getBoundingClientRect();
    const list = feed.querySelector('.activity-list').getBoundingClientRect();
    return [...feed.querySelectorAll('.activity-row')]
      .filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > list.top && rect.top < list.bottom;
      })
      .every(row => {
        const rect = row.getBoundingClientRect();
        return cue.right <= rect.left || cue.left >= rect.right || cue.bottom <= rect.top || cue.top >= rect.bottom;
      });
  });
  assert.equal(cueDoesNotOverlapUpdates, true, 'The Live updates cue does not overlap a visible update row');
  assert.deepEqual(await page.locator('.home-day-overview .member-resource').allInnerTexts(), ['Study room', 'Whiteboard', 'TV'], 'Home resource controls omit capacity counts');
  const resourceTarget = await page.locator('.home-day-overview .member-resource').first().evaluate(node => node.getBoundingClientRect().height);
  assert.ok(resourceTarget >= 44 && resourceTarget <= 46, `Home resource controls are compact 44px touch targets (${resourceTarget}px)`);
  // One whole day, one scroll region: the Morning/Afternoon/Evening boxes were
  // removed on 11 September 2026 because a closed box read as a missing schedule.
  assert.equal(await page.locator('.home-daypart').count(), 0, 'The daypart boxes are gone');
  assert.equal(await page.locator('.home-day-overview .home-day-map').count(), 1, 'The whole day is one scroll region');
  assert.deepEqual(await page.locator('.purpose-legend-item').allInnerTexts(), ['1. Contact', '2. New Member', '3. Other'], 'The colour legend names every purpose in priority order');
  assert.equal(await page.locator('.home-scroll-cue').first().getAttribute('data-state'), 'top');
  assert.equal(await page.locator('.home-scroll-cue').first().innerText(), 'Scroll down ↓', 'The day map has a visible downward scroll cue');
  await page.setViewportSize({ width: 393, height: 852 });
  const grid393 = await page.locator('.home-day-map').first().evaluate(map => {
    const row = map.querySelector('.member-calendar-row:not(.unit-header)');
    const timeCells = [...map.querySelectorAll('.member-calendar-row:not(.unit-header) .member-time')];
    const tiles = [...row.querySelectorAll('.member-square')];
    const tile = tiles[0];
    const gaps = tiles.slice(1).map((cell, index) => cell.getBoundingClientRect().left - tiles[index].getBoundingClientRect().right);
    const rowHeights = [...map.querySelectorAll('.member-calendar-row:not(.unit-header)')].map(cell => cell.getBoundingClientRect().height);
    const names = [...map.querySelectorAll('.home-cell-name')];
    const purposes = [...map.querySelectorAll('.home-cell-purpose')];
    return {
      timeWidth: timeCells[0].getBoundingClientRect().width,
      tileWidth: tile.getBoundingClientRect().width,
      tileHeight: tile.getBoundingClientRect().height,
      labelsFit: timeCells.every(cell => getComputedStyle(cell).whiteSpace === 'nowrap' && cell.scrollWidth <= cell.clientWidth),
      tileGapsUniform: gaps.every(gap => Math.abs(gap - gaps[0]) < .5),
      maxRowHeight: Math.max(...rowHeights),
      namesFit: names.every(cell => cell.scrollWidth <= cell.clientWidth),
      overflowingNames: names.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => ({ text: cell.textContent, clientWidth: cell.clientWidth, scrollWidth: cell.scrollWidth })),
      purposesSafe: purposes.every(cell => getComputedStyle(cell).textOverflow === 'ellipsis' && getComputedStyle(cell).whiteSpace === 'nowrap'),
      minNameFont: Math.min(...names.map(cell => parseFloat(getComputedStyle(cell).fontSize))),
      minPurposeFont: Math.min(...purposes.map(cell => parseFloat(getComputedStyle(cell).fontSize)))
    };
  });
  assert.ok(grid393.timeWidth <= 60, `393px Home time column is compact (${grid393.timeWidth}px)`);
  assert.ok(grid393.tileWidth >= 64, `393px Home room tiles receive recovered width (${grid393.tileWidth}px)`);
  assert.ok(grid393.tileHeight >= 44 && grid393.tileHeight <= 46, `393px Home tiles are compact but touch-safe (${grid393.tileHeight}px)`);
  assert.equal(grid393.labelsFit, true, '393px Home time labels stay on one line');
  assert.equal(grid393.tileGapsUniform, true, '393px Home room tiles use even spacing');
  assert.ok(grid393.maxRowHeight <= 52, `393px Home schedule rows stay compact (${grid393.maxRowHeight}px)`);
  assert.equal(grid393.namesFit, true, '393px Home occupant names fit their tiles without clipping');
  assert.equal(grid393.purposesSafe, true, '393px Home secondary purposes use safe compact ellipsis behavior');
  assert.ok(grid393.minNameFont >= 10, `393px Home names remain legible (${grid393.minNameFont}px)`);
  assert.ok(grid393.minPurposeFont >= 8.5, `393px Home purposes remain legible (${grid393.minPurposeFont}px)`);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('.home-occupied-cell').count() > 0);
  assert.ok(await page.locator('.home-cell-name').count() > 0);
  assert.match(await page.locator('.home-cell-purpose').first().innerText(), /Contact|New Member|Other|Meeting/);
  assert.ok(await page.locator('.home-occupied-cell.purpose-contact, .home-occupied-cell.purpose-new-member, .home-occupied-cell.purpose-other').count() > 0, 'Reserved cells carry their purpose colour');
  assert.equal(await page.locator('.home-day-overview').getByText('Family Bible study', { exact: true }).count(), 0, 'Home cells expose categories, never free-form notes');
  let movedToTuesdayForFixture = false;
  if ((await page.locator('.home-date-selector .date-current strong').innerText()).startsWith('Saturday')) {
    await page.locator('.home-date-selector .date-arrow').nth(1).click();
    movedToTuesdayForFixture = true;
  }
  assert.equal(await page.locator('.home-held-cell[data-held="true"]').count(), 1, 'The demo includes an Admin-held room cell');
  assert.match(await page.locator('.home-held-cell').innerText(), /^Reserved\s+Reserved$/, 'Admin-held cells never expose an Admin-entered name');
  assert.equal(await page.locator('.home-day-overview').getByText('Admin Hold — Private', { exact: true }).count(), 0);
  if (movedToTuesdayForFixture) await page.locator('.home-date-selector .date-arrow').first().click();

  const homeDate = await page.locator('.home-date-selector .date-current strong').innerText();
  assert.equal(await page.locator('.home-date-selector .date-arrow').first().isDisabled(), true);
  await page.locator('.home-date-selector .date-arrow').nth(1).click();
  assert.notEqual(await page.locator('.home-date-selector .date-current strong').innerText(), homeDate);
  assert.equal(await page.locator('.home-day-map .member-service button').count(), 0, 'Service bands cannot start a reservation');
  await page.locator('.home-date-selector .date-arrow').first().click();

  if ((await page.locator('.home-date-selector .date-current strong').innerText()).startsWith('Saturday')) {
    await page.locator('.home-date-selector .date-arrow').nth(1).click();
  }
  const origin = page.locator('.home-open-cell[data-start="10:30"][data-unit="room-1"]');
  assert.equal(await origin.count(), 1);
  await origin.click();
  assert.ok(await page.locator('.end-time-dialog').isVisible());
  assert.equal(await page.locator('.home-dashboard').evaluate(node => node.inert), true, 'Home is inert behind the end-time sheet');
  assert.equal(await page.locator('#masthead .head-in').evaluate(node => node.inert), true, 'Every masthead action is inert behind the end-time sheet');
  await page.getByRole('button', { name: 'Close end time choices' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey?.includes('home-open-'));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), await origin.getAttribute('data-focus-key'));

  await origin.click();
  await page.getByRole('button', { name: /End at 11:30 AM/ }).click();
  assert.match(await page.locator('.selection-confirm-dialog').innerText(), /This time is full/);
  assert.match(await page.locator('.override-offer').innerText(), /held by .* for Other/);
  assert.ok(await page.getByRole('button', { name: 'Override with priority' }).isVisible(), 'A full time whose holders are all Other can be taken');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await page.locator('.selection-confirm-dialog').count(), 0);

  await origin.click();
  await page.getByRole('button', { name: /End at 11:30 AM/ }).click();
  await page.getByRole('button', { name: /end at 11:00 AM instead/ }).click();
  assert.match(await page.locator('.selection-confirm-range').innerText(), /10:30 AM\s*–\s*11:00 AM/);
  assert.equal(await page.locator('.override-offer').count(), 0, 'The shorter ending takes nobody\u2019s reservation');
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.homeReservationState().availabilityConflict), false, 'Choosing a shorter range resolves the conflict');
  assert.match(await page.locator('.selected-counts').innerText(), /open/);
  assert.doesNotMatch(await page.locator('.selected-counts').innerText(), /pending/, 'With nothing awaiting review, the pending count is not shown');
  await page.locator('.selected-counts').click();
  assert.match(await page.locator('.availability-dialog').innerText(), /Approved unit assignments/);
  await page.getByRole('button', { name: 'Close availability details' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'member-range-details');
  await page.getByRole('button', { name: 'Continue' }).click();
  assert.match(await page.locator('#booking-dialog-summary').innerText(), /10:30 AM–11:00 AM/);
  assert.match(await page.locator('#booking-dialog-title').innerText(), /Reserve this time/);
  assert.match(await page.locator('.booking-approval-hint').innerText(), /confirmed right away/);
  assert.equal(await page.locator('.home-dashboard').evaluate(node => node.inert), true, 'Home is inert behind the reservation dialog');
  await page.locator('#su-name').fill('Sample Member');
  assert.equal(await page.locator('#su-reserved-for').count(), 1, 'Reservation form collects a purpose-specific reserved-for value');
  await page.locator('#su-reserved-for').fill('Sample contact');
  await page.getByRole('button', { name: 'Reserve now' }).click();
  assert.equal(await page.getByText('Sample preview only — no reservation was saved.', { exact: true }).count(), 1, 'The demo form completes safely without Firebase');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Close reservation popup' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'member-continue');

  // Closing the reservation popup keeps the chosen time and brings its
  // confirmation back, so clear it before moving around the schedule.
  assert.ok(await page.locator('.selection-confirm-dialog').isVisible(), 'Closing the reservation popup returns to the confirmation');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await page.locator('.selection-confirm-dialog').count(), 0);

  // Step back to the earliest eligible date, whichever weekday that is this
  // week, so both arrows below are live regardless of the day the suite runs.
  while (!(await page.locator('.home-date-selector .date-arrow').first().isDisabled())) {
    await page.locator('.home-date-selector .date-arrow').first().click();
  }
  await page.evaluate(() => window.__SRS_TEST_HELPERS__.seedHomeReservationStateForTest());
  await page.locator('[data-act="home-overview-type"][data-id="whiteboard"]').click();
  assert.deepEqual(await page.evaluate(() => window.__SRS_TEST_HELPERS__.homeReservationState()), {
    memberSelection: false, availabilityConflict: false, endPrompt: false, availabilityDetails: false, selectionConfirm: false, returnFocusKey: null
  }, 'Changing the Home resource clears every reservation-flow state');
  await page.evaluate(() => window.__SRS_TEST_HELPERS__.seedHomeReservationStateForTest());
  await page.locator('.home-date-selector .date-arrow').nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.__SRS_TEST_HELPERS__.homeReservationState()), {
    memberSelection: false, availabilityConflict: false, endPrompt: false, availabilityDetails: false, selectionConfirm: false, returnFocusKey: null
  }, 'Changing the Home date clears every reservation-flow state');
  await page.locator('.home-date-selector .date-arrow').first().click();
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);

  await page.locator('[data-act="home-overview-type"][data-id="room"]').click();
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.getByRole('tab').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const grid320 = await page.locator('.home-day-map').first().evaluate(map => {
    const row = map.querySelector('.member-calendar-row:not(.unit-header)');
    const timeCells = [...map.querySelectorAll('.member-calendar-row:not(.unit-header) .member-time')];
    const tiles = [...row.querySelectorAll('.member-square')];
    const tile = tiles[0];
    const gaps = tiles.slice(1).map((cell, index) => cell.getBoundingClientRect().left - tiles[index].getBoundingClientRect().right);
    const names = [...map.querySelectorAll('.home-cell-name')];
    const purposes = [...map.querySelectorAll('.home-cell-purpose')];
    return {
      timeWidth: timeCells[0].getBoundingClientRect().width,
      tileWidth: tile.getBoundingClientRect().width,
      tileHeight: tile.getBoundingClientRect().height,
      labelsFit: timeCells.every(cell => getComputedStyle(cell).whiteSpace === 'nowrap' && cell.scrollWidth <= cell.clientWidth),
      tileGapsUniform: gaps.every(gap => Math.abs(gap - gaps[0]) < .5),
      namesFit: names.every(cell => cell.scrollWidth <= cell.clientWidth),
      overflowingNames: names.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => ({ text: cell.textContent, clientWidth: cell.clientWidth, scrollWidth: cell.scrollWidth })),
      purposesSafe: purposes.every(cell => getComputedStyle(cell).textOverflow === 'ellipsis' && getComputedStyle(cell).whiteSpace === 'nowrap'),
      minNameFont: Math.min(...names.map(cell => parseFloat(getComputedStyle(cell).fontSize))),
      minPurposeFont: Math.min(...purposes.map(cell => parseFloat(getComputedStyle(cell).fontSize)))
    };
  });
  assert.ok(grid320.timeWidth <= 60, `320px Home time column is compact (${grid320.timeWidth}px)`);
  assert.ok(grid320.tileWidth >= 44, `320px Home room tiles retain adequate width (${grid320.tileWidth}px)`);
  assert.ok(grid320.tileHeight >= 44 && grid320.tileHeight <= 46, `320px Home tiles are compact but touch-safe (${grid320.tileHeight}px)`);
  assert.equal(grid320.labelsFit, true, '320px Home time labels stay on one line');
  assert.equal(grid320.tileGapsUniform, true, '320px Home room tiles use even spacing');
  assert.equal(grid320.namesFit, true, `320px Home occupant names fit their tiles without clipping: ${JSON.stringify(grid320.overflowingNames)}`);
  assert.equal(grid320.purposesSafe, true, '320px Home secondary purposes use safe compact ellipsis behavior');
  assert.ok(grid320.minNameFont >= 10, `320px Home names remain legible (${grid320.minNameFont}px)`);
  assert.ok(grid320.minPurposeFont >= 8.5, `320px Home purposes remain legible (${grid320.minPurposeFont}px)`);
  const targetSize = await page.locator('.home-open-cell').first().evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.ok(targetSize.width >= 44 && targetSize.height >= 44, `Open cells are mobile touch targets (${targetSize.width}×${targetSize.height})`);
  const mapCue = await page.locator('.home-day-map').first().evaluate(node => {
    node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2);
    node.dispatchEvent(new Event('scroll'));
    const cue = node.parentElement.querySelector('.home-scroll-cue');
    return { state: cue.dataset.state, text: cue.textContent };
  });
  assert.deepEqual(mapCue, { state: 'middle', text: 'Scroll up or down ↕' }, 'The Home scroll cue gives a visible middle-of-list direction');
  const bottomCue = await page.locator('.home-day-map').first().evaluate(node => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll'));
    const cue = node.parentElement.querySelector('.home-scroll-cue');
    return { state: cue.dataset.state, text: cue.textContent };
  });
  assert.deepEqual(bottomCue, { state: 'bottom', text: 'Scroll up ↑' }, 'The Home scroll cue changes to an upward direction at the bottom');

  const updatesBottomCue = await page.locator('.dashboard-feed .activity-list').evaluate(node => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll'));
    const cue = node.parentElement.querySelector('.activity-scroll-cue');
    return { state: cue.dataset.state, text: cue.textContent };
  });
  assert.deepEqual(updatesBottomCue, { state: 'bottom', text: 'Earlier updates above ↑' }, 'The live updates cue changes direction at the bottom');

  await page.setViewportSize({ width: 393, height: 852 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'The annotation viewport has no horizontal overflow');
  assert.equal(await page.locator('.home-day-overview .member-resource').first().evaluate(node => node.getBoundingClientRect().height), 44, 'The annotation viewport keeps compact resource controls');
  assert.equal(await page.locator('.dashboard-feed .activity-list').evaluate(node => node.scrollHeight > node.clientHeight), true, 'The annotation viewport retains the compact scrollable Live updates feed');

  await page.getByRole('tab', { name: 'My reservations' }).click();
  assert.ok(await page.locator('.reservation-card').count() > 0, 'My reservations keeps compact cards');
  assert.equal(await page.locator('.reservation-card .req-sub').count(), 0, 'Card details are condensed into one concise metadata row');
  assert.ok(await page.locator('.reservation-card .reservation-meta').count() > 0);
  assert.ok(await page.getByText(/Reserved for:/).count() > 0, 'Own reservation cards show reserved-for details');
  assert.ok(await page.getByRole('button', { name: /Cancel (reservation|request)/ }).count() > 0, 'Active items have a clear cancel action');
  assert.equal(await page.locator('.cancel-request-btn').first().evaluate(node => node.tagName), 'BUTTON');
  const cancelTarget = await page.locator('.cancel-request-btn').first().evaluate(node => node.getBoundingClientRect().height);
  assert.ok(cancelTarget >= 44, `Cancel is an adequate destructive touch target (${cancelTarget}px)`);

  // Finishing early: a multi-block reservation offers every earlier 30-minute
  // ending, and the demo preview refuses to write anything.
  const endEarlyTarget = await page.locator('.end-early-btn').first().evaluate(node => node.getBoundingClientRect().height);
  assert.ok(endEarlyTarget >= 44, `End early is an adequate touch target (${endEarlyTarget}px)`);
  await page.locator('.end-early-btn').first().click();
  const endEarlySheet = page.locator('.end-time-dialog');
  assert.match(await endEarlySheet.innerText(), /Finished early\?/);
  assert.match(await endEarlySheet.innerText(), /Frees/);
  assert.ok(await endEarlySheet.getByRole('button', { name: /^End at/ }).count() > 0, 'Every earlier ending is offered');
  assert.equal(await page.locator('.reservation-list').evaluate(node => node.inert), true, 'The reservation list is inert behind the ending sheet');
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  // "now" is the last 30-minute boundary Los Angeles has already passed, and
  // only ever on the reservation's own day.
  assert.deepEqual(await page.evaluate(() => {
    const helpers = window.__SRS_TEST_HELPERS__;
    const booking = { date: '2026-07-28', start: '10:00', end: '12:30' };
    return {
      options: helpers.endEarlyOptions(booking),
      midway: helpers.endEarlyNowOption(booking, new Date('2026-07-28T19:05:00Z')),
      beforeStart: helpers.endEarlyNowOption(booking, new Date('2026-07-28T16:00:00Z')),
      otherDay: helpers.endEarlyNowOption(booking, new Date('2026-08-01T19:05:00Z'))
    };
  }), {
    options: ['10:30', '11:00', '11:30', '12:00'],
    midway: '12:00',
    beforeStart: null,
    otherDay: null
  }, 'Ending choices and the "now" hint follow Los Angeles time');
  await endEarlySheet.getByRole('button', { name: /^End at/ }).first().click();
  assert.equal(await page.getByText('Sample preview only — nothing was changed.', { exact: true }).count(), 1, 'The demo ending sheet never writes');
  await page.getByRole('button', { name: 'Keep my time' }).click();
  assert.equal(await page.locator('.end-time-dialog').count(), 0, 'Keeping the time closes the sheet unchanged');

  await page.getByRole('tab', { name: 'Admin' }).click();
  assert.match(await page.locator('.admin-workspace').innerText(), /Sample Admin preview/);
  assert.equal(await page.locator('.admin-workspace .activity-feed').count(), 0, 'Admin no longer shows a Recent updates feed');
  assert.deepEqual(errors, []);
  console.log('Home-first UI and accessibility smoke checks passed');
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
