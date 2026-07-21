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
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.shouldAutoApproveMemberBooking('2026-07-25', new Date('2026-07-25T16:59:00Z'))), false);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.shouldAutoApproveMemberBooking('2026-07-25', new Date('2026-07-25T17:00:00Z'))), true);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.setTabForTest('schedule')), 'home', 'Stale Reservations state falls back to Home');
  assert.equal(await page.getByRole('tab').count(), 3, 'Reservations is removed at every layout width');
  assert.equal(await page.locator('#tab-schedule').count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected'), 'true');
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.getByRole('tab').count(), 3, 'Desktop keeps the simplified three-tab navigation');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByText('Real Cached Person').count(), 0, 'Demo never reads cached member data');

  assert.equal(await page.locator('.member-intro h1').count(), 0, 'Home no longer repeats an introductory heading');
  assert.ok(await page.getByRole('heading', { name: 'Day overview' }).isVisible());
  assert.equal(await page.locator('.home-day-overview .section-note').count(), 0);
  assert.equal(await page.locator('.dashboard-feed .activity-row').count(), 2, 'Home shows exactly two compact live updates');
  assert.equal(await page.locator('.dashboard-feed .activity-list').evaluate(node => node.scrollHeight <= node.clientHeight), true, 'Live updates do not create a nested scroller');
  assert.equal(await page.locator('.home-daypart').count(), 3);
  assert.notEqual(await page.locator('.home-daypart').nth(0).getAttribute('open'), null);
  assert.equal(await page.locator('.home-daypart').nth(0).locator('.home-daypart-summary').innerText(), 'Hide schedule');
  assert.equal(await page.locator('.home-daypart').nth(1).locator('.home-daypart-summary').innerText(), 'Show schedule');
  assert.equal(await page.locator('.home-scroll-cue').first().getAttribute('data-state'), 'top');
  assert.equal(await page.locator('.home-scroll-cue').first().innerText(), 'Scroll down ↓', 'The open map has a visible downward scroll cue');
  await page.locator('.home-daypart').nth(1).locator('summary').click();
  assert.notEqual(await page.locator('.home-daypart').nth(0).getAttribute('open'), null, 'Opening another daypart preserves the first opened section');
  assert.notEqual(await page.locator('.home-daypart').nth(1).getAttribute('open'), null);
  assert.equal(await page.locator('.home-daypart').nth(1).locator('.home-daypart-summary').innerText(), 'Hide schedule');
  assert.ok(await page.locator('.home-occupied-cell').count() > 0);
  assert.ok(await page.locator('.home-cell-name').count() > 0);
  assert.match(await page.locator('.home-cell-purpose').first().innerText(), /Contact|Meeting/);
  assert.equal(await page.locator('.home-day-overview').getByText('Family Bible study', { exact: true }).count(), 0, 'Home cells expose categories, never free-form notes');
  assert.equal(await page.locator('.home-held-cell[data-held="true"]').count(), 1, 'The demo includes an Admin-held room cell');
  assert.match(await page.locator('.home-held-cell').innerText(), /^Reserved\s+Reserved$/, 'Admin-held cells never expose an Admin-entered name');
  assert.equal(await page.locator('.home-day-overview').getByText('Admin Hold — Private', { exact: true }).count(), 0);

  const homeDate = await page.locator('.home-date-selector .date-current strong').innerText();
  assert.equal(await page.locator('.home-date-selector .date-arrow').first().isDisabled(), true);
  await page.locator('.home-date-selector .date-arrow').nth(1).click();
  assert.notEqual(await page.locator('.home-date-selector .date-current strong').innerText(), homeDate);
  assert.equal(await page.locator('.home-daypart').first().locator('.member-service button').count(), 0, 'Service bands cannot start a reservation');
  await page.locator('.home-date-selector .date-arrow').first().click();

  const origin = page.locator('.home-open-cell[data-start="10:30"][data-unit="room-1"]');
  assert.equal(await origin.count(), 1);
  await origin.click();
  assert.ok(await page.locator('.end-time-dialog').isVisible());
  assert.equal(await page.locator('.home-dashboard').evaluate(node => node.inert), true, 'Home is inert behind the end-time sheet');
  await page.getByRole('button', { name: 'Close end time choices' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey?.includes('home-open-'));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), await origin.getAttribute('data-focus-key'));

  await origin.click();
  await page.getByRole('button', { name: /End at 11:30 AM/ }).click();
  assert.match(await page.locator('.availability-conflict').innerText(), /There are no rooms available/);
  await page.getByRole('button', { name: 'No' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey?.includes('home-open-'));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.focusKey), await origin.getAttribute('data-focus-key'), 'Conflict recovery returns to the exact originating cell');

  await origin.click();
  await page.getByRole('button', { name: /End at 11:30 AM/ }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  assert.match(await page.locator('.home-range-controls').innerText(), /10:30 AM–11:00 AM/);
  assert.equal(await page.evaluate(() => window.__SRS_TEST_HELPERS__.homeReservationState().availabilityConflict), false, 'Accepting a shorter range resolves the conflict');
  assert.match(await page.locator('.selected-counts').innerText(), /open/);
  assert.match(await page.locator('.selected-counts').innerText(), /pending/);
  await page.locator('.selected-counts').click();
  assert.match(await page.locator('.availability-dialog').innerText(), /Approved unit assignments/);
  await page.getByRole('button', { name: 'Close availability details' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'member-range-details');
  await page.getByRole('button', { name: 'Continue' }).click();
  assert.match(await page.locator('#booking-dialog-summary').innerText(), /10:30 AM–11:00 AM/);
  assert.equal(await page.locator('.home-dashboard').evaluate(node => node.inert), true, 'Home is inert behind the reservation dialog');
  await page.locator('#su-name').fill('Sample Member');
  await page.getByRole('button', { name: 'Reserve now' }).click();
  assert.equal(await page.getByText('Sample preview only — no reservation was saved.', { exact: true }).count(), 1, 'The demo form completes safely without Firebase');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Close reservation popup' }).click();
  await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'member-continue');
  assert.notEqual(await page.locator('.home-daypart').nth(0).getAttribute('open'), null, 'The source daypart stays open through the booking flow');

  await page.evaluate(() => window.__SRS_TEST_HELPERS__.seedHomeReservationStateForTest());
  await page.locator('[data-act="home-overview-type"][data-id="whiteboard"]').click();
  assert.deepEqual(await page.evaluate(() => window.__SRS_TEST_HELPERS__.homeReservationState()), {
    memberSelection: false, availabilityConflict: false, endPrompt: false, availabilityDetails: false, returnFocusKey: null
  }, 'Changing the Home resource clears every reservation-flow state');
  await page.evaluate(() => window.__SRS_TEST_HELPERS__.seedHomeReservationStateForTest());
  await page.locator('.home-date-selector .date-arrow').nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.__SRS_TEST_HELPERS__.homeReservationState()), {
    memberSelection: false, availabilityConflict: false, endPrompt: false, availabilityDetails: false, returnFocusKey: null
  }, 'Changing the Home date clears every reservation-flow state');
  await page.locator('.home-date-selector .date-arrow').first().click();
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);

  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.getByRole('tab').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
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

  await page.getByRole('tab', { name: 'Admin' }).click();
  assert.match(await page.locator('.admin-workspace').innerText(), /Sample Admin preview/);
  assert.deepEqual(errors, []);
  console.log('Home-first UI and accessibility smoke checks passed');
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
