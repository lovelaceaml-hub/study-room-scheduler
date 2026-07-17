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
  - [All documents →](docs/)

An installable study-room scheduling app for LV Zion. Members choose a time directly
from the compact upcoming Tuesday or Saturday calendar, then complete their request
in a pop-up. Approvers assign Study Rooms 1–4, whiteboards, and TVs. Pending requests
appear live before approval, clearly marked as requested rather than assigned.

The app uses buildless vanilla JavaScript, Firebase Hosting, and Firestore live
updates. It includes a phone-friendly booking experience and a dedicated lobby TV
screen. Reservations use clickable 30-minute slots, show service periods as blocked
calendar areas, and run through 10:30 PM.

The primary address, lobby TV, secure Admin backend, and permanent redirect from
the former address are live.
