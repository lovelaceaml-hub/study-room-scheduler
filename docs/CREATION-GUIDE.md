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
study room or a piece of shared equipment (whiteboard, TV, podium) for the one
upcoming Saturday; a committee member (the approver) assigns the specific room
or unit and approves or declines each request through a PIN-gated Admin screen.
This is the **v2 rebuild**: members no longer pick a specific room/unit
themselves or see a multi-week calendar — v1 (dropdown time pickers, members
choosing exact rooms, an 8-Saturday view) has been fully replaced.

It is a **buildless vanilla-JavaScript Progressive Web App (PWA)** — no
framework (no React/Vue), no bundler, no `npm install`, no build step. Firebase
Hosting serves the static files as-is, and Firebase Firestore provides
real-time sync between everyone's devices. It also has a full **localStorage
fallback**, so it keeps working (single-device only) if Firestore is
unreachable.

This is architecturally the same pattern as its sibling church apps:
`worship-duty-app`, `morning-prayer-app`, and `exhibition-tours`. Each is its
own standalone Firebase project — this one is **`lvz-rooms`**, separate from
the others, so nothing here can affect their data.

## Current status

The app is **live** at `https://lvz-rooms.web.app`, connected to its real
Firebase project (`lvz-rooms`). `firebase-config.js` holds the real, live
config values (not placeholders) — every device that opens the link syncs
through the same Firestore database in real time. The header's small status
pill reads "Live" when connected; it falls back to "local" only if a device
can't reach Firestore (no network, or a genuine outage), in which case that
device keeps working from its own last-saved copy until it reconnects.

## File-by-file map

| File | Role |
|---|---|
| `index.html` | The entire page shell and all CSS (one `<style>` block), including the v2 design system — see "Design system" below. No separate stylesheet. Loads `firebase-config.js` first, then `app.js` as an ES module. |
| `app.js` | All application logic: data model, Firestore sync, rendering, and event handling. This is the file you'll edit for almost any behavior change. See below for its structure. |
| `firebase-config.js` | Holds this app's Firebase project identifiers (project ID, API key, etc. — these are public client identifiers, not secrets; real access control lives in `firestore.rules`). Already filled in with the live `lvz-rooms` project's values. |
| `firebase.json` | Tells the `firebase` command-line tool what to deploy: hosting serves the whole project folder (`"public": "."`, with `docs/` and a few dotfiles excluded), plus where the Firestore rules/indexes files are. Also sets `no-cache` headers on `index.html` and `.js` files so devices always pick up the newest version after a deploy. |
| `firestore.rules` | Firestore's access-control rules. Currently wide open (`allow read, write: if true`) for both the `bookings` and `app` collections — deliberate, documented in the file itself: members must be able to submit requests without an account, and the Admin PIN is a UX gate, not real security. Acceptable for a small congregation tool; revisit only if that stops being true. |
| `firestore.indexes.json` | Firestore composite-index definitions. Currently empty — the app's queries are simple enough not to need any. |
| `manifest.json` | The PWA manifest: app name, icon, and "standalone" display mode, which is what makes "Add to Home Screen" behave like a real app instead of just a bookmark. |
| `sw.js` | The service worker. Caches the app's files so it can still open when offline, using a network-first strategy (always tries the network first, falls back to the cache). Its `CACHE` constant (currently `srs-v2`) should be bumped any time you want to force devices to drop old cached files sooner. |
| `icon.svg` | The app's icon, used for the home-screen icon and browser tab. |

## How `app.js` is organized

Reading top to bottom, `app.js` has these sections (each marked with a comment
banner in the file):

1. **Constants** — the editable "business rules" of the app (see next section).
2. **State** — `state` (the data: bookings + settings) and `ui` (which tab is
   showing, whether the read-only "last Sabbath" reference view is open,
   in-progress form/assignment drafts, etc.).
3. **Tiny helpers** — HTML-escaping, ID generation, PIN hashing (SHA-256).
4. **Date/time helpers** — finding the upcoming/previous Saturday, time-slot
   math, formatting.
5. **Resource/unit model** — helpers for looking up rooms/whiteboards/TVs/
   podiums and their labels.
