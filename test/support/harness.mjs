// Shared setup for the browser tests: a static server for public/, a headless
// browser, and a fake Firebase. Nothing here reaches the real backend; every
// name and PIN is fictional.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = normalize(new URL('../../public/', import.meta.url).pathname);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

export async function start() {
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
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

export async function newPage(browser, { width = 390, height = 844, backend = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  if (backend) await fakeFirebase(context, backend);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}

export const lastCall = (page, name) => page.evaluate(callable => window.__calls.filter(call => call.name === callable).at(-1), name);

export const fitsWidth = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
