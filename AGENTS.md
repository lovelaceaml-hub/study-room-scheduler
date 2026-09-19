# LV Zion Study Rooms

Production: https://lvrooms.web.app. Read README.md, docs/HANDOFF.md, and docs/PLAN-BOOKING-DRAWER-AND-NAME-DISPLAY.md first. The active plan and Build log cover booking details and public name display.

The original app design is retired: /?classic=1 no longer exists and app.js, styles.css and special-schedule-entry.js are deleted. index.html is a minimal shell that loads design-choice.js only, which forwards to the remembered design or shows the six-design picker (Solace is the default). /?choose=1 reopens the picker. Live designs live in experiences/<name>/ and share experiences/shared/live.js and experiences/shared/model.js; serviceBlocksFor() in model.js is the one service table all six designs and validRange read, including the 2026-09-21 special day. Admin has its own page at /admin/. All booking writes go through the existing memberSubmitBooking callable, with an optional validated requestedUnit. Never write Firestore bookings directly from a design.

Verification, from the repository root: npm test; npm run test:model; npm run test:cutover; npm run test:designs; npm run test:admin; npm run test:tv. Every browser smoke uses fictional mocked Firebase and cannot write production data.

Deploy only explicitly authorized scope: hosting:app, and functions:memberSubmitBooking when that Function changes. Never deploy other Functions, rules, indexes, Authentication, or the legacy Hosting target without explicit scope. Preserve original Atlas/Lattice prototypes and all unrelated dirty work. Production member data must not enter fixtures, screenshots, logs, or agents. Credentials stay in existing provider stores.
