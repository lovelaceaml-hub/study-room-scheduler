// Only loopback fixtures. Production checker is exercised as a subprocess.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertLobbySchedule } from '../.github/scripts/lobby-schedule-check.mjs';
const require = createRequire(import.meta.url);
const { lobbyView } = require('../functions/lib/views.js');
const { lobbyDates } = require('../functions/lib/schedule.js');
const fresh = (now = new Date()) => structuredClone(lobbyView([], lobbyDates(now), now));

test('schedule contract accepts closed days, empty bookings, DST and midnight boundaries', () => {
  for (const iso of ['2026-10-05T07:00:00Z', '2026-10-06T06:59:59Z', '2026-03-08T10:00:00Z', '2026-11-01T09:00:00Z']) {
    const now = new Date(iso);
    assertLobbySchedule(fresh(now), now.getTime() + 60000);
  }
});

for (const [name, change] of [
  ['stale timestamp', p => { p.generatedAt = new Date(Date.now() - 240000).toISOString(); }],
  ['future timestamp', p => { p.generatedAt = new Date(Date.now() + 120000).toISOString(); }],
  ['bad timestamp', p => { p.generatedAt = 'bad'; }],
  ['wrong version', p => { p.version = 2; }],
  ['missing rooms', p => { p.config.resources.room.units = []; }],
  ['wrong zone', p => { p.config.timeZone = 'UTC'; }],
  ['missing current day', p => { p.days = p.days.slice(1); }],
  ['missing bookings', p => { delete p.bookings; }],
  ['invalid booking', p => { p.bookings = [{ date: p.days[0].date, room: 'unknown', start: '10:00', end: '09:00', name: 'Fixture' }]; }],
]) test(`schedule contract rejects ${name}`, () => {
  const payload = fresh(); change(payload);
  assert.throws(() => assertLobbySchedule(payload), /lobby schedule:/);
});

async function fixtureCheck({ status = 200, payload = fresh(), body = null, api = true, script = '', path = '/tv.html', strict = true, realTV = false } = {}) {
  const received = [];
  const server = http.createServer(async (req, res) => {
    received.push({ method: req.method, path: req.url });
    if (req.url === '/bad.js') {
      res.writeHead(404).end('Missing fixture asset');
    } else if (req.url === '/api/lobby-schedule') {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(body ?? JSON.stringify(payload));
    } else if (realTV) {
      try {
        const file = new URL('../public' + new URL(req.url, 'http://localhost').pathname, import.meta.url);
        const type = file.pathname.endsWith('.js') ? 'text/javascript' : file.pathname.endsWith('.css') ? 'text/css' : 'text/html';
        res.writeHead(200, { 'Content-Type': type }).end(await readFile(file));
      } catch { res.writeHead(404).end('Missing fixture file'); }
    } else {
      // Rendering is deliberately independent of the response: API errors
      // must fail even when a page falsely presents itself as Live.
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<div id="connection" data-status="live"></div><div id="board"><p>No room schedule today</p></div><script>${api ? "fetch('/api/lobby-schedule').catch(()=>{});" : ''}${script}</script>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const args = ['.github/scripts/preview-page-check.mjs', `http://127.0.0.1:${server.address().port}`, path];
    if (strict) args.push('--require-lobby-schedule');
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.ok(received.every(request => ['GET', 'HEAD'].includes(request.method)), JSON.stringify(received));
    return { code, output, received };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('deployed-page checker accepts a fresh successful API without reservations', async () => {
  const result = await fixtureCheck();
  assert.equal(result.code, 0, result.output);
  assert.ok(result.received.some(request => request.path === '/api/lobby-schedule'));
});
for (const [name, options, message] of [
  ['API HTTP error', { status: 503 }, /expected GET HTTP 200/],
  ['invalid JSON', { body: '<html>not JSON</html>' }, /FAIL/],
  ['stale API', { payload: fresh(new Date(Date.now() - 240000)) }, /stale or in the future/],
  ['missing API', { api: false }, /did not request/],
  ['page exception', { script: "throw new Error('fixture exception')" }, /uncaught page error/],
  ['missing asset', { script: "const s = document.createElement('script'); s.src='/bad.js'; document.head.append(s);" }, /FAIL/],
]) test(`deployed-page checker rejects ${name}`, async () => {
  const result = await fixtureCheck(options);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, message);
});

test('checker blocks every mutation method and service workers before reaching server', async () => {
  const result = await fixtureCheck({ script: `
    for (const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) fetch('/mutation', {method, body: method === 'OPTIONS' ? undefined : 'fixture'}).catch(()=>{});
    navigator.sendBeacon('/beacon', 'fixture');
    navigator.serviceWorker.register('/worker.js').catch(()=>{});
  ` });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Blocked 6 request/);
  assert.ok(!result.received.some(request => ['/mutation', '/beacon', '/worker.js'].includes(request.path)), JSON.stringify(result.received));
});

test('existing preview checks still work without requiring schedule API', async () => {
  const result = await fixtureCheck({ path: '/', strict: false, api: false });
  assert.equal(result.code, 0, result.output);
});

test('checker verifies the real TV renders the actual lobby API contract', async () => {
  const result = await fixtureCheck({ realTV: true });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /No request other than GET or HEAD/);
});
