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

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=1&test=1`, { waitUntil: 'networkidle' });
  const origin = page.locator('.home-open-cell[data-start="10:30"]').first();
  assert.equal(await origin.count(), 1, 'The demo provides an open reservation start cell');
  await origin.click();
  await page.getByRole('button', { name: /End at 11:00 AM/ }).click();

  const bar = page.locator('.home-selection-summary');
  assert.equal(await bar.evaluate(node => getComputedStyle(node).position), 'fixed', 'The selected range bar stays attached to the viewport');
  const beforeScroll = await bar.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: window.innerHeight };
  });
  assert.ok(beforeScroll.top >= 0 && beforeScroll.bottom <= beforeScroll.viewport, 'The selected range bar fits fully inside the phone viewport');
  assert.ok(await bar.getByRole('button', { name: 'Clear' }).isVisible());
  assert.ok(await bar.getByRole('button', { name: 'Continue' }).isVisible());

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const afterScroll = await bar.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: window.innerHeight };
  });
  assert.deepEqual(afterScroll, beforeScroll, 'Scrolling the viewing screen does not move the selected range bar off-screen');
  assert.ok(await bar.getByRole('button', { name: 'Clear' }).isVisible());
  assert.ok(await bar.getByRole('button', { name: 'Continue' }).isVisible());

  await page.setViewportSize({ width: 1280, height: 720 });
  const desktop = await bar.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { position: getComputedStyle(node).position, top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
  });
  assert.equal(desktop.position, 'fixed', 'The selected range bar stays attached to the desktop viewport');
  assert.ok(desktop.top >= 0 && desktop.bottom <= desktop.viewport, 'The selected range bar also fits fully inside the desktop viewport');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log('selection bar smoke: passed');
