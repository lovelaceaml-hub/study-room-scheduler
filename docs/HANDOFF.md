# Handoff notes — LV Zion Study Rooms

Plain-English record of where the app stands and what changed most recently, so
anyone (including a future Claude session) can pick it back up without digging
through the code first.

## What this app is

A Sabbath-day sign-up tool for LV Zion's study rooms and shared equipment. Members
request a study room, a whiteboard, or a TV for a time inside one of the two
after-service windows; a committee approver assigns the actual room/unit and
approves or declines. It's a buildless vanilla-JavaScript PWA (one `index.html`
with embedded CSS + `app.js`), synced live through Firebase Hosting + Firestore,
with a full localStorage fallback so it still works offline.

- **Live site:** https://lvz-rooms.web.app
- **Firebase project:** `lvz-rooms` (dedicated to this app — not shared, so a normal
  deploy is safe)
- **GitHub:** `lovelaceaml-hub/study-room-scheduler` (private)
- **Local preview:** `python3 -m http.server 8095 --directory .` (the
  `room-scheduler` entry in the Projects-root `.claude/launch.json`)

## Three tabs

1. **Reservations** — the day's schedule. Shows who has each study room, whiteboard,
   and TV, a "Who's requesting" list of everyone still waiting for the approver, and
   the member's own "My requests".
2. **Sign up** — the request form (name → what you need → time → who else wants it →
   purpose → how sure → note).
3. **Admin** — PIN-gated (PIN is `0000`, the house standard). Approve/decline the
   queue, assign units, and add a booking directly.

## Latest changes (2026-07-16)

These five changes were made in this session and are **saved to GitHub**. Deploying
them to the live site is a separate step — see "Deploying" below.

1. **Renamed the first tab "This Sabbath" → "Reservations"** (tab label and its
   heading). The "View last Sabbath (reference)" link is unchanged.

2. **New "Who's requesting" list on the Reservations tab.** It shows every request
   still waiting for the approver — name, what they asked for, time, purpose, and a
   badge that reads "Awaiting approval" or "In line — 2nd" (etc.) when they're queued
   behind a full resource. This lets anyone see who has already asked to reserve
   something. (It replaced the older, narrower "Waiting for the approver" list —
   function `reservationRequestsHtml()` in `app.js`.)

3. **New "Already reserved or requested" panel on the Sign Up tab.** As soon as a
   member picks what they need (and, optionally, a time), it lists the people who have
   already reserved (approved) or requested that same type of resource — with a
   confirmed/tentative mark, their name, an Approved/Requested badge, and the time. It
   narrows to overlapping times once a time is chosen, and says "No one else has asked
   for this yet — you'd be first" when empty. (Function `signupExistingHtml()`.)

4. **Podium is no longer a selectable option.** The choices are now just Study room,
   Whiteboard, and TV. A podium is "implied": each whiteboard has its matching podium
   built in (the schedule still shows "Pairs with Podium N" under each whiteboard), so
   a podium comes automatically with a whiteboard and never needs to be requested
   separately. Technically, `podium` was removed from `NEED_TYPES`; the `podium`
   fields and pairing/sync code still exist in the data model but are now dead in
   practice (nothing can ever set `needs.podium` true). See the Creation Guide for the
   full note.

5. **The time picker now shows a start AND end time from a single tap.** Previously,
   tapping one 30-minute slot only showed "2:00" and you had to tap again for an end
   time. Now a single tap selects a full 30-minute block and shows it as a range —
   e.g. "Selected: 2:00 PM – 2:30 PM". Tapping a later slot extends the block; tapping
   an earlier slot restarts from there. (Rewritten `tapSlot()` in `app.js`.)

All five were verified working in a local browser before commit (renamed tab,
"Who's requesting" list, the Sign Up panel showing an overlapping request, no podium
chip, and single-tap start–end times including extend/restart behavior).

## Deploying

The app's Firebase project (`lvz-rooms`) is dedicated to this app, so a normal deploy
is safe. From the project folder:

```
npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy --only hosting
```

(Add `,firestore` if the Firestore rules changed — they did not in this session.)

## Nothing pending

As of this handoff there are no open tasks — the five changes are complete, documented,
and pushed to GitHub. The only outstanding decision is whether/when to deploy them to
the live site.
