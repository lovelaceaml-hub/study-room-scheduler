# LV Zion Study Rooms

Production: https://lvrooms.web.app. Read README.md, docs/HANDOFF.md, and docs/PLAN-BOOKING-DRAWER-AND-NAME-DISPLAY.md first. The active plan and Build log cover booking details and public name display.

The original app design is retired: /?classic=1 no longer exists and app.js, styles.css and special-schedule-entry.js are deleted. index.html is a minimal shell that loads design-choice.js only, which forwards to the remembered design or shows the six-design picker (Solace is the default). /?choose=1 reopens the picker. Live designs live in experiences/<name>/ and share experiences/shared/live.js and experiences/shared/model.js; serviceBlocksFor() in model.js is the one service table all six designs and validRange read, including the 2026-09-21 special day. Admin has its own page at /admin/. All booking writes go through the existing memberSubmitBooking callable, with an optional validated requestedUnit. Never write Firestore bookings directly from a design.

Verification, from the repository root: npm test; npm run test:model; npm run test:cutover; npm run test:designs; npm run test:admin; npm run test:tv. Every browser smoke uses fictional mocked Firebase and cannot write production data.

Deploy only explicitly authorized scope: hosting:app, and functions:memberSubmitBooking when that Function changes. Never deploy other Functions, rules, indexes, Authentication, or the legacy Hosting target without explicit scope. Preserve original Atlas/Lattice prototypes and all unrelated dirty work. Production member data must not enter fixtures, screenshots, logs, or agents. Credentials stay in existing provider stores.

## Releasing from a cloud session

Added 2026-09-28 with PR #7 (Cloud Deploys plan). This adds a route; every rule above still applies.

- Preview: push any branch except `main`. The "Firebase preview" workflow runs the six checks above, publishes the branch to its own 7-day preview channel on Hosting target `app`, and prints the preview link in the Actions run summary. Docs-only pushes and `dependabot/**` branches get no preview. Previews use the live Firestore data and the live `memberSubmitBooking`: look, do not book or submit.
- Production: only when Anthony says in chat to release Study Rooms, or when he presses Run workflow himself at https://github.com/lovelaceaml-hub/study-room-scheduler/actions/workflows/firebase-release.yml (branch `main`). This is enforced by instruction, not by GitHub (GitHub Free has no protected branches), so never start it without his word. If the permission system refuses, do not work around it; give Anthony the link.
- Pinned scope: `firebase deploy --only hosting:app --project lvz-rooms --non-interactive`. The committed guard `.github/scripts/deploy-guard.sh` refuses any other command.
- The button does NOT deploy `functions:memberSubmitBooking` or any other Function, Firestore rules or indexes, Authentication, or the `legacy` target. Those stay manual from the Mac under the rules above. The release summary warns when the released commits touch `functions/` or `firestore.*`.
- Rollback: Firebase console, Hosting, site `lvrooms`, Release history, Rollback on the previous release: https://console.firebase.google.com/project/lvz-rooms/hosting/sites/lvrooms
- The `test:designs` case `solace-mine` can time out under CI load; rerun the failed run once before investigating.
- Deploy key: service account `gh-hosting-deploy@lvz-rooms` (Firebase Hosting Admin) in the repository secret `FIREBASE_SERVICE_ACCOUNT`. Rotate the key by 2027-09-28.
