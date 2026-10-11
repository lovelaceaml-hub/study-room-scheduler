# Study Room Scheduler

## Orientation

Live Firebase Hosting app for LV Zion members to reserve study rooms,
whiteboards and TVs, with a lobby TV schedule and PIN-protected Admin page.
Production is https://lvrooms.web.app. Start with `README.md` and
`docs/HANDOFF.md`.

## Plan and Build log

The active plan is `docs/PLAN-performance.md`. Its `## Build log` is the
record of changes and verification. No other plan is active.

## Verification

- `npm test`
- `npm run test:browser`
- `npm_config_cache=/tmp/npm-cache npm run test:rules` when Firestore rules
  change (Java required)

Browser tests use fictional data and a fake backend. Do not verify by changing
production reservations.

## Traps and boundaries

- Work on a feature branch, never `main`. Pushing a non-main branch publishes
  a temporary Hosting preview for seven days. It uses live backend services;
  use it only for read-only inspection, never to book.
- Production site releases run the Firebase Hosting workflow on `main`.
  Backend releases are separately guarded and must deploy only approved
  Functions by name; never run a broad/default Firebase deploy.
- The lobby TV reads a public, redacted view. Never expose full names, device
  IDs, private notes or Admin credentials in that response.
- Store the Admin PIN only in Firebase Secret Manager as
  `STUDY_ROOM_ADMIN_PIN`. Never copy credentials or private data into Git.
- The Firestore rules prevent browsers from reading or writing booking data
  directly; all booking changes go through Cloud Functions.
