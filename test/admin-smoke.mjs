/* Behaviour smoke for the standalone Admin page at /admin/.
 *
 * Everything here is fictional: fictional names, a fictional PIN, and a
 * fake Firebase module set served by Playwright routing. No production
 * data, no real credential, and no network call ever leaves the machine.
 *
 * The static server deliberately refuses app.js, styles.css, tokens.css,
 * design-choice.js/css and special-schedule-entry.js, which proves /admin/
 * still works once the integration lane deletes them.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = normalize(new URL('..', import.meta.url).pathname);
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
/* The files the integration lane will delete. Serving 404 for them here is
   the proof that the Admin page never depends on them. */
const RETIRED_PATHS = ['/app.js', '/styles.css', '/tokens.css', '/design-choice.js', '/design-choice.css', '/special-schedule-entry.js'];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (RETIRED_PATHS.includes(url.pathname)) {
      response.writeHead(404);
      response.end('Retired by Plan 5');
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = normalize(join(root, relative.endsWith('/') ? relative + 'index.html' : relative));
    if (!file.startsWith(root)) throw new Error('Invalid path');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });

const FIXTURE_PIN = '2468';

/* The mocked callable layer. It mirrors the real backend closely enough to
   exercise every Admin write path, and records every call for assertions. */
const FUNCTIONS_MODULE = `
export const getFunctions = () => ({});
export const httpsCallable = (functions, name) => {
  // Readiness signal for the smoke: the page wires every callable it needs
  // before it can talk to the backend at all.
  window.__wiredCallables = (window.__wiredCallables || []).concat(name);
  return async (payload) => {
  const store = window.__adminStore;
  const data = payload || {};
  window.__calls.push({ name, payload: JSON.parse(JSON.stringify(data)) });
  await new Promise(resolve => setTimeout(resolve, 10));
  const fail = (code, message) => { const error = new Error(message); error.code = 'functions/' + code; throw error; };
  if (store.failNext && store.failNext.name === name && (!store.failNext.action || store.failNext.action === data.action)) {
    store.failNext = null;
    fail('failed-precondition', 'That booking changed. Please reload and try again.');
  }
  if (name === 'adminStartSession') {
    if (data.pin !== store.pin) fail('permission-denied', 'Incorrect Admin PIN.');
    store.token = 'fixture-admin-token';
    return { data: { sessionToken: store.token, expiresAt: Date.now() + store.sessionMs } };
  }
  if (!store.token || data.sessionToken !== store.token) fail('permission-denied', 'Admin session expired.');
  if (name === 'adminEndSession') { store.token = null; return { data: { locked: true } }; }
  if (name === 'adminSchedule') return { data: { bookings: store.bookings.map(b => JSON.parse(JSON.stringify(b))) } };
  if (name === 'adminMigrateNotes') return { data: { done: true } };
  if (name === 'adminNoteAction') {
    if (data.action === 'get-many') {
      return { data: { notes: (data.bookingIds || []).map(id => ({ bookingId: id, note: store.notes[id] || '' })) } };
    }
    fail('invalid-argument', 'Unknown note action.');
  }
  if (name === 'adminBookingAction') {
    const find = id => store.bookings.find(b => b.id === id);
    if (data.action === 'retire-baptism-room') return { data: { done: true } };
    if (data.action === 'cleanup') {
      const before = store.bookings.length;
      store.bookings = store.bookings.filter(b => b.date >= store.cleanupCutoff);
      return { data: { removed: before - store.bookings.length, more: false } };
    }
    if (data.action === 'approve' || data.action === 'reapprove') {
      const booking = find(data.bookingId);
      if (!booking) fail('failed-precondition', 'That booking no longer exists.');
      booking.status = 'approved';
      booking.assignments = data.assignments;
      return { data: { bookingId: booking.id, status: 'approved' } };
    }
    if (data.action === 'decline' || data.action === 'cancel') {
      const booking = find(data.bookingId);
      if (!booking) fail('failed-precondition', 'That booking no longer exists.');
      booking.status = data.action === 'decline' ? 'declined' : 'cancelled';
      return { data: { bookingId: booking.id, status: booking.status } };
    }
    if (data.action === 'end-early') {
      const booking = find(data.bookingId);
      if (!booking) fail('failed-precondition', 'That booking no longer exists.');
      booking.endedEarlyFrom = booking.end;
      booking.end = data.end;
      return { data: { bookingId: booking.id, end: data.end } };
    }
    if (data.action === 'direct-add') {
      const id = 'fx-added-' + (store.bookings.length + 1);
      store.bookings.push(Object.assign({ id }, data.booking));
      if (data.note) store.notes[id] = data.note;
      return { data: { bookingId: id, status: 'approved' } };
    }
    fail('invalid-argument', 'Unknown Admin action.');
  }
  fail('invalid-argument', 'Unexpected callable ' + name);
  };
};
`;

