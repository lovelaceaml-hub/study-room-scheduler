// Read-only headless load of a deployed preview. It fails when a page throws
// an uncaught error (or a rejected promise nobody handles), or when the page
// or one of its own scripts or stylesheets fails to load.
//
// It never clicks, types or submits anything, and it aborts every request
// that is not GET or HEAD before it leaves the browser, so it cannot write:
// previews use the same live data as production. Service workers are blocked
// so every request goes through that filter.
//
// Usage: node .github/scripts/preview-page-check.mjs <base URL> <path> [<path> ...]
import { chromium } from 'playwright';

const [base, ...paths] = process.argv.slice(2);
if (!base || !/^https?:\/\/[^/]+$/.test(base.replace(/\/$/, '')) || paths.length === 0) {
  console.error('usage: node preview-page-check.mjs <base URL> <path> [<path> ...]');
  process.exit(2);
}
const origin = new URL(base).origin;
const SETTLE_MS = 5000;
const short = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return String(u); } };

const browser = await chromium.launch();
let failures = 0;
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'GET' || method === 'HEAD') return route.continue();
    blocked.push(`${method} ${short(request.url())}`);
    return route.abort('blockedbyclient');
  });

  for (const path of paths) {
    const url = new URL(path, origin + '/').href;
    const page = await context.newPage();
    const pageErrors = [];
    const loadErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error?.message || String(error)));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const ownAsset = (request) => request.url().startsWith(origin + '/') && ['document', 'script', 'stylesheet'].includes(request.resourceType());
    page.on('requestfailed', (request) => {
      if (ownAsset(request) && request.method() === 'GET') loadErrors.push(`${short(request.url())} failed: ${request.failure()?.errorText}`);
    });
    page.on('response', (response) => {
      if (ownAsset(response.request()) && response.status() >= 400) loadErrors.push(`${short(response.url())} returned HTTP ${response.status()}`);
    });

    let status = 0;
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      status = response ? response.status() : 0;
    } catch (error) {
      loadErrors.push(`navigation failed: ${error.message.split('\n')[0]}`);
    }
    await page.waitForTimeout(SETTLE_MS);
    const finalUrl = page.url();
    await page.close();

    const problems = [...pageErrors.map((e) => `uncaught page error: ${e}`), ...loadErrors];
    if (status && (status < 200 || status >= 400)) problems.push(`page returned HTTP ${status}`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path} (HTTP ${status || 'none'}, ended at ${short(finalUrl)})`);
    for (const problem of problems) console.log(`::error::${path}: ${problem}`);
    for (const text of consoleErrors) console.log(`     console error (not counted): ${text.slice(0, 300)}`);
    failures += problems.length;
  }

  if (blocked.length) {
    console.log(`Blocked ${blocked.length} request(s) that could write (by design, nothing was sent):`);
    for (const line of [...new Set(blocked)]) console.log(`     ${line}`);
  } else {
    console.log('No request other than GET or HEAD was attempted.');
  }
  await context.close();
} finally {
  await browser.close();
}
if (failures) {
  console.log(`Headless load check failed: ${failures} problem(s).`);
  process.exit(1);
}
console.log(`Headless load check passed: ${paths.length} page(s), no uncaught page errors.`);
