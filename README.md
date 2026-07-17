# LV Zion Study Rooms

Sabbath-day study-room and equipment sign-up app for LV Zion, with admin approval of
requests. Members pick a room (or a whiteboard/TV) and a time inside one of the two
after-service booking windows; admins approve or decline.

## Quick links

- **Website:** https://lvz-rooms.web.app — share this link with members
- **Status:** Live
- **Docs:**
  - [User Manual](docs/USER-MANUAL.md) — how members request a study room
  - [Setup Guide](docs/SETUP-GUIDE.md) — how to open and install the app
  - [Creation Guide](docs/CREATION-GUIDE.md) — how the app was built, for maintainers
  - [Handoff](docs/HANDOFF.md) — record of latest changes and status
  - [Redesign Mockups](docs/redesign-mockups.html) — three visual design directions for the redesign
  - [All documents →](docs/)

**Stack:** buildless vanilla JavaScript, one `index.html` with embedded CSS, Firebase
Hosting + Firestore for real-time sync, with a full localStorage fallback so the app
still works offline or before the Firebase project is connected. No framework, no
bundler, no npm dependencies — same architecture as its sibling apps (worship-duty-app,
morning-prayer-app, exhibition-tours).

See `docs/` for the User Manual, Setup Guide, Creation Guide, and Handoff notes
(`docs/HANDOFF.md` — the plain-English record of the latest changes and how to pick the
project back up).
