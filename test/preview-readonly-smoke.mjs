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
const page = await browser.newPage();
const writeRequests = [];

page.on('request', request => {
  const url = request.url();
  if (/cloudfunctions\.net|firestore\.googleapis\.com.*(?:commit|write)/i.test(url)) {
    writeRequests.push(url);
  }
});

try {
  await page.goto(`http://127.0.0.1:${port}/?demo=1&test=1`, { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.LV_ROOMS_DESIGN_PREVIEW = { readOnly: false };
  });

  const result = await page.evaluate(() => window.__SRS_TEST_HELPERS__.previewMutationBlocked());
  assert.deepEqual(result, {
    blocked: true,
    code: 'functions/permission-denied',
    message: 'Design preview is read only. No live data was changed.'
  });

  const cancellation = await page.evaluate(() => window.__SRS_TEST_HELPERS__.previewCancellationBlocked());
  assert.match(cancellation, /Design preview is read only/);
  assert.equal(writeRequests.length, 0, 'Preview actions make no backend write requests');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log('preview read-only smoke: passed');
