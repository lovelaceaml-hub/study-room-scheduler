import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
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
const page = await context.newPage();

function timeFromLabel(text) {
  const match = String(text || '').match(/\d{1,2}:\d{2}\s?(?:AM|PM)/);
  return match ? match[0] : '';
}

function boxOf(locator) {
  return locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
  });
}

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=1&test=1`, { waitUntil: 'networkidle' });

  // The day is one schedule now: no Morning/Afternoon/Evening boxes.
  assert.equal(await page.locator('.home-daypart').count(), 0, 'The daypart boxes are gone');
  assert.equal(await page.locator('.home-day-map').count(), 1, 'The whole day is one scroll region');

  const origin = page.locator('.home-open-cell').first();
  assert.ok(await origin.count(), 'The demo provides an open reservation start cell');
  const startLabel = timeFromLabel(await origin.getAttribute('aria-label'));
  await origin.click();
  const firstEnd = page.locator('.end-time-choice').first();
  const endLabel = timeFromLabel(await firstEnd.innerText());
  await firstEnd.click();

  // Choosing an end opens a confirmation popup. The old fixed bottom bar,
  // which people missed entirely, must not come back.
  const dialog = page.locator('.selection-confirm-dialog');
  assert.ok(await dialog.isVisible(), 'The confirmation popup appears as soon as an end time is chosen');
  assert.equal(await page.locator('.home-selection-summary').count(), 0, 'The fixed bottom bar is gone');
  const range = await dialog.locator('.selection-confirm-range').innerText();
  assert.match(range, /\d{1,2}:\d{2}\s?(AM|PM)\s*–\s*\d{1,2}:\d{2}\s?(AM|PM)/, 'The popup states the exact times');
  assert.ok(range.includes(startLabel), `The popup shows the chosen start (${startLabel})`);
  assert.ok(range.includes(endLabel), `The popup shows the chosen end (${endLabel})`);
  assert.match(range, /Study room · exact reservation time/);
  assert.equal(await page.locator('.home-dashboard').evaluate(node => node.inert), true, 'Home is inert behind the confirmation popup');
  assert.ok(await dialog.getByRole('button', { name: 'Clear', exact: true }).isVisible());
  assert.ok(await dialog.getByRole('button', { name: 'Continue' }).isVisible());

  const phone = await boxOf(dialog);
  assert.ok(phone.top >= 0 && phone.bottom <= phone.viewport, 'The confirmation popup fits inside the phone viewport');

  await page.setViewportSize({ width: 1280, height: 720 });
  const desktop = await boxOf(dialog);
  assert.ok(desktop.top >= 0 && desktop.bottom <= desktop.viewport, 'The confirmation popup also fits inside the desktop viewport');

  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await page.locator('.selection-confirm-dialog').count(), 0, 'Clear puts the chosen time back');

  // A full time where everything in the way is an Other offers the override.
  // The demo puts that on Tuesday, so step the day selector until it is shown.
  for (let step = 0; step < 4; step += 1) {
    if ((await page.locator('.date-current strong').innerText()).startsWith('Tuesday')) break;
    await page.locator('[data-act="home-date-step"][data-id="1"]').click();
  }
  assert.match(await page.locator('.date-current strong').innerText(), /^Tuesday/, 'The Tuesday schedule is shown');
  await page.locator('.home-occupied-cell[data-start="11:00"]').first().click();
  await page.getByRole('button', { name: /End at 11:30 AM/ }).click();
  const fullDialog = page.locator('.selection-confirm-dialog');
  assert.match(await fullDialog.innerText(), /This time is full/);
  assert.match(await fullDialog.innerText(), /held by .* for Other/);
  assert.ok(await fullDialog.getByRole('button', { name: 'Override with priority' }).isVisible(), 'A Contact or New Member can take an Other reservation');

  // The purposes offered are the three current ones, in priority order.
  await fullDialog.getByRole('button', { name: 'Override with priority' }).click();
  const chips = await page.locator('.purpose-grid .purpose-chip').allInnerTexts();
  assert.deepEqual(chips.map(text => text.trim()), ['1. Contact', '2. New Member'], 'Taking a time needs a priority purpose');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log('confirmation popup smoke: passed');