async function openAdmin({ store, fixedTime, viewport = { width: 1280, height: 900 } }) {
  const context = await browser.newContext({ viewport, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
  await context.addInitScript(fixture => {
    window.__calls = [];
    window.__adminStore = fixture;
  }, store);
  await context.route('**/firebasejs/*/firebase-*.js', route => {
    const part = route.request().url().split('firebase-').pop();
    let body = '';
    if (part === 'app.js') body = 'export const initializeApp = () => ({});';
    if (part === 'auth.js') body = "export const getAuth = () => ({ currentUser: { uid: 'fixture-admin-device' } }); export const signInAnonymously = async () => ({});";
    if (part === 'functions.js') body = FUNCTIONS_MODULE;
    return route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  const dialogs = [];
  const requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  if (fixedTime) await page.clock.setFixedTime(new Date(fixedTime));
  await page.goto(base + '/admin/');
  return { context, page, errors, dialogs, requested };
}

function calls(page, name, action) {
  return page.evaluate(([callName, callAction]) => window.__calls.filter(call =>
    call.name === callName && (!callAction || call.payload.action === callAction)), [name, action]);
}

/* The PIN form is live before the Firebase modules finish loading, exactly as
   it is today in app.js, so wait for the secure connection to be wired before
   typing. See the completion note about this. */
async function unlock(page, pin = FIXTURE_PIN) {
  await page.waitForFunction(() => (window.__wiredCallables || []).includes('adminStartSession'));
  await page.locator('#admin-pin-input').fill(pin);
  await page.locator('.pin-row button[type=submit]').click();
}

/* Unlocking runs two schedule reads, two migrations and a note load. Wait for
   that burst to finish before driving the page, so a click never lands mid
   re-render. */
async function settle(page) {
  let previous = -1;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const count = await page.evaluate(() => window.__calls.length);
    if (count === previous) return;
    previous = count;
    await page.waitForTimeout(150);
  }
}

const base0 = Date.UTC(2026, 8, 19, 17, 0, 0);
function coreStore() {
  return {
    pin: FIXTURE_PIN,
    token: null,
    sessionMs: 3600000,
    cleanupCutoff: '2026-08-01',
    notes: { 'fx-pending-contact': 'Fixture private note' },
    failNext: null,
    bookings: [
      { id: 'fx-pending-contact', date: '2026-09-19', start: '11:00', end: '12:00', name: 'Robin Fixture', purpose: 'contact', purposeOther: '', reservedFor: 'Fixture contact', certainty: 'confirmed', status: 'pending', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: base0 - 1000 },
      { id: 'fx-pending-other-early', date: '2026-09-19', start: '12:00', end: '12:30', name: 'Jules Fixture', purpose: 'other', purposeOther: 'Fixture catch up', status: 'pending', needs: { room: false, whiteboard: false, tv: true }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: base0 - 3000 },
      { id: 'fx-pending-other-late', date: '2026-09-19', start: '13:00', end: '13:30', name: 'Sam Fixture', purpose: 'other', purposeOther: 'Fixture review', status: 'pending', needs: { room: false, whiteboard: true, tv: false }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: base0 - 500 },
      { id: 'fx-approved-room', date: '2026-09-19', start: '11:00', end: '13:00', name: 'Ada Fixture', purpose: 'new-member', purposeOther: '', reservedFor: 'Fixture member', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-2', whiteboard: null, tv: null }, createdAt: base0 - 9000, decidedAt: base0 - 8000 },
      { id: 'fx-cancelled-wb', date: '2026-09-19', start: '16:00', end: '16:30', name: 'Nia Fixture', purpose: 'other', purposeOther: 'Fixture study', status: 'cancelled', needs: { room: false, whiteboard: true, tv: false }, assignments: { room: null, whiteboard: null, tv: null }, createdAt: base0 - 20000 },
      { id: 'fx-special-room', date: '2026-09-21', start: '16:00', end: '17:00', name: 'Eli Fixture', purpose: 'contact', purposeOther: '', reservedFor: 'Fixture special contact', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: base0 - 30000, decidedAt: base0 - 29000 },
      { id: 'fx-old-room', date: '2026-05-02', start: '11:00', end: '11:30', name: 'Old Fixture', purpose: 'other', purposeOther: 'Fixture archive', status: 'approved', needs: { room: true, whiteboard: false, tv: false }, assignments: { room: 'room-1', whiteboard: null, tv: null }, createdAt: base0 - 9000000 }
    ]
  };
}

const passed = [];
function step(label) { passed.push(label); }

/* =====================================================================
   1. Core Admin journey: lock, unlock, day list, queue, reassign,
      approve, decline, re-approve, add, cancel with a failed write,
      end early, housekeeping, lock again.
   ===================================================================== */
{
  const { context, page, errors, dialogs, requested } = await openAdmin({ store: coreStore(), fixedTime: '2026-09-19T19:00:00Z' });
  try {
    // ---- locked ----
    await page.locator('.lock-title').waitFor();
    assert.equal(await page.locator('.lock-title').innerText(), 'Admin is locked');
    assert.equal(await page.locator('.admin-workspace').count(), 0, 'Nothing protected renders while locked');
    assert.equal(await page.evaluate(() => window.__calls.length), 0, 'A locked page reads no schedule');
    step('locked page shows only the PIN gate and reads nothing');

    // ---- wrong PIN ----
    await unlock(page, '0000');
    await page.locator('.pin-error').waitFor();
    assert.equal(await page.locator('.pin-error').innerText(), 'Incorrect Admin PIN.');
    assert.equal(await page.locator('.admin-workspace').count(), 0, 'A refused PIN stays locked');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('srs-admin-session')), null);
    step('a refused PIN reports the reason and stays locked');

    // ---- unlock ----
    await unlock(page);
    await page.locator('.admin-workspace').waitFor();
    await page.locator('.admin-queue-item').first().waitFor();
    await settle(page);
    const session = await page.evaluate(() => sessionStorage.getItem('srs-admin-session'));
    assert.ok(session.includes('fixture-admin-token'), 'The server session token is what is kept');
    assert.equal(session.includes(FIXTURE_PIN), false, 'The PIN itself is never stored');
    assert.equal((await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).includes('admin'), false, 'Nothing admin related is written to localStorage');
    assert.equal((await calls(page, 'adminSchedule')).every(call => call.payload.sessionToken === 'fixture-admin-token'), true);
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c.name === 'memberSchedule').length), 0, 'The Admin page never reads the member schedule');
    step('unlock starts a server session, keeps no credential, and reads the Admin schedule');

    // ---- migrations carried over ----
    assert.equal((await calls(page, 'adminBookingAction', 'retire-baptism-room')).length, 1, 'The Baptism Room migration still runs on unlock');
    assert.equal((await calls(page, 'adminMigrateNotes')).length, 1, 'The note migration still runs on unlock');
    step('Baptism Room and note migrations run on unlock');

    // ---- header, date selector, day list ----
    assert.equal(await page.locator('.date-current strong').innerText(), 'Saturday, September 19');
    assert.deepEqual(await page.locator('.admin-counts span').allInnerTexts(), ['3\nPending', '1\nApproved', '0\nIn line']);
    const dayList = page.locator('.card', { hasText: 'Bookings for' }).last();
    const listed = await dayList.locator('.req-head').allInnerTexts();
    assert.deepEqual(listed.map(text => text.replace(/\s+/g, ' ')), [
      'Robin Fixture Pending review',
      'Ada Fixture Approved',
      'Jules Fixture Pending review',
      'Sam Fixture Pending review',
      'Nia Fixture Cancelled'
    ], 'The day list is every booking for the day, in start-time order');
    assert.match(await dayList.innerText(), /Study room \u2014 Study Room 2/, 'Approved rows name the assigned unit');
    step('day list shows every booking for the selected day with its status and unit');

    // ---- queue ordering and private note ----
    assert.deepEqual((await page.locator('.admin-queue-item .admin-queue-name strong').allInnerTexts()), ['Robin Fixture', 'Jules Fixture', 'Sam Fixture'],
      'The queue puts Contact first, then Other by request time');
    // The queue rank label is styled uppercase, so compare without case.
    assert.deepEqual((await page.locator('.admin-priority').allInnerTexts()).map(text => text.toLowerCase()),
      ['1 · contact', '2 · other', '3 · other']);
    assert.equal(await page.locator('.admin-selected-card h2').innerText(), 'Robin Fixture', 'The highest priority request is selected by default');
    assert.equal(await page.locator('.private-note').innerText(), 'Private note: Fixture private note', 'The private note for the selected request is loaded and shown');
    assert.equal((await calls(page, 'adminNoteAction', 'get-many')).length >= 1, true);
    step('priority queue order and the loaded private note');

    // ---- selecting another request ----
    await page.locator('.admin-queue-item', { hasText: 'Jules Fixture' }).click();
    assert.equal(await page.locator('.admin-selected-card h2').innerText(), 'Jules Fixture');
    assert.equal(await page.locator('.member-resource[aria-pressed="true"]').innerText(), 'TV', 'Selecting a request follows its resource into the day map');
    await page.locator('.admin-queue-item', { hasText: 'Robin Fixture' }).click();
    assert.equal(await page.locator('.admin-selected-card h2').innerText(), 'Robin Fixture');
    step('selecting a queued request switches the detail pane and the day map');

    // ---- recommendation, reassignment, approve ----
    const selected = page.locator('.admin-selected-card');
    assert.match(await selected.innerText(), /Study Room 1 · Recommended/, 'The first free room is recommended');
    assert.match(await selected.innerText(), /Study Room 2 \u2014 Ada Fixture/, 'A taken room names its occupant');
    assert.equal(await selected.locator('[data-act="admin-assign"][data-id="room-2"]').count(), 0, 'A taken room cannot be assigned');
    assert.equal(await selected.locator('.unit-pill[aria-pressed="true"]').innerText(), 'Study Room 1 · Recommended');
    await selected.locator('[data-act="admin-assign"][data-type="room"][data-id="room-3"]').click();
    assert.match(await selected.locator('.unit-pill[aria-pressed="true"]').innerText(), /^Study Room 3/, 'Reassignment moves the selection to another free room');
    await selected.locator('[data-act="admin-approve"]').click();
    await page.waitForFunction(() => window.__calls.some(c => c.name === 'adminBookingAction' && c.payload.action === 'approve'));
    assert.deepEqual((await calls(page, 'adminBookingAction', 'approve'))[0].payload, {
      sessionToken: 'fixture-admin-token', action: 'approve', bookingId: 'fx-pending-contact',
      assignments: { room: 'room-3', whiteboard: null, tv: null }
    }, 'Approve sends the reassigned unit');
    step('recommendation, reassignment to another unit, and approve');

    // ---- decline ----
    await dayList.locator('[data-act="admin-decline"][data-id="fx-pending-other-early"]').click();
    await page.waitForFunction(() => window.__calls.some(c => c.name === 'adminBookingAction' && c.payload.action === 'decline'));
    assert.deepEqual((await calls(page, 'adminBookingAction', 'decline'))[0].payload,
      { sessionToken: 'fixture-admin-token', action: 'decline', bookingId: 'fx-pending-other-early' });
    step('decline');

    // ---- re-approve a cancelled booking ----
    await dayList.locator('[data-act="admin-reapprove-start"][data-id="fx-cancelled-wb"]').click();
    const reapproveRow = dayList.locator('.req-row', { hasText: 'Nia Fixture' });
    await reapproveRow.locator('.assign-ui').waitFor();
    assert.match(await reapproveRow.locator('.unit-pill[aria-pressed="true"]').innerText(), /^Whiteboard 1/);
    await reapproveRow.locator('[data-act="admin-approve"]').click();
    await page.waitForFunction(() => window.__calls.some(c => c.name === 'adminBookingAction' && c.payload.action === 'reapprove'));
    assert.deepEqual((await calls(page, 'adminBookingAction', 'reapprove'))[0].payload, {
      sessionToken: 'fixture-admin-token', action: 'reapprove', bookingId: 'fx-cancelled-wb',
      assignments: { room: null, whiteboard: 'wb-1', tv: null }
    });
    await dayList.locator('[data-act="admin-reapprove-cancel"]').waitFor({ state: 'detached' });
    assert.equal(await dayList.locator('[data-act="admin-reapprove-cancel"]').count(), 0, 'The re-approve form closes after saving');
    step('re-approve a cancelled booking');

    // ---- add a booking, including the private note ----
    const addCard = page.locator('.card', { hasText: 'Add a booking' });
    await addCard.locator('#af-name').fill('Pat Fixture');
    await addCard.locator('[data-act="af-need"][data-id="room"]').click();
    await addCard.locator('#af-start-0').selectOption('13:00');
    await addCard.locator('#af-end-0').selectOption('14:00');
    assert.match(await addCard.locator('.selection-summary').innerText(), /Selected: 1:00 PM \u2013 2:00 PM/);
    await addCard.locator('[data-act="af-assign"][data-type="room"][data-id="room-2"]').click();
    await addCard.locator('#af-note').fill('Fixture add note');
    await addCard.locator('button[type=submit]').click();
    await page.locator('.banner', { hasText: 'Booking added and approved for Pat Fixture.' }).waitFor();
    const added = (await calls(page, 'adminBookingAction', 'direct-add'))[0].payload;
    assert.equal(added.note, 'Fixture add note', 'The add form saves its private note');
    assert.deepEqual(added.booking, {
      date: '2026-09-19', start: '13:00', end: '14:00', name: 'Pat Fixture',
      needs: { room: true, whiteboard: false, tv: false }, preferredRoom: null,
      purpose: 'contact', purposeOther: '', certainty: 'confirmed', status: 'approved',
      assignments: { room: 'room-2', whiteboard: null, tv: null }
    });
    assert.equal(await page.evaluate(() => Object.values(window.__adminStore.notes).includes('Fixture add note')), true,
      'The new booking reaches the backend with its private note attached');
    step('add a booking with an assignment, purpose and private note');

    // ---- cancel: first write fails, the page recovers, the retry saves ----
    await page.evaluate(() => { window.__adminStore.failNext = { name: 'adminBookingAction', action: 'cancel' }; });
    await dayList.locator('[data-act="admin-cancel"][data-id="fx-approved-room"]').click();
    await page.waitForFunction(() => window.__calls.some(c => c.name === 'adminBookingAction' && c.payload.action === 'cancel'));
    await page.locator('.banner.error').last().waitFor();
    assert.match((await page.locator('.banner.error').allInnerTexts()).join(' | '), /That booking changed\. Please reload and try again\./);
    assert.equal(await page.evaluate(() => window.__adminStore.bookings.find(b => b.id === 'fx-approved-room').status), 'approved', 'A failed write changes nothing');
    assert.equal(await dayList.locator('[data-act="admin-cancel"][data-id="fx-approved-room"]').isEnabled(), true, 'The action is live again after a failed write');
    await dayList.locator('[data-act="admin-cancel"][data-id="fx-approved-room"]').click();
    await page.waitForFunction(() => window.__adminStore.bookings.find(b => b.id === 'fx-approved-room').status === 'cancelled');
    assert.equal((await calls(page, 'adminBookingAction', 'cancel')).length, 2, 'The retry is a second write, not a silent no-op');
    assert.equal(dialogs.filter(text => text === 'Cancel the approved booking for Ada Fixture?').length, 2, 'Cancelling always confirms first');
    step('cancel confirms first, survives a failed write, and the retry saves');

    // ---- end early ----
    await dayList.locator('[data-act="admin-end-early"][data-id="fx-approved-room"]').click();
    const sheet = page.locator('.end-time-dialog');
    await sheet.waitFor();
    assert.match(await sheet.innerText(), /Finished early\?/);
    assert.equal(await page.locator('.admin-workspace').evaluate(node => node.inert), true, 'The workspace is inert behind the ending sheet');
    assert.deepEqual(await sheet.locator('.end-time-choice strong').allInnerTexts(),
      ['End at 11:30 AM', 'End at 12:00 PM · now', 'End at 12:30 PM'],
      'Every earlier 30 minute ending is offered and the Los Angeles "now" boundary is marked');
    await sheet.getByText('End at 11:30 AM').click();
    await page.waitForFunction(() => window.__calls.some(c => c.name === 'adminBookingAction' && c.payload.action === 'end-early'));
    assert.deepEqual((await calls(page, 'adminBookingAction', 'end-early'))[0].payload,
      { sessionToken: 'fixture-admin-token', action: 'end-early', bookingId: 'fx-approved-room', end: '11:30' });
    await page.locator('.end-time-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.end-time-dialog').count(), 0, 'Saving closes the ending sheet');
    assert.match((await page.locator('.banner').allInnerTexts()).join(' | '), /Ada Fixture’s reservation now ends at 11:30 AM\./);
    step('end early offers every earlier boundary, marks now, and saves');

    // ---- housekeeping ----
    await page.locator('[data-act="admin-cleanup"]').click();
    await page.locator('.banner', { hasText: 'Removed 1 old booking.' }).waitFor();
    assert.equal(dialogs.includes('Delete old booking records? This cannot be undone.'), true);
    assert.equal((await calls(page, 'adminBookingAction', 'cleanup')).length, 1);
    assert.equal(await page.evaluate(() => window.__adminStore.bookings.some(b => b.id === 'fx-old-room')), false);
    step('housekeeping removes records older than eight weeks after confirming');

    // ---- narrow viewport ----
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal scroll at 390px');
    await page.setViewportSize({ width: 1280, height: 900 });
    step('no horizontal overflow at 390px');

    // ---- lock again ----
    await page.locator('[data-act="admin-lock"]').click();
    await page.locator('.lock-title').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('srs-admin-session')), null);
    assert.equal(await page.locator('.admin-workspace').count(), 0);
    await page.waitForFunction(() => window.__adminStore.token === null);
    assert.equal((await calls(page, 'adminEndSession'))[0].payload.sessionToken, 'fixture-admin-token',
      'Locking ends the server session, it is not just forgotten locally');
    step('lock again ends the server session and clears the page');

    // ---- standalone proof ----
    // Snapshot first: the probe fetches below are expected to 404, which the
    // browser logs as console errors.
    const errorsBeforeProbe = errors.slice();
    assert.deepEqual(errorsBeforeProbe, [], errorsBeforeProbe.join(' | '));
    for (const path of RETIRED_PATHS) {
      assert.equal(requested.includes(path), false, 'The Admin page never requested ' + path);
      const status = await page.evaluate(url => fetch(url).then(response => response.status), base + path);
      assert.equal(status, 404, path + ' is refused by the test server');
    }
    step('the page loads and works with app.js, styles.css and tokens.css absent');
  } finally {
    await context.close();
  }
}

