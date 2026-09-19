# LV Zion Study Rooms — Firebase scheduler

## September 19, 2026: the original app design is retired

Opening https://lvrooms.web.app now offers the six designs: Solace (the default), Velum,
Cove, Petal, Atlas and Lattice. There is no seventh "keep the current design" option, and
`/?classic=1` no longer exists. My reservations, Cancel and End early live inside each
design, Admin has its own page at https://lvrooms.web.app/admin/, and the lobby TV is
unchanged. One shared service rule in `experiences/shared/model.js` now decides service
times for every design, so the Monday, September 21, 2026 special schedule reads the same
everywhere.

- [Plan](docs/PLAN-RETIRE-CLASSIC-DESIGN.md)
- [Run record](docs/runs/2026-09-19-retire-classic-design/INDEX.md)
- [Design picker](https://lvrooms.web.app/?choose=1)
- [Admin](https://lvrooms.web.app/admin/)

## September 12, 2026: Booking details and public names

The six member designs and the classic app now collect both the reserver's name and the purpose-specific reserved-for detail. Schedule reservations show the public name and purpose, connect consecutive slots into one block, and open a detail view. Everyone can see the public-safe reserved-for detail, while only the owning member receives End early or Cancel actions. Raw booking documents remain server-only.

Names normalize leading title words or initials, so `Sister Kiana Davis`, `Sister Kiana D`, and `S. Kiana` display as `S Kiana`. A surname initial appears only when another booking has the same given name with a different surname. The secure full-replace release is verified and deployed.

- [Active plan](docs/PLAN-BOOKING-DRAWER-AND-NAME-DISPLAY.md)
- [Run record](docs/runs/2026-09-12-booking-details-and-name-display/INDEX.md)
- [Design picker](https://lvrooms.web.app/?choose=1)

## September 12, 2026: Member design choice

Live at https://lvrooms.web.app/?choose=1. Members can keep the current app or choose Atlas, Lattice, Solace, Velum, Cove, or Petal. The device remembers the selection; Change design reopens the chooser. All six use the existing live schedule, anonymous member identity, and protected memberSubmitBooking service. My reservations returns to the current app without losing the selected design or booking ownership.

The existing backend now accepts an optional requestedUnit. A directly selected room, board, or TV is honored inside the existing conflict transaction; clients that omit it retain the existing allocation behavior. The secure release scope includes Hosting target app, memberSubmitBooking, memberSchedule, memberCancelBooking, memberEndBookingEarly, adminSchedule, publicLobbySchedule, and Firestore rules. The full-replace production release is deployed.

- [Previous plan](docs/PLAN-MEMBER-DESIGN-CHOICE.md)
- [Design picker](https://lvrooms.web.app/?choose=1)


**August 1, 2026 — Firebase remains live.** This established scheduler is
active at `https://lvrooms.web.app`, including its existing booking and lobby
TV functions. LV Zion Study Rooms is also active at
`https://lvzion.vercel.app/rooms` by Anthony's direction.

**September 11, 2026.** The "Study Rooms has moved to the LV Zion app" notice was
removed from the top of the page. It was not true: this scheduler is still the one
members use, and the notice was telling them to book somewhere else.

The two systems use separate calendars: a booking made here does not appear in
LV Zion. A final encrypted 129-document Firebase snapshot was imported into
LV Zion (4 account-linked; 14 intentionally unclaimed for Room Coordinator
management), but no ongoing synchronization exists. Firebase data, Functions
source, prior Hosting release, and this private repository are preserved.

## Quick links

- **Firebase scheduler:** https://lvrooms.web.app (established Tuesday/Saturday calendar, opening on the six-design picker)
- **Admin page:** https://lvrooms.web.app/admin/ (the Admin workspace, protected by the existing server-validated session)
- **Firebase lobby TV:** https://lvrooms.web.app/?tv=1 — established public lobby display
- **LV Zion scheduler:** https://lvzion.vercel.app/rooms — separate shared-account calendar
- **Status:** Both systems active by owner decision August 1, 2026; bookings do not synchronize. The July 26 End early and earlier UI refinements are live here.
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
reservations, Admin, privacy rules, and the study-room-only lobby TV remain unchanged.

The July 21 annotation refinement keeps two visible Live-update rows and lets their
activity scroll independently; the resource controls use count-free 44px labels; the
masthead **Schedule** link opens the public TV view; My
reservations uses compact cards with a visibly destructive cancellation action; and
Admin no longer repeats a Recent updates feed. Booking policy, privacy, dates, mock
data, and the study-room-only TV remain unchanged.

The July 21 follow-up (commit `880afcb`) keeps the Home schedule legible on narrow
phones with a compact, no-wrap time column that leaves room for room tiles. It also
orders Live updates newest-first from the latest booking status timestamp. It does not
change booking policy, date choices, demo isolation, privacy, or TV behavior.

The July 21 mobile grid-density follow-up (commit `e940438`) is also live. On phone
widths, it keeps Home tiles at a compact, evenly spaced 44px minimum; retains the 58px
single-line time column; and uses readable 10px names with 8.5px ellipsized purpose
labels. It is a visual-density change only and does not alter scheduling behavior.

The September 11, 2026 update is live (deployed September 11, 2026: Functions first,
then Hosting target `app`). It replaces the July 22 selection bar. Choosing an end time now opens a
confirmation popup with the exact range, **Clear**, and **Continue**, because members
missed the fixed bar and read the return to Home as a glitch. The same update shows the
whole day as one schedule instead of three collapsible boxes, moves the service times to
Saturday 10:00–11:00 AM, 2:30–3:30 PM, 7:30–8:30 PM and Tuesday 7:30–8:30 PM, retires
**Meeting** as a purpose, colors reservations by purpose in priority order (Contact, New
Member, Other), and lets a Contact or New Member take a time held for **Other** when
nothing is open. Whoever is displaced keeps their time in another unit if one is free,
and receives a priority update notice either way.

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

Commit `880afcb` also passed all 13 policy tests, UI smoke and axe checks (including
mobile geometry, ISO timestamps, and newest-first ordering), and TV smoke; its
independent re-review found no P0/P1 issues. Read-only production Playwright verified
Jordan as the newest update, a one-line 58px time column, 66.5px room tiles, and no
overflow at 393×852. This was another `hosting:app`-only deployment.

Commit `e940438` passed all 13 policy tests, UI/axe, TV smoke, and diff checks. Its
independent reviewer initially found a P1 tiny-text regression (8.5px/7.5px), which was
corrected; the final review found no P0/P1/P2 issues. Read-only production Playwright
confirmed a fitting 58px time column, 65.75×44px tiles, 10px names, 8.5px purposes, and
no overflow. Only `hosting:app` deployed.

The July 26 update changes the booking policy itself. **No day requires approval any
more:** Tuesday and Saturday reservations are both confirmed the moment they are made,
whether they are booked weeks ahead or on the day itself. Whether a room, whiteboard, or
TV is actually free is still checked in the same protected transaction, so a full range
is refused exactly as before.

The same update adds **End early**. A member who finishes ahead of schedule opens My
reservations, taps **End early**, and picks the time they actually finished — a
10:00 AM–12:30 PM reservation ended at 12:00 PM immediately shows the room as available
to everyone, on Home and on the lobby TV. On the day itself the choice matching the
current Los Angeles time is marked **now**. The reservation stays on the member's list
with a note of what was originally booked. Admin can do the same from the day list when
someone reports finishing in person. A 30-minute reservation has nothing to shorten, so
it offers only **Cancel**. Requests that were still pending when this shipped remain in
the Admin queue and can be approved there.
