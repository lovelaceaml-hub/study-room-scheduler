# LV Zion Study Rooms

## Quick links

- **Website:** https://lvrooms.web.app — primary member address
- **Lobby TV:** https://lvrooms.web.app/?tv=1 — current-day lobby schedule
- **Previous address:** https://lvz-rooms.web.app — redirects to the primary address
- **Status:** Live
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

An installable study-room scheduling app for LV Zion. The opening Home dashboard shows
this device’s pending, next, and denied reservation notices, current/upcoming numbered-unit
use, and a bounded live update feed. Members choose Study room,
Whiteboard, or TV, step between the upcoming Tuesday and Saturday with date arrows,
then tap a listed start time and choose the exact ending from the dropdown that appears.
Tuesday bookings auto-approve
when a resource is open; Saturday requests are manually reviewed by priority.
Members see only the open and pending counts first and can expand the numbered-unit detail.
Unavailable ranges explain the conflict and offer a shorter available ending when possible.
**My reservations** shows this device’s status.

The app uses buildless vanilla JavaScript, Firebase Hosting, and Firestore live
updates. It includes a phone-friendly booking experience and a dedicated lobby TV
screen. Reservations use explicit 30-minute time boundaries, never add a hidden half-hour
to the selected end, and remain separated by service periods through 10:00 PM. The lobby
TV continues to show service bands in the day timetable.

The primary address, lobby TV, secure Admin backend, and permanent redirect from
the former address are live.
