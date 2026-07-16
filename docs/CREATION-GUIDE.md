# LV Zion Study Rooms — Creation Guide

This guide is for whoever helps Anthony maintain or extend this app later. It
explains how it's built, how the pieces fit together, and how to make common
changes safely. It assumes no prior familiarity with this specific project,
but does assume basic comfort with editing plain-text files and running a
terminal command when told to.

For how to *use* the app day to day, see `docs/USER-MANUAL.md`. For how to
open/install the app with no technical steps, see `docs/SETUP-GUIDE.md`.

## What this is

"LV Zion Study Rooms" is a Sabbath-day (Saturday) sign-up app for LV Zion
church (World Mission Society Church of God, Las Vegas). Members request a
study room or shared equipment for a time slot; a committee member approves or
declines each request through a PIN-gated Admin screen.

It is a **buildless vanilla-JavaScript Progressive Web App (PWA)** — no
framework (no React/Vue), no bundler, no `npm install`, no build step. Firebase
Hosting serves the static files as-is, and Firebase Firestore provides
real-time sync between everyone's devices. It also has a full **localStorage
fallback**, so it keeps working (single-device only) if Firestore is
unreachable or not yet configured.

This is architecturally the same pattern as its sibling church apps:
`worship-duty-app`, `morning-prayer-app`, and `exhibition-tours`. Each is its
own standalone Firebase project — this one is **`lvz-rooms`**, separate from
the others, so nothing here can affect their data.

## Current status (important)

`firebase-config.js` in this project currently holds **placeholder** values
(`apiKey: "REPLACE_ME"`, etc.) — the real Firebase project `lvz-rooms` has not
been created and connected yet. Until that's done:

- The app still runs and is fully usable, but only in **local mode**: each
  device keeps its own copy of the data in the browser's localStorage, and
  devices do **not** sync with each other.
- The header's small status pill will read "local" instead of "live sync."

See **Deploying / connecting to Firebase** below for the one-time setup that
turns on real syncing and puts the app on the live URL.

## File-by-file map

| File | Role |
|---|---|
| `index.html` | The entire page shell and all CSS (one `<style>` block). No separate stylesheet. Loads `firebase-config.js` first, then `app.js` as an ES module. |
| `app.js` | All application logic: data model, Firestore sync, rendering, and event handling. This is the file you'll edit for almost any behavior change. See below for its structure. |
| `firebase-config.js` | Holds this app's Firebase project identifiers (project ID, API key, etc. — these are public client identifiers, not secrets; real access control lives in `firestore.rules`). Currently a placeholder — see "Current status" above. |
| `firebase.json` | Tells the `firebase` command-line tool what to deploy: hosting serves the whole project folder (`"public": "."`), plus where the Firestore rules/indexes files are. Also sets `no-cache` headers on `index.html` and `.js` files so devices always pick up the newest version after a deploy. |
| `firestore.rules` | Firestore's access-control rules. Currently wide open (`allow read, write: if true`) for both the `bookings` and `app` collections — deliberate, documented in the file itself: members must be able to submit requests without an account, and the Admin PIN is a UX gate, not real security. Acceptable for a small congregation tool; revisit only if that stops being true. |
| `firestore.indexes.json` | Firestore composite-index definitions. Currently empty — the app's queries are simple enough not to need any. |
| `manifest.json` | The PWA manifest: app name, icon, and "standalone" display mode, which is what makes "Add to Home Screen" behave like a real app instead of just a bookmark. |
| `sw.js` | The service worker. Caches the app's files so it can still open when offline, using a network-first strategy (always tries the network first, falls back to the cache). Its `CACHE` constant (currently `srs-v1`) should be bumped (e.g. to `srs-v2`) any time you want to force devices to drop old cached files sooner. |
| `icon.svg` | The app's icon, used for the home-screen icon and browser tab. |

## How `app.js` is organized

Reading top to bottom, `app.js` has these sections (each marked with a comment
banner in the file):

1. **Constants** — the editable "business rules" of the app (see next section).
2. **State** — `state` (the data: bookings + settings) and `ui` (which tab is
   showing, in-progress form drafts, etc.).
