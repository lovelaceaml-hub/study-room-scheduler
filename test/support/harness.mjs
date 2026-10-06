// Shared setup for the browser tests: a static server for public/, a headless
// browser, and a fake Firebase. Nothing here reaches the real backend; every
// name and PIN is fictional.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = normalize(new URL('../../public/', import.meta.url).pathname);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// The browser tests run on a fixed church-clock time, so they never depend on
// the weekday or the hour they happen to run at: Saturday, October 3, 2026,
// 9:00 AM in Los Angeles (before the 10:00 AM opening). On that clock the
// booking days are Saturday Oct 3 through Tuesday Oct 6.
export const TEST_NOW = new Date('2026-10-03T09:00:00-07:00');

export async function start() {
  // Launch the browser first, so a browser that cannot start fails the run
  // instead of leaving the file server holding the process open.
  const browser = await chromium.launch();
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
      if (!file.startsWith(root)) throw new Error('outside public/');
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  try {
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
  } catch (error) {
    await browser.close();
    throw error;
  }
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    browser,
    async stop() {
      await browser.close();
      server.close();
    }
  };
}

// Replaces the Firebase SDK with modules whose callables run
// `window.__backend(name, data)`, defined by each test page. Every call is
// recorded in `window.__calls`.
export async function fakeFirebase(context, backendSource) {
  await context.addInitScript(`window.__calls = []; window.__backend = ${backendSource};`);
  await context.route('**/firebasejs/**', route => {
    const file = route.request().url().split('/').pop();
    const modules = {
      'firebase-app.js': 'export const getApps = () => []; export const initializeApp = () => ({});',
      'firebase-auth.js': `export const getAuth = () => ({ currentUser: { uid: 'device-a' } });
        export const onAuthStateChanged = (auth, next) => { queueMicrotask(() => next(auth.currentUser)); return () => {}; };
        export const signInAnonymously = async () => {};`,
      'firebase-functions.js': `export const getFunctions = () => ({});
        export const httpsCallable = (functions, name) => async data => {
          window.__calls.push({ name, data });
          await new Promise(resolve => setTimeout(resolve, 30));
          try { return { data: await window.__backend(name, data) }; }
          catch (error) { throw Object.assign(new Error(error.message), { code: 'functions/' + error.code }); }
        };`
    };
    return route.fulfill({ contentType: 'text/javascript', body: modules[file] || '' });
  });
}

// `now` sets the page's clock (a Date, or null for the real clock). The clock
// keeps running from there; tests move it on with `page.clock.fastForward`.
export async function newPage(browser, { width = 390, height = 844, backend = null, now = TEST_NOW, timezoneId = 'America/Los_Angeles' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId });
  if (now) await context.clock.install({ time: now });
  if (backend) await fakeFirebase(context, backend);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}

export const lastCall = (page, name) => page.evaluate(callable => window.__calls.filter(call => call.name === callable).at(-1), name);

export const fitsWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