6. **Booking model** — filtering bookings by date/status, what a booking
   "needs," purpose/status labels, and `isValidBooking()` (see "Data model
   and v1 cleanup" below).
7. **Occupancy / capacity engine** — for a given resource type, date, and time
   range: which unit is occupied by whom, how many of a type are in use for a
   given slot, and whether a slot is "full." This is the foundation everything
   else (recommendations, the waiting line, sign-up blocking) is built on.
8. **Waiting line** — `waitingLineForType()` / `waitingPositionFor()`, the
   *derived* (never stored) queue described below.
9. **Admin assignment recommendation** — `recommendedUnit()` and
   `initialAssignmentFor()`, which pick the ★-starred suggestion shown on a
   pending request's assignment row, plus `certaintyHint()` (the "Tip: X is
   Confirmed, Y is Tentative" note).
10. **Persistence** — reading/writing localStorage, and a small write layer
    (`fsSet`/`fsDelete`) that writes to Firestore *and* applies the same
    change locally, so the UI updates instantly even before the network
    round-trip completes.
11. **Firebase** — connects to Firestore (loaded from Google's CDN at
    runtime, no npm package needed) and keeps `state` in sync via
    `onSnapshot` listeners.
12. **Render functions** — one function per screen/section
    (`renderSchedule`, `renderSignup`, `renderAdmin`, etc.) that build HTML
    strings from the current `state`/`ui`.
13. **Actions** — `handleAction()` is the single place that responds to every
    button click, tap, and form submit, via `data-act` attributes in the HTML
    rather than one listener per element. `tapSlot()` holds the shared
    "tap a start slot, then an end slot" logic used by both the member Sign
    Up form and the Admin "Add a booking" form.
14. **Swipe-to-switch-tabs** — the touch-swipe gesture, shared with the
    sibling apps.
15. **Init** — registers the service worker, loads local data, connects to
    Firebase if configured, and does the first render.

## The constants you'll most likely want to edit

These live near the top of `app.js` and drive the whole app — changing them
here changes what members see, without touching any other logic:

- **`ROOMS`** — the five study rooms: Study Room 1–4 (each `hasEquipment:
  true`, meaning it has its own built-in whiteboard/TV/podium — which is why
  members request equipment separately, e.g. to use in the main hall) and the
  Baptism Room (`hasEquipment: false`, `num: null`). Each entry's `id` must
  stay unique and unchanged once bookings exist, since approved bookings store
  this id in their `assignments`.
- **`WHITEBOARDS`** — Whiteboards 1–3 (Large) and 4–5 (Vertical). Whiteboard
  *n* is treated as paired with **Podium *n*** — see `initialAssignmentFor()`
  and the `admin-assign`/`af-assign` handlers in `app.js` for the pairing
  logic, if you ever change how many whiteboards or podiums exist.
- **`PODIUMS`** — Podiums 1–5, generated as `[1,2,3,4,5].map(...)`. Keep this
  in sync with `WHITEBOARDS` if you add/remove either, since the pairing logic
  matches them by number.
- **`TVS`** — TVs 1–3, generated the same way.
- **`CAPACITY`** — derived automatically from the length of `ROOMS` /
  `WHITEBOARDS` / `PODIUMS` / `TVS` (`CAPACITY = { room: ROOMS.length, ... }`).
  You don't edit this directly — add or remove units in the lists above and
  capacity follows.
- **`WINDOWS`** — the two actual booking windows members can request time in:
  10:00 AM–2:30 PM ("Morning") and 4:00–7:30 PM ("Afternoon"). Change the
  `start`/`end` times here if service times or buffer periods change. Time
  slots are always 30 minutes, computed from `WINDOWS` via `slotStarts()` —
  there's no separate slot-length constant.
- **`NEED_TYPES`** — the four things a member can ask for (`room`,
  `whiteboard`, `tv`, `podium`), in the order they appear everywhere
  (checkboxes, assignment pill rows, etc).
- **`PURPOSES`** — the purpose choices members pick from on the Sign Up form
  (Contact study, New member study, Member meeting, Other).
- **`ADMIN_PURPOSES`** — `PURPOSES` plus one admin-only extra option, "Room
  unavailable / reserved," used only on the Admin "Add a booking" form.
- **`PREFERRED_ROOM_CHOICES`** — the pill choices on the Sign Up form's
  optional "preferred room" row (`null` = "No preference," plus each room id).

## Data model and v1 cleanup

One Firestore collection for bookings, plus one settings document — both
currently open read/write (see `firestore.rules`):

- **`bookings/{id}`** — one document per request. v2 shape:
  - `date` — the Saturday, as an ISO date string (`YYYY-MM-DD`).
  - `start`, `end` — 24-hour `HH:MM` strings, the requested time range.
  - `name` — the requester's typed name.
  - `needs` — `{ room, whiteboard, tv, podium }`, each `true`/`false` — what
    the member asked for. **Multiple can be true at once** (e.g. a room and a
    TV together).
  - `preferredRoom` — a room id (e.g. `"room-2"`) or `null`. Only meaningful
    when `needs.room` is true; a hint for the approver, never a guarantee.
  - `purpose`, `purposeOther` — same as before: one of the `PURPOSES`/
    `ADMIN_PURPOSES` ids, plus free text when `purpose === "other"`.
  - `certainty` — `"confirmed"` or `"tentative"`. Drives the ✓/◆ badges shown
    everywhere and the `certaintyHint()` tip on contested pending requests.
  - `note` — optional free text from the requester.
  - `status` — one of `pending`, `approved`, `declined`, `cancelled`.
  - `assignments` — `{ room, whiteboard, tv, podium }`, each either a unit id
    (e.g. `"room-3"`, `"wb-4"`, `"tv-1"`, `"pod-4"`) or `null`. Set by the
    approver at approval time (or immediately, for admin-added bookings); this
    is what actually reserves a specific room/unit for the occupancy checks.
  - `createdAt` — timestamp (milliseconds) when submitted. This is also what
    the derived waiting line sorts by (see below).
  - `decidedAt` — timestamp when approved/declined (admin actions only).
- **`app/settings`** — a single document holding shared app-wide settings.
  Currently just `pinHash` — the SHA-256 hash of the Admin PIN (never the PIN
  itself). The very first successful entry of the default PIN (`0000`) on any
  device writes this hash and "locks in" that PIN for everyone from then on;
  see `adminUnlocked()`/the `admin-unlock` action in `app.js`.

The document ID for a booking (`uid()` in `app.js`) is a locally-generated
timestamp + random string — there's no server-assigned ID.

**Old v1 documents are ignored, not migrated.** v1 bookings stored a single
`resourceId` field instead of `needs`/`assignments`. Rather than migrating
that shape, `app.js` simply treats any doc with a `resourceId` field (or
anything otherwise malformed) as invalid and filters it out everywhere reads
happen — see `isValidBooking()`:

```js
function isValidBooking(b) {
  return !!b && typeof b === 'object' && !('resourceId' in b) && b.needs && typeof b.needs === 'object';
}
```

Every read of the bookings collection funnels through `bookingsList()` /
`bookingByIdSafe()`, which apply this filter, so stale v1 documents left over
in Firestore are simply invisible to v2 — they don't need to be deleted, but
running **Housekeeping** (8-weeks-old cleanup) will eventually remove them by
date if they're old enough.

## The waiting line is derived, never stored

There is no "queue position" field anywhere in Firestore. Positions are
recomputed from scratch on every render, from `createdAt` order, which is why
a cancellation "self-heals" the line instantly with no extra bookkeeping:

1. `fullSlotsForType(type, date)` finds every 30-minute slot where the number
   of approved+assigned bookings of that type already equals its capacity
   (e.g. all 5 study rooms are taken for the 11:00–11:30 slot).
2. `mergeIntoStretches()` merges adjacent full slots into contiguous
   `{start, end}` stretches, so a whole 11:00 AM–1:00 PM full period is
   treated as one stretch, not four separate ones.
3. `waitingLineForType(type, date)` takes every **pending** request of that
   type overlapping a full stretch, sorts them by `createdAt` (oldest first),
   and numbers them 1st/2nd/3rd — this is the amber "waiting in line" strip
   shown under each resource group on the schedule.
4. `waitingPositionFor(booking, date)` looks up one specific booking's worst
   (highest) position across everything it needs, for the "In line — 2nd"
   badge on "My requests" and the pending admin queue's sort order.
5. Sign-up itself is blocked once a stretch already has **3 pending** requests
   queued (`isSlotBlockedForNeeds()` / `blockingReasonForRange()`) — the time
   slot greys out on the Sign Up form and can't be submitted.

Because none of this is stored, **cancelling an approved booking** immediately
changes what counts as "full," which immediately changes who's "in line" and
what the next pending card's admin recommendation looks like — no separate
"promote from waitlist" code path exists; it falls out of the same
recompute-on-render logic. See `initialAssignmentFor()`'s note about rebuilding
an admin's draft assignment when it was drafted while everything was full.

## Design system

The visual design combines two named directions that were chosen from a set
of mockups (see `docs/redesign-mockups.html` for the original comparison):

- **"Morning Chapel"** — the layout and typography direction: serif display
  headings (`--serif: 'Iowan Old Style', 'Palatino', Georgia, serif`) paired
  with a sans-serif UI font, hairline rules, generous whitespace, and the
  timeline/list schedule grid.
- **"Clear Sky"** — the color direction: blue as the primary action color,
  green for Confirmed bookings, sky blue for Tentative bookings, and amber for
  the waiting line.

All of it lives as **CSS custom properties** at the top of `index.html`'s
`<style>` block, inside `:root`:

```css
:root {
  --paper: #FBFCFE;      /* page background */
  --card: #FFFFFF;       /* card background */
  --line: #DCE4F0;       /* hairline borders */
  --ink: #1B2333;        /* primary text */
  --ink-soft: #5B6478;   /* secondary text */
  --ink-faint: #93A0B8;  /* muted/disabled text */
  --primary: #2B4BC0;    /* buttons, active tab, links */
  --sky: #7FA7F0;        /* Tentative color */
  --green: #188A5E;      /* Confirmed color */
  --amber: #E8A13C;      /* waiting-line color */
  --danger: #C43D33;     /* decline/cancel/error */
  --serif: 'Iowan Old Style', 'Palatino', Georgia, serif;
  --sans: 'Avenir Next', 'Segoe UI', system-ui, -apple-system, sans-serif;
  ...
}
```

To change the overall color scheme or fonts, edit these variables — nearly
every rule below them references one of these names rather than a hard-coded
color, so a handful of edits here reflows through the whole app consistently.
There's no dark-mode variant currently; if one is wanted later, it would be a
second block of the same variables under a `@media (prefers-color-scheme:
dark)` query.

The schedule grid itself has two parallel implementations that share the same
data: `.sched-desktop` (the timeline view, hidden below 760px width) and
`.sched-mobile` (the simple list view, hidden at 760px and above) — see the
`@media (min-width: 760px)` rule near the bottom of the stylesheet.

## How the offline/local fallback works

- Every write goes through `fsSet(col, id, data)` / `fsDelete(col, id)` in
  `app.js`. These always update the in-memory `state` and localStorage
  immediately (via `applyLocalWrite`), and *also* send the write to Firestore
  if a connection (`fb`) exists. This is why the UI reacts instantly even on a
  slow connection — it doesn't wait for Firestore to confirm.
- On load, `state` is seeded from localStorage (`loadLocal()`), then
  `initFirebase()` tries to connect. If it succeeds, live Firestore data (via
  `onSnapshot`) takes over and keeps overwriting `state` in real time, which is
  also saved back to localStorage as a fresh local copy.
- If Firestore never connects (no network, or a genuine error), a banner
  appears ("Could not connect to the shared database...") and the "sync pill"
  in the header shows "local" instead of "Live." The app keeps working from
  whatever was last saved to localStorage.
- A booking made while offline stays local-only until the device reconnects —
  there's currently no queued-write/retry system beyond what `fsSet` already
  does (it fires the write once; if it fails, a console warning is logged but
  the local copy still holds).

## Deploying

The app is already connected to the live `lvz-rooms` Firebase project — there
is no first-time setup left to do. For any change to `index.html`, `app.js`,
or the other app files, deploy just the hosting files with:

```bash
npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy --only hosting
```

(The `npm_config_cache=/tmp/npm-cache` prefix works around an npm cache
permissions quirk on this Mac — see the `anthony-mac-environment` skill for
details. Always use it when running `npx`/`npm`/`firebase` commands here.)

`--only hosting` deploys just the static files (fast, and can't touch
Firestore's access rules by accident). If `firestore.rules` itself changes,
deploy it explicitly instead:

```bash
npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy --only firestore:rules
```

or omit `--only` entirely to push both hosting and rules in one step.

After any deploy that changes `app.js` or `index.html` in a way you want
existing installs to pick up quickly, bump the `CACHE` constant near the top
of `sw.js` (e.g. `srs-v2` → `srs-v3`) so the service worker drops its old
cached copies.

## Future ideas (not built yet)

- **Admin notification when a request arrives.** Right now the approver has
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