3. **Tiny helpers** — HTML-escaping, ID generation, PIN hashing (SHA-256).
4. **Date/time helpers** — Saturday-finding, time-slot math, formatting.
5. **Resource model** — helpers for looking up rooms/equipment and their
   category.
6. **Booking model** — filtering bookings by resource/date/status, overlap
   checks, purpose/status labels.
7. **Persistence** — reading/writing localStorage, and a small write layer
   (`fsSet`/`fsDelete`) that writes to Firestore *and* applies the same change
   locally, so the UI updates instantly even before the network round-trip
   completes.
8. **Firebase** — connects to Firestore (loaded from Google's CDN at runtime,
   no npm package needed) and keeps `state` in sync via `onSnapshot` listeners.
9. **Render functions** — one function per screen/section
   (`renderSchedule`, `renderSignup`, `renderAdmin`, etc.) that build HTML
   strings from the current `state`/`ui`.
10. **Actions** — `handleAction()` is the single place that responds to every
    button click, dropdown change, and form submit, via `data-act`/`data-chg`
    attributes in the HTML rather than one listener per element.
11. **Swipe-to-switch-tabs** — the touch-swipe gesture, shared with the sibling
    apps.
12. **Init** — registers the service worker, loads local data, connects to
    Firebase if configured, and does the first render.

## The constants you'll most likely want to edit

These live near the top of `app.js` and drive the whole app — changing them
here changes what members see, without touching any other logic:

- **`RESOURCES`** — the list of bookable things: Study Rooms 1–4, the Baptism
  Room, Large Whiteboard, Vertical Whiteboard, and TV. Each entry has an `id`
  (must stay unique and unchanged once bookings exist, since bookings store
  this id), a `label` (the display name), a `category` (`room` or
  `equipment`), and a `capacity` (how many identical units exist — e.g. the TV
  has 3, so up to 3 TV bookings can exist in the same slot before it's
  "full"). Add, rename, or adjust capacity here to change what's offered.
- **`CATEGORIES`** — the three tabs shown on the Sign Up / schedule grids
  (Study Rooms, Whiteboards, TVs). Note both whiteboards share the `wb`
  category — see `categoryOf()` just below `RESOURCES` if you add another
  resource that should share a category with something else.
- **`SERVICES`** — the three Sabbath services (9–10 AM, 3–4 PM, 8–9 PM),
  used only to label the schedule grid's service dividers.
- **`WINDOWS`** — the two actual booking windows members can request time in:
  10:00 AM–2:30 PM and 4:00–7:30 PM. These end 30 minutes before the next
  service on purpose. Change the `start`/`end` times here if service times or
  buffer periods change.
- **`PURPOSES`** — the purpose choices members pick from on the Sign Up form
  (Contact, New member study, Member meeting, Other).
- **`ADMIN_PURPOSES`** — the same list plus one admin-only extra option,
  "Room unavailable / reserved," used only on the Admin "Add a booking" form.

Time slots are always 30 minutes, computed from `WINDOWS` — there's no
separate slot-length constant to change; it's the step size baked into
`slotStarts()`/`validEndsFor()` in the date/time helpers section.

## Firestore data model

Two Firestore collections, both currently open read/write (see
`firestore.rules`):

- **`bookings/{id}`** — one document per request or booking. Fields:
  - `date` — the Saturday, as an ISO date string (`YYYY-MM-DD`).
  - `resourceId` — matches an `id` in `RESOURCES`.
  - `start`, `end` — 24-hour `HH:MM` strings.
  - `name` — the requester's typed name.
  - `purpose` — one of the `PURPOSES`/`ADMIN_PURPOSES` ids.
  - `purposeOther` — free text, only set when `purpose` is `"other"`.
  - `note` — optional free text from the requester.
  - `status` — one of `pending`, `approved`, `declined`, `cancelled`.
  - `createdAt` — timestamp (milliseconds) when submitted.
  - `decidedAt` — timestamp when approved/declined (admin actions only).