/* =====================================================================
   2. September 21 special schedule, inside its window.
   ===================================================================== */
{
  const { context, page, errors } = await openAdmin({ store: coreStore(), fixedTime: '2026-09-19T19:00:00Z' });
  try {
    await unlock(page);
    await page.locator('.admin-workspace').waitFor();
    await page.locator('.admin-queue-item').first().waitFor();
    await settle(page);

    await page.locator('[data-act="date-step"][data-id="1"]').click();
    assert.equal(await page.locator('.date-current strong').innerText(), 'Monday, September 21',
      'The September 21 special day is offered between the usual Tuesday and Saturday');
    const services = await page.locator('.member-service').allInnerTexts();
    assert.equal(services.length, 2, 'The special day holds two services, not three');
    assert.match(services[0], /Morning service/);
    assert.match(services[1], /Afternoon service/);
    assert.equal(services.join(' ').includes('Evening service'), false, 'The special day has no evening service band');

    const dayList = page.locator('.card', { hasText: 'Bookings for' }).last();
    assert.deepEqual((await dayList.locator('.req-head').allInnerTexts()).map(text => text.replace(/\s+/g, ' ')), ['Eli Fixture Approved']);

    const addCard = page.locator('.card', { hasText: 'Add a booking' });
    const periods = await addCard.locator('.time-period > summary strong').allInnerTexts();
    assert.deepEqual(periods, ['Late morning and early afternoon', 'Afternoon and evening'],
      'The special day exposes its own two booking windows');
    assert.match(await addCard.locator('.time-period').nth(1).innerText(), /Start times 3:30 PM\u201310:30 PM/,
      'The special day evening window runs to 11:00 PM');

    await addCard.locator('#af-name').fill('Noor Fixture');
    await addCard.locator('[data-act="af-need"][data-id="room"]').click();
    await addCard.locator('.time-period').nth(1).locator('summary').click();
    await addCard.locator('#af-start-1').selectOption('20:00');
    await addCard.locator('#af-end-1').selectOption('21:00');
    await addCard.locator('[data-act="af-assign"][data-type="room"][data-id="room-1"]').click();
    await addCard.locator('button[type=submit]').click();
    await page.waitForFunction(() => window.__calls.some(c => c.name === 'adminBookingAction' && c.payload.action === 'direct-add'));
    const added = (await calls(page, 'adminBookingAction', 'direct-add'))[0].payload.booking;
    assert.equal(added.date, '2026-09-21');
    assert.equal(added.start, '20:00');
    assert.equal(added.end, '21:00');
    assert.deepEqual(errors, [], errors.join(' | '));
    step('September 21 special day: offered, correct service bands, day list and add form all work');
  } finally {
    await context.close();
  }
}

