'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FREEZE_COLLECTION, FREEZE_DOCUMENT, FROZEN_MESSAGE, freezeStateFrom } = require('../lib/freeze');

function snapshot(exists, data) {
  return { exists, data: () => data };
}

test('the kill switch ships disabled: an absent document never freezes writes', () => {
  assert.deepEqual(freezeStateFrom(snapshot(false, undefined)), { frozen: false, reason: '' });
  assert.deepEqual(freezeStateFrom(null), { frozen: false, reason: '' });
  assert.deepEqual(freezeStateFrom(undefined), { frozen: false, reason: '' });
});

test('only the strict boolean true freezes writes', () => {
  assert.equal(freezeStateFrom(snapshot(true, { frozen: true })).frozen, true);
  assert.equal(freezeStateFrom(snapshot(true, { frozen: false })).frozen, false);
  assert.equal(freezeStateFrom(snapshot(true, { frozen: 'true' })).frozen, false);
  assert.equal(freezeStateFrom(snapshot(true, { frozen: 1 })).frozen, false);
  assert.equal(freezeStateFrom(snapshot(true, {})).frozen, false);
});

test('a frozen document carries its reason, and only a string reason', () => {
  assert.equal(
    freezeStateFrom(snapshot(true, { frozen: true, reason: 'Cutover rehearsal' })).reason,
    'Cutover rehearsal'
  );
  assert.equal(freezeStateFrom(snapshot(true, { frozen: true, reason: 42 })).reason, '');
  assert.equal(freezeStateFrom(snapshot(true, { frozen: false, reason: 'stale' })).reason, '');
});

test('the freeze document address and member-facing message are stable', () => {
  assert.equal(FREEZE_COLLECTION, 'app');
  assert.equal(FREEZE_DOCUMENT, 'writeFreeze');
  assert.match(FROZEN_MESSAGE, /read-only/);
  assert.match(FROZEN_MESSAGE, /lvzion\.vercel\.app\/rooms/);
});
