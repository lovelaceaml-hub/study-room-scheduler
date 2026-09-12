# LV Zion Study Rooms repository contract

## Orientation

This is the established Firebase Study Rooms scheduler. Production is live at https://lvrooms.web.app. Start with `README.md`, `docs/HANDOFF.md`, and `docs/PLAN-RESERVE-NOW-DESIGN-WAVE.md`.

## Plan and Build log

The active plan is `docs/PLAN-RESERVE-NOW-DESIGN-WAVE.md`. Its `## Build log` records the current six-preview design wave.

## Verification

Run `npm test`, `npm run test:ui`, `npm run test:confirm-popup`, `node test/tv-smoke.mjs`, and `git diff --check`. Preview branches also require a browser check that real schedule data loads and every save path stays read only.

## Traps and boundaries

- Production is the `main` branch and https://lvrooms.web.app. Never deploy a design branch to production.
- The allowed production deploy scope is `functions,hosting:app`, only when explicitly releasing. Design previews use Hosting preview channels and never deploy Functions, rules, indexes, or Authentication.
- Preview branches may read the live Firestore schedule but must block all booking, cancellation, admin, cleanup, and note mutations.
- Booking policy is mirrored in `app.js` and `functions/lib/policy.js`; keep them aligned for production changes.
- Credentials remain in Firebase secrets or the active provider store. Never place them in source, docs, screenshots, or logs.
- Preserve unrelated working-tree files, especially local prototype artifacts.
