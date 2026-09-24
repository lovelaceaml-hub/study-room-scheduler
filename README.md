# LV Zion Study Rooms

An installable web app that lets LV Zion members reserve study rooms, whiteboards and TVs,
and shows the day's room schedule on a lobby TV.

- **Live app:** https://lvrooms.web.app
- **Lobby TV:** https://lvrooms.web.app/tv.html (the older `/?tv=1` address still forwards there)
- **Design picker:** https://lvrooms.web.app/?choose=1

## What it does

Members pick one of six designs the first time they open the app: Solace (the default),
Velum, Cove, Petal, Atlas or Lattice. The device remembers the choice, and **Change design**
reopens the picker. All six designs read the same live schedule and book through the same
protected server function. Each design includes My reservations, Cancel and End early.

Reservations use 30-minute slots, run until 11:00 PM, and stay clear of service times.
Tuesday and Saturday bookings are confirmed immediately if the room, whiteboard or TV is
free. Contact and New Member bookings can take a time held for Other when nothing else is
open. The person moved is given another unit if one is free and is notified either way.

A separate LV Zion scheduler (https://lvzion.vercel.app/rooms) has also been active since
August 1, 2026 by owner decision. The two calendars do not sync.

## How it's built

- Plain JavaScript, HTML and CSS with no build step. The root `index.html` loads
  `design-choice.js`, which opens the remembered design or shows the picker.
- `experiences/<name>/` holds each design. `experiences/shared/` holds the live data
  connection and the shared schedule model, including the one service-time table
  every design uses.
- `tv.html`, `tv.js` and `tv.css` are the lobby display. `admin/` is the Admin page.
- `functions/` holds the Firebase Cloud Functions. All booking writes go through
  `memberSubmitBooking`, and browsers never write bookings to Firestore directly.
- `firestore.rules` and `firestore.indexes.json` are the database rules and indexes.

## Running the tests

From the repository root, after `npm install`:

```sh
npm test              # syntax checks and booking-policy tests
npm run test:model    # shared schedule model and design picker
npm run test:cutover  # old-address compatibility
npm run test:designs  # browser smoke tests for all six designs
npm run test:admin    # Admin page smoke test
npm run test:tv       # lobby TV smoke test
```

The browser tests use Playwright with fictional, mocked Firebase data. They never touch
production. They also refresh the screenshots in `docs/live-design-evidence/`.

## How it's deployed

The app runs on Firebase (project settings are in `.firebaserc` and `firebase.json`):

- **Hosting target `app`** serves the repository root, except for docs, tests, functions and
  config files, which `firebase.json` excludes.
- **Hosting target `legacy`** serves `legacy/` and permanently redirects the former
  address to https://lvrooms.web.app.
- **Cloud Functions** deploy from `functions/`.

Releases deploy only the scope that changed and that the owner has approved. That is
usually Hosting target `app`, plus `memberSubmitBooking` when that function changes.
Other Functions, the Firestore rules and indexes, Authentication and the legacy target
are deployed only with explicit approval. `AGENTS.md` has the full rules.

## Docs

- [Handoff](docs/HANDOFF.md): current state and a dated history of every release
- [User Manual](docs/USER-MANUAL.md): how members, admins and the lobby display use it
- [Setup Guide](docs/SETUP-GUIDE.md): how to open or install it
- [Product Brief](docs/PRODUCT-BRIEF.md) and [User Journeys](docs/USER-JOURNEYS.md): who it's for and the key flows
- [Creation Guide](docs/CREATION-GUIDE.md): how it was built
- Design: [Direction](docs/DESIGN.md), [Research](docs/DESIGN-RESEARCH.md),
  [Prototype](docs/design-prototype.html), [Redesign mockups](docs/redesign-mockups.html),
  [UI Quality Report](docs/UI-QUALITY-REPORT.md)
- Plans: [Booking details and names (active)](docs/PLAN-BOOKING-DRAWER-AND-NAME-DISPLAY.md),
  [Retire classic design](docs/PLAN-RETIRE-CLASSIC-DESIGN.md),
  [Member design choice](docs/PLAN-MEMBER-DESIGN-CHOICE.md),
  [Priority override indicators](docs/PLAN-PRIORITY-OVERRIDE-INDICATORS.md),
  [Remove extra copy](docs/PLAN-REMOVE-EXTRA-COPY.md)
- Run records for each release: [docs/runs/](docs/runs/)
- Reviews: [docs/review/](docs/review/)
- [All documents](docs/)
