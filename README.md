# LV Zion Study Rooms

Members reserve study rooms, whiteboards and TVs; the lobby TV shows the day's rooms.

- App: https://lvrooms.web.app
- Lobby TV: https://lvrooms.web.app/tv.html
- Admin: https://lvrooms.web.app/admin/
- Demo with made-up data: add `?demo=1` to the app or TV address.

## How it works

- Members book any day of the week from today through the next three days, on a
  30-minute grid from 10:00 AM to 11:00 PM, around service times. A time that has already
  begun can't be reserved: at 11:10 the earliest start is 11:30. A reservation is confirmed
  right away.
- Contact and New Member reservations have priority. When every unit is taken, a Contact
  reservation can take a unit held by New Member or Other reservations, and New Member can
  take one held by Other, always from the lowest priority first (a unit held only by Other
  before one with a New Member reservation). Admin holds are never taken. The member sees
  exactly what will happen before confirming. If the displaced reservation began earlier, it
  now ends when the priority one starts, so a reservation already in use is never moved;
  otherwise it moves to another free unit, or is replaced if none is free. My reservations
  tells them which. Cancelling the priority reservation later does not bring the other back.
- Until a reservation ends, its device can cancel it or end it early; End early offers only
  times that have not passed.
- Each browser signs in anonymously, so My reservations shows what was booked on that device.
- The schedule and the lobby TV show a short public name ("Brother John Smith" becomes
  "B John"; a last initial is added when two people with the same first name are booked
  the same day) and the contact name, member name or purpose.
- Admin (PIN-protected; it locks again after 20 minutes without a change) sees full names,
  adds reservations or holds on the same days members can book, cancels, ends early,
  restores, gives a reservation a new unit when a priority reservation took one, keeps
  private notes and removes records older than 8 weeks. The day's list can be searched by
  name, contact or member, purpose and unit, and "Hide cancelled" (remembered on that
  device) hides cancelled reservations.

## Changing the rules

Everything about when and what can be booked is in `functions/lib/config.js`: hours,
the booking window, service times per weekday, one-off special days, rooms and equipment,
purposes and priority, and limits. The app, Admin and TV read these rules from the server, so
a change there plus a Functions deploy is the whole change. The sample rules in
`public/shared/demo.js` must match; `npm test` fails if they don't, and it also checks that
config.js itself makes sense (real dates, services on the grid, and so on).

## Code

```
public/            the website (Firebase Hosting)
  index.html       member app
  app/             member app: main.js (schedule), booking.js, details.js, mine.js, store.js (data)
  admin/           Admin page: admin.js, session.js (PIN, lock and session timing)
  tv.html, tv/     lobby TV: tv.js, status.js (each room's "In use", "Free until" line)
  shared/          code and styles all three pages use, including availability.js (the
                   browser's copy of the booking rules)
  sw.js            offline support
functions/         Cloud Functions
  index.js         the endpoints
  lib/config.js    the rules
  lib/             schedule.js (dates), bookings.js (booking rules), actions.js (database
                   changes), views.js (what each page may see), guard.js (sign-in, limits, PIN),
                   names.js (public names), config-check.js (refuses a config.js with mistakes)
  test/            server tests, with an in-memory Firestore
test/              browser/server agreement tests and browser tests
firestore.rules    browsers cannot read or write the database directly
firebase.json      Hosting; /api/lobby-schedule is the lobby TV's schedule (the
                   publicLobbySchedule function), cached by the Hosting CDN for a minute
legacy/            the old address, which redirects here
```

Plain JavaScript, HTML and CSS; no build step. Firestore holds `bookings`,
`privateBookingNotes`, `adminSessions` and `adminRateLimits`. The Admin PIN is the Secret
Manager secret `STUDY_ROOM_ADMIN_PIN`.

## Tests

```sh
npm install && npm install --prefix functions
npx playwright install chromium
npm test               # rules, database actions, endpoints, and browser/server agreement
npm run test:browser   # app, Admin and TV in a real browser with a fake backend
npm run test:rules     # browsers cannot read or write the database (Firestore emulator, needs Java)
```

The tests never reach the live project. Database tests use an in-memory Firestore that runs
transactions one at a time (Firestore's transactions behave as if they did), so they also
check that two people can never get the same unit. Tests that depend on the date run on a
fixed clock (the browser tests on Saturday, October 3, 2026, 9:00 AM in Los Angeles; the
server tests on the Thursday before), so they pass on any day and at any hour. GitHub runs all
three on every pull request ("Tests").

## Looking at live data

`npm run reservations` lists reservations from today on, as members see them; add
`-- --full` for full names and private notes. It reads through the service account
`claude-reader@lvz-rooms`, which can only read the database, using your gcloud sign-in
(no key file).

## Releasing

Pushing a branch other than `main` publishes a 7-day preview (see the Actions run summary).
Previews use the live database and Functions, so look but do not book.

When `functions/` or `firestore.rules` changed, release them first with the
**"Firebase backend release (Functions and rules)"** workflow on `main` (Actions tab, Run
workflow; only when Anthony says to release):

- `functions`: `NONE`, `ALL`, or names separated by commas, for example
  `publicLobbySchedule,memberSubmitBooking`. Only names in `.github/functions-pinned.txt`
  are accepted, and each is deployed by name, so CI never deletes a function.
- `rules`: tick to also release `firestore.rules`.
- `confirm`: type `RELEASE`.

It runs `npm test` and the rules emulator tests first, then signs in to Google without a key
(Workload Identity Federation: Google gives the token only to that workflow file, started by
hand, on `main`) and deploys through `.github/scripts/deploy-guard.sh`. A first run with
`functions=NONE` and rules unticked only proves the sign-in. When `publicLobbySchedule`
changed, release it before the site (the lobby TV path `/api/lobby-schedule` points at it).
The weekly "Functions drift check" compares the live Functions with `main` (read-only).
One-time setup: Anthony runs `ops/cloud-shell/backend-deploy-wif.sh` in Google Cloud Shell; it
creates the keyless identities and prints the repository variables both workflows read.

Without GitHub (for example from Google Cloud Shell), deploy Functions **by name only**, never
a bare `--only functions`:

```sh
npm ci --prefix functions
npx firebase-tools@15 deploy --project lvz-rooms --only functions:memberSchedule,functions:memberSubmitBooking,functions:memberCancelBooking,functions:memberEndBookingEarly,functions:publicLobbySchedule,functions:adminStartSession,functions:adminEndSession,functions:adminSchedule,functions:adminBookingAction,functions:adminNoteAction
```

The Functions deploy runs the server tests first and stops if one fails. Firestore rules:
`npx firebase-tools@15 deploy --only firestore:rules --project lvz-rooms`.

Then release the site: run the "Firebase release (production)" workflow on `main` in GitHub
Actions (Hosting only).

To undo: Functions have no one-click rollback (revert on `main`, release again); Firestore
rules: Firebase console, Firestore, Rules, history.
To undo a site release, use Rollback in the Firebase console under Hosting, site `lvrooms`.
The GitHub deploy key (service account `gh-hosting-deploy@lvz-rooms`) should be rotated by
September 28, 2027.
