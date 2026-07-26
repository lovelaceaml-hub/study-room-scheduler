# LV Zion Study Rooms

## Quick links

- **Website:** https://lvrooms.web.app — primary member address
- **Lobby TV:** https://lvrooms.web.app/?tv=1 — lobby schedule with an eligible-day picker
- **Previous address:** https://lvz-rooms.web.app — redirects to the primary address
- **Status:** Live — the July 26 update (approval removed from every day, plus End early) is deployed and live-verified; the July 22 fixed Clear/Continue selection bar and earlier Home-first, annotation, mobile-grid, feed-order, and grid-density refinements remain in place
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

The July 22 selection-bar update is also live. After a member chooses an exact end
time, the Home range summary keeps **Clear** and **Continue** fixed inside the viewing
screen, above the phone navigation when needed. Members can scroll the schedule without
losing the actions. This is a presentation-only change; booking behavior, privacy, and
the backend are unchanged.

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
