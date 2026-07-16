# LV Zion Study Rooms

Sabbath-day study-room and equipment sign-up app for LV Zion, with admin approval of
requests. Members pick a room (or a whiteboard/TV) and a time inside one of the two
after-service booking windows; admins approve or decline.

**Stack:** buildless vanilla JavaScript, one `index.html` with embedded CSS, Firebase
Hosting + Firestore for real-time sync, with a full localStorage fallback so the app
still works offline or before the Firebase project is connected. No framework, no
bundler, no npm dependencies — same architecture as its sibling apps (worship-duty-app,
morning-prayer-app, exhibition-tours).

See `docs/` for the User Manual, Setup Guide, and Creation Guide.
