# LV Zion Study Rooms

Members reserve study rooms, whiteboards and TVs; the lobby TV shows the day's rooms.

- App: https://lvrooms.web.app
- Lobby TV: https://lvrooms.web.app/tv.html
- Admin: https://lvrooms.web.app/admin/
- Demo with made-up data: add `?demo=1` to the app or TV address.

## How it works

- Members book Tuesdays and Saturdays in the next seven days, on a 30-minute grid from
  10:00 AM to 11:00 PM, around service times. A reservation is confirmed right away.
- Contact and New Member reservations have priority. When every unit is taken, a Contact
  reservation can take a unit held by New Member or Other reservations, and New Member can
  take one held by Other. The member sees this before confirming. If the displaced
  reservation began earlier, it now ends when the priority one starts; otherwise it moves to
  another free unit, or is released if none is free. My reservations tells them which.
- Each browser signs in anonymously, so My reservations shows what was booked on that device.
- The schedule shows a short public name ("Brother John Smith" becomes "B John") and the
  contact name, member name or purpose.
- Admin (PIN-protected) sees full names, adds reservations or holds, cancels, ends early,
  restores, keeps private notes and removes records older than 8 weeks.

## Changing the rules

Everything about when and what can be booked is in `functions/lib/config.js`: hours,
service times per weekday, one-off special days, rooms and equipment, purposes and priority,
and limits. The app, Admin and TV read these rules from the server, so a change there plus a
Functions deploy is the whole change. The sample rules in `public/shared/demo.js` must match;
`npm test` fails if they don't.

## Code

```
public/            the website (Firebase Hosting)
  index.html       member app
  app/             member app: main.js (schedule), booking.js, details.js, mine.js, store.js (data)
  admin/           Admin page
  tv.html, tv/     lobby TV
  shared/          code and styles all three pages use
  sw.js            offline support
functions/         Cloud Functions
  index.js         the endpoints
  lib/config.js    the rules
  lib/             schedule.js (dates), bookings.js (booking rules), actions.js (database
                   changes), views.js (what each page may see), guard.js (sign-in, limits, PIN),
                   names.js (public names)
test/              rules tests and browser tests
firestore.rules    browsers cannot read or write the database directly
legacy/            the old address, which redirects here
```

Plain JavaScript, HTML and CSS; no build step. Firestore holds `bookings`,
`privateBookingNotes`, `adminSessions` and `adminRateLimits`. The Admin PIN is the Secret
Manager secret `STUDY_ROOM_ADMIN_PIN`.

## Tests

```sh
npm install && npm install --prefix functions
npx playwright install chromium
npm test               # rules, database actions, and browser/server agreement
npm run test:browser   # app, Admin and TV in a real browser with a fake backend
```

Firestore rules (needs the emulator): `cd functions && firebase emulators:exec --only firestore "npm run test:rules"`.

## Releasing

Pushing a branch other than `main` publishes a 7-day preview (see the Actions run summary).
Previews use the live database and Functions, so look but do not book.

When `functions/` changed, deploy Functions first, from a Mac signed in to Firebase:

```sh
firebase deploy --only functions --project lvz-rooms
```

Then release the site: run the "Firebase release (production)" workflow on `main` in GitHub
Actions, or `firebase deploy --only hosting:app --project lvz-rooms`. Firestore rules deploy
with `firebase deploy --only firestore:rules --project lvz-rooms`.

To undo a site release, use Rollback in the Firebase console under Hosting, site `lvrooms`.
The GitHub deploy key (service account `gh-hosting-deploy@lvz-rooms`) should be rotated by
September 28, 2027.
