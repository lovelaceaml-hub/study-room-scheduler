/* Behavior tests for the entry script that routes every visit to one of the
   six designs. The script is served exactly as it ships; every other request
   is answered with a minimal host page, so no app or design code runs here. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const script = await readFile(resolve(root, 'design-choice.js'), 'utf8');
const styles = await readFile(resolve(root, 'design-choice.css'), 'utf8');
const origin = 'http://study-rooms.test';
const host = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Entry</title></head><body><header class="head-in"><span>LV Zion Study Rooms</span></header><script src="/design-choice.js"></script></body></html>';
const STORE = 'srs-design-v1';

let browser;
before(async () => {browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close();});

async function visit(path, {stored = null, width = 390} = {}) {
  const context = await browser.newContext({viewport: {width, height: 844}, serviceWorkers: 'block', reducedMotion: 'reduce'});
  await context.addInitScript(() => {
    window.__registered = [];
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {register: (url) => {window.__registered.push(url); return Promise.resolve({scope: '/'});}}
    });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/design-choice.js') return route.fulfill({contentType: 'text/javascript', body: script});
    if (url.pathname === '/design-choice.css') return route.fulfill({contentType: 'text/css', body: styles});
    return route.fulfill({contentType: 'text/html', body: host});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // The lobby TV page is the one place the script returns immediately, so it
  // is a side-effect free place to seed a remembered choice.
  await page.goto(`${origin}/tv.html`, {waitUntil: 'load'});
  if (stored !== null) await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORE, stored]);
  await page.goto(origin + path, {waitUntil: 'commit'});
  return {
    context, page, errors,
    picker: page.locator('dialog.design-picker[open]'),
    settled: async () => {await page.waitForLoadState('load'); return page.url();},
    stored: () => page.evaluate(key => localStorage.getItem(key), STORE),
    registered: () => page.evaluate(() => window.__registered)
  };
}

test('a first visit offers the six designs with Solace marked and focused as the default', async () => {
  const visitor = await visit('/');
  await visitor.picker.waitFor();
  assert.deepEqual(await visitor.page.locator('[data-design]').evaluateAll(nodes => nodes.map(node => node.dataset.design)),
    ['solace', 'velum', 'cove', 'petal', 'atlas', 'lattice']);
  assert.equal(await visitor.page.locator('[data-design="solace"] .dp-default').textContent(), 'Default');
  assert.equal(await visitor.page.evaluate(() => document.activeElement?.dataset?.design), 'solace');
  // Seven controls: the six designs and the close button. Nothing keeps the old app.
  assert.equal(await visitor.page.locator('dialog.design-picker button').count(), 7);
  assert.equal(await visitor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await visitor.stored(), null);
  assert.deepEqual(visitor.errors, []);
  await visitor.context.close();
});

test('the picker fits a 320px phone', async () => {
  const visitor = await visit('/', {width: 320});
  await visitor.picker.waitFor();
  assert.equal(await visitor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await visitor.context.close();
});

test('choosing a design remembers it and opens that design', async () => {
  const visitor = await visit('/');
  await visitor.picker.waitFor();
  await visitor.page.locator('[data-design="velum"]').click();
  await visitor.page.waitForURL(`${origin}/experiences/velum/`);
  assert.equal(await visitor.stored(), 'velum');
  await visitor.context.close();
});

test('a remembered design opens straight away, with no picker', async () => {
  const visitor = await visit('/', {stored: 'petal'});
  await visitor.page.waitForURL(`${origin}/experiences/petal/`);
  assert.equal(await visitor.picker.count(), 0);
  assert.equal(await visitor.stored(), 'petal');
  await visitor.context.close();
});

test('a stored classic choice counts as no choice', async () => {
  const visitor = await visit('/', {stored: 'classic'});
  await visitor.picker.waitFor();
  await visitor.page.locator('[data-design="cove"]').click();
  await visitor.page.waitForURL(`${origin}/experiences/cove/`);
  assert.equal(await visitor.stored(), 'cove');
  await visitor.context.close();
});

test('closing the picker selects Solace', async () => {
  const visitor = await visit('/');
  await visitor.picker.waitFor();
  await visitor.page.locator('.dp-close').click();
  await visitor.page.waitForURL(`${origin}/experiences/solace/`);
  assert.equal(await visitor.stored(), 'solace');
  await visitor.context.close();
});

test('Escape selects Solace', async () => {
  const visitor = await visit('/');
  await visitor.picker.waitFor();
  await visitor.page.keyboard.press('Escape');
  await visitor.page.waitForURL(`${origin}/experiences/solace/`);
  assert.equal(await visitor.stored(), 'solace');
  await visitor.context.close();
});

test('a click outside the picker selects Solace', async () => {
  const visitor = await visit('/');
  await visitor.picker.waitFor();
  await visitor.page.mouse.click(4, 4);
  await visitor.page.waitForURL(`${origin}/experiences/solace/`);
  assert.equal(await visitor.stored(), 'solace');
  await visitor.context.close();
});

test('choose=1 reopens the picker for someone who already chose', async () => {
  const visitor = await visit('/?choose=1', {stored: 'atlas'});
  await visitor.picker.waitFor();
  assert.equal(await visitor.stored(), 'atlas');
  await visitor.page.locator('[data-design="lattice"]').click();
  await visitor.page.waitForURL(`${origin}/experiences/lattice/`);
  assert.equal(await visitor.stored(), 'lattice');
  await visitor.context.close();
});

test('the old classic link forwards to the person design and never stores classic', async () => {
  const visitor = await visit('/?classic=1', {stored: 'cove'});
  await visitor.page.waitForURL(`${origin}/experiences/cove/`);
  assert.equal(await visitor.stored(), 'cove');
  await visitor.context.close();
});

test('the old My reservations link forwards to the person design with the mine view', async () => {
  const visitor = await visit('/?classic=1&tab=mine', {stored: 'velum'});
  await visitor.page.waitForURL(`${origin}/experiences/velum/?view=mine`);
  await visitor.context.close();
});

test('the old classic link with no stored choice shows the picker and carries the mine view', async () => {
  const visitor = await visit('/?classic=1&tab=mine');
  await visitor.picker.waitFor();
  await visitor.page.locator('[data-design="solace"]').click();
  await visitor.page.waitForURL(`${origin}/experiences/solace/?view=mine`);
  assert.equal(await visitor.stored(), 'solace');
  await visitor.context.close();
});

test('the old Admin tab forwards to the Admin page, with or without classic', async () => {
  const withClassic = await visit('/?classic=1&tab=admin', {stored: 'petal'});
  await withClassic.page.waitForURL(`${origin}/admin/`);
  await withClassic.context.close();
  const plain = await visit('/?tab=admin');
  await plain.page.waitForURL(`${origin}/admin/`);
  await plain.context.close();
});

test('the lobby TV link forwards to the TV page with its query and hash', async () => {
  const visitor = await visit('/?tv=1&demo=1#lobby');
  await visitor.page.waitForURL(`${origin}/tv.html?tv=1&demo=1#lobby`);
  assert.equal(await visitor.picker.count(), 0);
  await visitor.context.close();
});

test('the TV page itself is left alone', async () => {
  const visitor = await visit('/tv.html?tv=1');
  assert.equal(await visitor.settled(), `${origin}/tv.html?tv=1`);
  assert.equal(await visitor.picker.count(), 0);
  assert.deepEqual(await visitor.registered(), []);
  await visitor.context.close();
});

test('opening a design remembers it and adds no change-design button to the page', async () => {
  const visitor = await visit('/experiences/atlas/');
  assert.equal(await visitor.settled(), `${origin}/experiences/atlas/`);
  assert.equal(await visitor.stored(), 'atlas');
  assert.equal(await visitor.picker.count(), 0);
  assert.equal(await visitor.page.locator('.design-change-button').count(), 0);
  await visitor.context.close();
});

test('test=1 leaves a design page completely alone', async () => {
  const visitor = await visit('/experiences/atlas/?test=1');
  assert.equal(await visitor.settled(), `${origin}/experiences/atlas/?test=1`);
  assert.equal(await visitor.stored(), null);
  assert.equal(await visitor.picker.count(), 0);
  assert.deepEqual(await visitor.registered(), []);
  await visitor.context.close();
});

test('demo=1 offers the picker, carries demo into the design, and stores nothing', async () => {
  const visitor = await visit('/?demo=1', {stored: 'cove'});
  await visitor.picker.waitFor();
  await visitor.page.locator('[data-design="solace"]').click();
  await visitor.page.waitForURL(`${origin}/experiences/solace/?demo=1`);
  assert.equal(await visitor.stored(), 'cove');
  await visitor.context.close();
});

test('the shared service worker is registered from the root and from a design, but not under test=1', async () => {
  const entry = await visit('/');
  await entry.picker.waitFor();
  assert.deepEqual(await entry.registered(), ['/sw.js']);
  await entry.context.close();
  const design = await visit('/experiences/solace/');
  await design.settled();
  assert.deepEqual(await design.registered(), ['/sw.js']);
  await design.context.close();
  const testing = await visit('/?test=1');
  await testing.picker.waitFor();
  assert.deepEqual(await testing.registered(), []);
  await testing.context.close();
});
