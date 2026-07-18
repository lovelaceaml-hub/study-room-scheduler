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
  - [Design Prototype](docs/design-prototype.html) — the approved reference used for the live redesign
  - [Design Research](docs/DESIGN-RESEARCH.md) — evidence and decisions behind the redesign
  - [UI Quality Report](docs/UI-QUALITY-REPORT.md) — browser and accessibility verification
  - [All documents →](docs/)

An installable study-room scheduling app for LV Zion. Members choose Study room,
Whiteboard, or TV, select their time directly in the compact Tuesday or Saturday
availability list, then provide only their name and purpose. Tuesday bookings auto-approve
when a resource is open; Saturday requests are manually reviewed by priority.
Members see open capacity first and can expand a time to inspect numbered units. A live update feed summarizes
requests/reservations/cancellations, and **My reservations** shows this device’s status.

The app uses buildless vanilla JavaScript, Firebase Hosting, and Firestore live
updates. It includes a phone-friendly booking experience and a dedicated lobby TV
screen. Reservations use clickable 30-minute slots, show service periods as blocked
calendar areas, and run through 10:00 PM.

The primary address, lobby TV, secure Admin backend, and permanent redirect from
the former address are live.