- **`app/settings`** — a single document holding shared app-wide settings.
  Currently just `pinHash` — the SHA-256 hash of the Admin PIN (never the PIN
  itself). The very first successful entry of the default PIN (`0000`) on any
  device writes this hash and "locks in" that PIN for everyone from then on;
  the `firestore.rules` file and `adminUnlocked()`/`admin-unlock` action in
  `app.js` are where this bootstrap logic lives if it ever needs to change.

The document ID for a booking (`uid()` in `app.js`) is a locally-generated
timestamp + random string — there's no server-assigned ID.

## How the offline/local fallback works

- Every write goes through `fsSet(col, id, data)` / `fsDelete(col, id)` in
  `app.js`. These always update the in-memory `state` and localStorage
  immediately (via `applyLocalWrite`), and *also* send the write to Firestore
  if a connection (`fb`) exists. This is why the UI reacts instantly even on a
  slow connection — it doesn't wait for Firestore to confirm.
- On load, `state` is seeded from localStorage (`loadLocal()`), then
  `initFirebase()` tries to connect. If it succeeds, live Firestore data
  (via `onSnapshot`) takes over and keeps overwriting `state` in real time,
  which is also saved back to localStorage as a fresh local copy.
- If Firestore never connects (no config, no network, or a genuine error), the
  banner "Running on this device only — shared sync is unavailable" appears,
  and the "sync pill" in the header shows "local" instead of "live sync." The
  app keeps working from whatever was last saved to localStorage.
- A booking made while offline stays local-only until the device reconnects
  and Firebase is configured — there's currently no queued-write/retry system
  beyond what `fsSet` already does (it fires the write once; if it fails, a
  console warning is logged but the local copy still holds).

## Deploying / connecting to Firebase

**One-time setup** (only needs doing once, by whoever has access to Anthony's
Google/Firebase account):

1. Create the Firebase project named **`lvz-rooms`** (via the Firebase console
   or `firebase projects:create lvz-rooms`).
2. Enable **Firestore** in that project (choose a location, e.g. `nam5`).
3. Register a **Web app** inside that project and copy its config values
   (`apiKey`, `appId`, etc.) into `firebase-config.js`, replacing the
   `REPLACE_ME` placeholders.
4. From this folder, deploy everything (hosting files + Firestore rules):

   ```bash
   npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy
   ```

   (The `npm_config_cache=/tmp/npm-cache` prefix works around an npm cache
   permissions quirk on this Mac — see the `anthony-mac-environment` skill for
   details. Always use it when running `npx`/`npm`/`firebase` commands here.)

**Every later deploy** (after any change to `index.html`, `app.js`, or the
other files) uses the same command:

```bash
npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy
```

This pushes both the hosting files and `firestore.rules` in one step, since
`firebase.json` lists both. If you only changed `firestore.rules` and want a
faster partial deploy, add `--only firestore:rules`; for hosting-only, `--only
hosting`.

After any deploy that changes `app.js` or `index.html` in a way you want
existing installs to pick up quickly, bump the `CACHE` constant near the top
of `sw.js` (e.g. `srs-v1` → `srs-v2`) so the service worker drops its old
cached copies.

## Future ideas (not built yet)

- **Admin notification when a request arrives.** Right now the committee has
  to check the Admin tab to see new requests. The Las Vegas Work Mission
  GroupMe bot (see the `wm-social-automations` skill / the
  `wm-social-automation` project) already has a working Firebase-Functions
  pattern for posting into GroupMe — an `onRequestCreated` Firestore trigger
  here could reuse that same approach to ping a GroupMe chat whenever a new
  booking request comes in.
- **Recurring bookings.** Currently every booking is a one-off for a single
  Saturday. A member who wants the same room every week has to submit a new
  request each time. A "repeat weekly for N weeks" option on the Sign Up form
  would need to create multiple `bookings` documents at once (or introduce a
  "series" concept), plus a way to cancel/edit the whole series.
- **Member accounts.** There's currently no login — anyone with the link can
  submit under any name, and "My requests" is tracked per-device via
  localStorage rather than per-person. Real accounts (or at least a
  lightweight per-member PIN, as `morning-prayer-app` uses) would let members
  see their requests from any device and would make it harder to submit under
  someone else's name by mistake.
