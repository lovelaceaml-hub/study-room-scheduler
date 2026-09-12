# LV Zion Study Rooms

Production: https://lvrooms.web.app. Read README.md, docs/HANDOFF.md, and docs/PLAN-MEMBER-DESIGN-CHOICE.md first. The active plan and Build log cover the six member design choices.

The original app remains available at /?classic=1. /?choose=1 opens the design chooser. Live designs live in experiences/<name>/ and share experiences/shared/live.js. All new booking writes go through the existing memberSubmitBooking callable, with an optional validated requestedUnit. Never write Firestore bookings directly from a design.

Verification: npm test; node --test test/live-model.test.mjs functions/test/public-lobby-schedule.test.js; node test/member-design-smoke.mjs; npm run test:ui; npm run test:confirm-popup; node test/tv-smoke.mjs. The design smoke uses fictional mocked Firebase and cannot write production data.

Deploy only explicitly authorized scope: hosting:app, and functions:memberSubmitBooking when that Function changes. Never deploy other Functions, rules, indexes, Authentication, or the legacy Hosting target without explicit scope. Preserve original Atlas/Lattice prototypes and all unrelated dirty work. Production member data must not enter fixtures, screenshots, logs, or agents. Credentials stay in existing provider stores.
