# LV Zion Study Rooms

## Quick links

- **Website:** https://lvrooms.web.app — primary member address
- **Lobby TV:** https://lvrooms.web.app/?tv=1 — lobby schedule with an eligible-day picker
- **Previous address:** https://lvz-rooms.web.app — redirects to the primary address
- **Status:** Live — the mobile, scheduling, TV, and demo update was deployed and live-verified on July 20, 2026
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

An installable study-room scheduling app for LV Zion. The Home dashboard shows this
device’s reservation notices, current/upcoming numbered-unit use, and a bounded live
update feed. Members choose Study room, Whiteboard, or TV, step between the upcoming
Tuesday and Saturday, and reserve an explicit 30-minute range.

The July 20 update adds a member-visible day
overview, vertically stacked start times, an immediate **When should it end?** prompt,
and a button that reveals both numbered-unit assignments and unassigned pending requests.
An open slot on Home will carry its date, resource, and start time into Reservations.
It also extends booking through **11:00 PM**, including 10:00 PM and 10:30 PM starts,
adds a TV day picker, and provides full browser-only mock information for member and TV
previews. Tuesday bookings remain instantly approved when open. A Saturday submission
is instantly approved only when it is made on that Saturday at or after 10:00 AM Los
Angeles time; advance Saturday requests remain pending for Admin review.

The app uses buildless vanilla JavaScript, Firebase Hosting, and Firestore live
updates. It includes a phone-friendly booking experience and a dedicated lobby TV
screen. Reservations use explicit 30-minute time boundaries, never add a hidden half-hour
to the selected end, and remain separated by service periods. The lobby TV continues to
show service bands in the day timetable.

The primary address, lobby TV, secure Admin backend, and permanent redirect from the
former address are live. The July 20 update was deployed and live-verified at the
primary address.
