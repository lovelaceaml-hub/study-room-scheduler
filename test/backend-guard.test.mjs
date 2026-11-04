// The backend release guard (.github/scripts/backend-guard.sh): it must
// accept main as it is and refuse code a by-name CI deploy cannot handle.
// Each case copies the few files the guard reads into a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = path.join(repo, '.github/scripts/deploy-guard.sh');

function copyRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'backend-guard-'));
  for (const f of ['firebase.json', '.github/functions-pinned.txt', 'functions/index.js', 'functions/package.json', 'functions/package-lock.json']) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    cpSync(path.join(repo, f), path.join(dir, f));
  }
  cpSync(path.join(repo, 'functions/lib'), path.join(dir, 'functions/lib'), { recursive: true });
  return dir;
}

function run(args, root, extraEnv = {}) {
  const r = spawnSync('bash', [guard, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { GUARD_REPO_ROOT: root, GITHUB_STEP_SUMMARY: '' }, extraEnv)
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function edit(root, file, change) {
  const p = path.join(root, file);
  writeFileSync(p, change(readFileSync(p, 'utf8')));
}

test('main as it is passes the source guard', () => {
  const r = run(['functions-source'], repo);
  assert.equal(r.code, 0, r.out);
});

test('an export missing from the pinned list is refused', () => {
  const root = copyRepo();
  try {
    edit(root, 'functions/index.js', s => s + '\nexports.extraThing = 1;\n');
    const r = run(['functions-source'], root);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /pinned/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a .env parameter, process.env or an unknown secret is refused', () => {
  for (const line of [
    "const X = require('firebase-functions/params').defineString('X');",
    'const Y = process.env.SOMETHING;',
    "const Z = require('firebase-functions/params').defineSecret('OTHER_SECRET');"
  ]) {
    const root = copyRepo();
    try {
      edit(root, 'functions/lib/config.js', s => line + '\n' + s);
      const r = run(['functions-source'], root);
      assert.notEqual(r.code, 0, line);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('a changed predeploy hook or a .env file is refused', () => {
  let root = copyRepo();
  try {
    edit(root, 'firebase.json', s => s.replace('node --check \\"$RESOURCE_DIR/index.js\\"', 'npm --prefix \\"$RESOURCE_DIR\\" test'));
    assert.notEqual(run(['functions-source'], root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
  root = copyRepo();
  try {
    writeFileSync(path.join(root, 'functions/.env.lvz-rooms'), 'A=1\n');
    assert.notEqual(run(['functions-source'], root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a decommissioned runtime is refused', () => {
  const r = run(['functions-source'], repo, { GUARD_NOW: '2027-11-01T00:00:00Z' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /decommissioned/);
});

test('the result step tells live apart from failed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'backend-result-'));
  try {
    const log = path.join(dir, 'deploy.log');
    writeFileSync(log, 'i  functions: updating\n+  functions[memberSchedule(us-west1)] Successful update operation.\n');
    assert.equal(run(['functions-result', '0', log, 'memberSchedule'], repo).code, 0);
    assert.notEqual(run(['functions-result', '0', log, 'memberSchedule', 'adminSchedule'], repo).code, 0);
    writeFileSync(log, '+  functions[memberSchedule(us-west1)] Successful update operation.\nError: Functions successfully deployed but could not set up cleanup policy in location us-west1.\n');
    const cleanup = run(['functions-result', '1', log, 'memberSchedule'], repo);
    assert.notEqual(cleanup.code, 0);
    assert.match(cleanup.out, /ARE live/);
    writeFileSync(log, 'Functions deploy had errors with the following functions:\n\tmemberSchedule(us-west1)\n');
    assert.notEqual(run(['functions-result', '2', log, 'memberSchedule'], repo).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the guard self-test passes', () => {
  const r = run(['--self-test'], repo);
  assert.equal(r.code, 0, r.out);
});