/* =====================================================================
   3. Outside the September 21 window: Tuesday and Saturday only.
   ===================================================================== */
{
  const store = coreStore();
  store.bookings = [];
  const { context, page, errors } = await openAdmin({ store, fixedTime: '2026-10-06T19:00:00Z' });
  try {
    await unlock(page);
    await page.locator('.admin-workspace').waitFor();
    await settle(page);
    assert.equal(await page.locator('.date-current strong').innerText(), 'Tuesday, October 6');
    assert.equal(await page.locator('[data-act="date-step"][data-id="-1"]').isDisabled(), true);
    await page.locator('[data-act="date-step"][data-id="1"]').click();
    assert.equal(await page.locator('.date-current strong').innerText(), 'Saturday, October 10');
    assert.equal(await page.locator('[data-act="date-step"][data-id="1"]').isDisabled(), true,
      'Only two dates are offered once the September 21 window has passed');
    assert.equal((await page.locator('.member-service').allInnerTexts()).length, 3, 'A normal Saturday keeps its three services');
    assert.deepEqual(errors, [], errors.join(' | '));
    step('outside the special window only the upcoming Tuesday and Saturday are offered');
  } finally {
    await context.close();
  }
}

/* =====================================================================
   4. Session expiry, and relock when the server refuses the session.
   ===================================================================== */
{
  const store = coreStore();
  store.sessionMs = 1200;
  const { context, page, errors } = await openAdmin({ store, fixedTime: null });
  try {
    await unlock(page);
    await page.locator('.admin-workspace').waitFor();
    await page.locator('.lock-title').waitFor({ timeout: 8000 });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('srs-admin-session')), null,
      'A short session locks itself when it expires');
    assert.equal(await page.locator('.admin-workspace').count(), 0);
    step('an expiring session locks the workspace on its own');
  } finally {
    await context.close();
  }
}
{
  const { context, page, errors } = await openAdmin({ store: coreStore(), fixedTime: '2026-09-19T19:00:00Z' });
  try {
    await unlock(page);
    await page.locator('.admin-workspace').waitFor();
    await page.locator('.admin-queue-item').first().waitFor();
    await settle(page);
    // The server rotates or drops the session while the page is open.
    await page.evaluate(() => { window.__adminStore.token = 'rotated-elsewhere'; });
    await page.locator('[data-act="date-step"][data-id="1"]').click();
    await page.locator('.lock-title').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('srs-admin-session')), null,
      'A refused session relocks the page instead of showing stale Admin data');
    assert.match((await page.locator('.banner.error').allInnerTexts()).join(' | '), /Admin session expired\./);
    assert.deepEqual(errors, [], errors.join(' | '));
    step('a session the server refuses relocks the page and says why');
  } finally {
    await context.close();
  }
}

await browser.close();
await new Promise(resolve => server.close(resolve));
console.log('Admin page smoke checks passed:');
passed.forEach((label, index) => console.log('  ' + (index + 1) + '. ' + label));
