'use strict';

// Server-enforced Firebase write kill switch (Rooms unification Section 8).
//
// The switch is one Firestore document: `app/writeFreeze`. It SHIPS DISABLED:
// the document does not exist in production, and an absent document (or any
// value other than the strict boolean `frozen: true`) leaves every write path
// behaving exactly as before. Only the Admin SDK or the Firebase console can
// create or change the document — client rules keep `app/*` read-only — so a
// cached old client can never unfreeze itself.
//
// Enforcement has two independent server-side layers:
//   1. Every mutating Cloud Function checks the document (inside the booking
//      transaction wherever one exists, so a flip is race-free with in-flight
//      submissions).
//   2. `firestore.rules` denies the one direct client write path (owner
//      cancellation) while the document says `frozen: true`.
//
// Flipping the switch in production is a Section 9 cutover action only.

const FREEZE_COLLECTION = 'app';
const FREEZE_DOCUMENT = 'writeFreeze';

// Shown to members by the old clients' existing error toasts.
const FROZEN_MESSAGE =
  'Study Rooms reservations are moving to the LV Zion app and are read-only '
  + 'right now. Please use https://lvzion.vercel.app/rooms.';

/**
 * Interprets a snapshot of `app/writeFreeze`. Strict: only the boolean value
 * `true` freezes writes, so a typo, a string "true", or a missing document can
 * never freeze the live scheduler by accident — and, equally, cannot silently
 * unfreeze during the real cutover, because the cutover runbook writes the
 * exact boolean.
 */
function freezeStateFrom(snapshot) {
  const data = snapshot && snapshot.exists ? snapshot.data() : null;
  const frozen = Boolean(data) && data.frozen === true;
  return {
    frozen,
    reason: frozen && typeof data.reason === 'string' ? data.reason : '',
  };
}

module.exports = {
  FREEZE_COLLECTION,
  FREEZE_DOCUMENT,
  FROZEN_MESSAGE,
  freezeStateFrom,
};
