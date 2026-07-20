import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = normalize(new URL('..', import.meta.url).pathname);
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = normalize(join(root, url.pathname === '/' ? 'tv.html' : url.pathname.replace(/^\/+/, '')));
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const blockedFirebaseRequests = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.url().includes('gstatic.com/firebasejs')) blockedFirebaseRequests.push(request.url());
});

try {
  await page.goto(`http://127.0.0.1:${port}/tv.html?tv=1&demo=1&date=not-a-date`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByText('Choose day', { exact: true }).count(), 1);
  assert.ok(await page.locator('.day-choice').count() >= 2);
  assert.match(page.url(), /date=\d{4}-\d{2}-\d{2}/, 'Invalid date safely falls back to Today');
  assert.equal(blockedFirebaseRequests.length, 0, 'Demo view must not load Firebase');

  const futureChoice = page.locator('.day-choice').filter({ hasNotText: 'Today' }).first();
  await futureChoice.click();
  await page.locator('.board').waitFor();
  assert.equal(await page.locator('.current-time').count(), 0, 'Future dates do not show a current-time marker');
  assert.match(await page.locator('.time-ruler').innerText(), /11:00 PM/, 'The timeline runs through 11 PM');
  assert.equal(await page.locator('section[aria-label="Study Rooms"]').count(), 1);
  assert.equal(await page.locator('section[aria-label="Whiteboards"]').count(), 1);
  assert.equal(await page.locator('section[aria-label="TVs"]').count(), 1);
  assert.match(await page.locator('.board').innerText(), /Requested — awaiting approval/);
  assert.equal(await page.locator('.booking[aria-label*="Anthony L."]').count(), 1, 'TV names use first name and last initial');
  assert.equal(await page.locator('text=Anthony Lovelace').count(), 0, 'TV never exposes a full name');
  assert.match(page.url(), /date=\d{4}-\d{2}-\d{2}/, 'Changing days creates a shareable link');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true, '720p board stays on one screen');

  await page.setViewportSize({ width: 1920, height: 1080 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('TV demo/date selector smoke checks passed');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
