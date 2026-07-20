import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await mkdir(join(root, 'test-results'), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.setItem('srs-my-bookings', JSON.stringify(['demo-whiteboard-1', 'demo-room-4', 'demo-room-denied']));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=1`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('tab', { name: 'Home' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.home-unit-row').count(), 4);
  assert.match(await page.locator('.home-notifications').innerText(), /Reservation pending/);
  assert.match(await page.locator('.home-notifications').innerText(), /Your next reservation/);
  assert.match(await page.locator('.home-notifications').innerText(), /Reservation denied/);
  assert.ok(await page.locator('.dashboard-feed').isVisible());
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: join(root, 'test-results/home-phone.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Reservations', exact: true }).click();
  assert.equal(await page.locator('.time-period').count(), 3);
  for (const [index, label] of ['Morning', 'Afternoon', 'Evening'].entries()) {
    assert.match(await page.locator('.time-period').nth(index).innerText(), new RegExp(label));
  }
  const firstDate = await page.locator('.date-current strong').innerText();
  await page.getByRole('button', { name: 'Next reservation date' }).click();
  assert.notEqual(await page.locator('.date-current strong').innerText(), firstDate);
  await page.getByRole('button', { name: 'Previous reservation date' }).click();

  assert.equal(await page.locator('#member-end-0').count(), 0);
  await page.locator('.start-time-choice[data-start="10:30"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.dataset.start === '10:30');
  assert.equal(await page.locator('.start-time-choice[data-start="10:30"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#member-end-0').selectOption('11:00');
  await page.locator('.start-time-choice[data-start="10:00"]').click();
  assert.equal(await page.locator('#member-end-0').count(), 1);
  assert.equal(await page.locator('#member-end-0').inputValue(), '');
  assert.equal(await page.locator('#member-end-0 option[value="10:00"]').count(), 0);
  assert.equal(await page.locator('#member-end-0 option[value="10:30"]').count(), 1);
  await page.locator('#member-end-0').selectOption('11:30');
  assert.match(await page.locator('.availability-conflict').innerText(), /There are no rooms available in the time slot that was selected\./);
  assert.match(await page.locator('.availability-conflict').innerText(), /10:00 AM to 11:00 AM instead/);
  await page.getByRole('button', { name: 'Yes' }).click();
  assert.match(await page.locator('.member-selection-summary').innerText(), /10:00 AM–11:00 AM/);
  assert.match(await page.locator('.selected-counts').innerText(), /open/);
  assert.match(await page.locator('.selected-counts').innerText(), /pending/);
  await page.getByText('Who is in each numbered unit?').click();
  assert.equal(await page.locator('.selected-units .unit-detail').count(), 4);
  await page.getByRole('button', { name: 'Continue' }).click();
  assert.match(await page.locator('#booking-dialog-summary').innerText(), /10:00 AM–11:00 AM/);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.booking-dialog').count(), 0);
  await page.screenshot({ path: join(root, 'test-results/reservation-phone.png'), fullPage: true });

  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator('#tab-schedule').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#tab-home').getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-home');
  await page.locator('#tab-schedule').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#tab-schedule').getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-schedule');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(root, 'test-results/home-desktop.png'), fullPage: true });

  const fullTabsPage = await context.newPage();
  await fullTabsPage.setViewportSize({ width: 320, height: 720 });
  await fullTabsPage.route('https://www.gstatic.com/**', route => route.abort());
  await fullTabsPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await fullTabsPage.getByRole('tab', { name: 'Admin' }).waitFor();
  assert.equal(await fullTabsPage.getByRole('tab').count(), 4);
  assert.equal(await fullTabsPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await fullTabsPage.close();

  assert.deepEqual(errors, []);
  console.log('UI and accessibility smoke checks passed');
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
