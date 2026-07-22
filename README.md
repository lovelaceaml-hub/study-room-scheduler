# LV Zion Study Rooms

## Quick links

- **Website:** https://lvrooms.web.app — primary member address
- **Lobby TV:** https://lvrooms.web.app/?tv=1 — lobby schedule with an eligible-day picker
- **Previous address:** https://lvz-rooms.web.app — redirects to the primary address
- **Status:** Live — the July 21 Home-first and annotation-refinement releases are deployed and live-verified; a two-item follow-up is currently pre-deployment
- **Docs:**
  - [User Manual](docs/USER-MANUAL.md) — how members, approvers, and the lobby display use it
  - [Setup Guide](docs/SETUP-GUIDE.md) — how to open or install it
  - [Creation Guide](docs/CREATION-GUIDE.md) — how it was built
  - [Handoff](docs/HANDOFF.md) — current implementation and rollout notes
  - [Product Brief](docs/PRODUCT-BRIEF.md) — audience, goals, constraints, and risks
  - [User Journeys](docs/USER-JOURNEYS.md) — critical member, approver, and lobby flows
  - [Design Direction](docs/DESIGN.md) — approved compact dashboard direction
  - [Design Prototype](docs/design-prototype.html) — the original visual reference for the live design system
  - [Design Research](docs/DESIGN-RESEARCH.md) — evidence and decisions behind the redesign
  - [UI Quality Report](docs/UI-QUALITY-REPORT.md) — browser and accessibility verification
  - [All documents →](docs/)

An installable study-room scheduling app for LV Zion. The July 21 Home-first update makes
Home the sole member booking surface on every screen size. It starts with two compact
Live updates, then offers a member-safe Day overview divided into expandable Morning,
Afternoon, and Evening sections. Members use its one-date arrow stepper, choose Study
room, Whiteboard, or TV, tap an open cell, choose an exact ending, inspect availability,
and continue to the request form.

The deployed July 20 update adds a member-visible day
overview, vertically stacked start times, an immediate **When should it end?** prompt,
and a button that reveals both numbered-unit assignments and unassigned pending requests.
An open slot on Home carries its date, resource, and start time directly into the
end-time sheet; after the ending is chosen, Home shows the range, availability details,
and **Continue** action.
It also extends booking through **11:00 PM**, including 10:00 PM and 10:30 PM starts,
adds a TV day picker, and provides full browser-only mock information for member and TV
previews. The July 21 update removes the separate member Reservations tab, makes Live
updates two compact rows above the Home overview, adds purpose beneath each occupied
Home cell's name, and makes the daypart map's vertical scrolling explicit. My
reservations, Admin, booking policy, privacy rules, and the study-room-only lobby TV
remain unchanged. Tuesday bookings
remain instantly approved when open. A Saturday submission
is instantly approved only when it is made on that Saturday at or after 10:00 AM Los
Angeles time; advance Saturday requests remain pending for Admin review.

The July 21 annotation refinement keeps two visible Live-update rows and lets their
activity scroll independently; the resource controls use count-free 44px labels; the
masthead **Schedule** link opens the public TV view; My
reservations uses compact cards with a visibly destructive cancellation action; and
Admin no longer repeats a Recent updates feed. Booking policy, privacy, dates, mock
data, and the study-room-only TV remain unchanged.

The current uncommitted follow-up keeps the Home schedule legible on narrow phones with
a compact, no-wrap time column that leaves room for the room tiles. It also orders Live
updates newest-first from the latest booking status timestamp. These two refinements are
pre-deployment and do not change booking policy, date choices, demo isolation, privacy,
or TV behavior.

The app uses buildless vanilla JavaScript, Firebase Hosting, and Firestore live
updates. It includes a phone-friendly booking experience and a dedicated lobby TV
screen. Reservations use explicit 30-minute time boundaries, never add a hidden
half-hour to the selected end, and remain separated by service periods. The refined
lobby TV continues to show service bands in its study-room timetable.

The primary address, lobby TV, secure Admin backend, and permanent redirect from the
former address are live. Commit `29bc9d4` passed 13/13 policy tests, UI and TV smoke
checks, and an independent re-review with no P0/P1 findings. A read-only Playwright
check at `https://lvrooms.web.app/?demo=1` confirmed Schedule keeps demo mode, compact
cards and cancellation, count-free controls, the scrollable update feed, and the absent
Admin feed. Only the primary Hosting `app` target was deployed; Functions, Firestore
rules, indexes, Authentication, and the legacy redirect were unchanged.
