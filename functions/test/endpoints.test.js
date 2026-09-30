'use strict';

// The Cloud Functions this code deploys. Deploying drops any function not
// listed here, so a change to this list is a change to what is live.

const test = require('node:test');
const assert = require('node:assert/strict');

test('the endpoints are exactly these', () => {
  process.env.GCLOUD_PROJECT ??= 'demo-study-rooms';
  assert.deepEqual(Object.keys(require('../index.js')).sort(), [
    'adminBookingAction', 'adminEndSession', 'adminNoteAction', 'adminSchedule', 'adminStartSession',
    'memberCancelBooking', 'memberEndBookingEarly', 'memberSchedule', 'memberSubmitBooking', 'publicLobbySchedule'
  ]);
});
