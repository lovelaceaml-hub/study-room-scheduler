# Study Room Scheduler — read this before any edit

**This app is LIVE.** Real congregation members book study rooms at
https://lvrooms.web.app, and it remains the **authoritative** Study Rooms
scheduler until the LV Zion cutover (Section 9 of
`/Users/anthony/Projects/preaching/docs/PLAN-ROOMS-UNIFICATION.md`) is
owner-approved and executed. Owner directive (Anthony, 2026-08-19): **"Don't
retire anything until it's 100% running."** Until then:

- **Never deploy anything from this repository** — not hosting, not functions,
  not Firestore rules, not `firebase.cutover.json` — without Anthony's explicit
  go for that specific deploy. Editing files here changes nothing live;
  deploying does.
- **Never flip the write freeze in production.** `tools/freeze.mjs` targets
  the emulator by default and refuses production unless deliberately forced;
  the production flip belongs to the Section 9 cutover runbook only.
- **Never write to production Firestore** (project `lvz-rooms`). Member names
  and purposes live in `bookings`; private notes live in `privateBookingNotes`.
  Treat both as real member data: never print document contents into chats,
  logs, or docs.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `app.js`, `sw.js`, `tv.*` | The live buildless PWA (hosting target `app`) |
| `firestore.rules` | Source of the deployed rules — deploys are a separate reviewed act |
| `functions/` | Cloud Functions (`us-west1`, Node 22): all booking creation and admin actions |
| `cutover/` | The **retirement shell** — built, NOT deployed. Served only by `firebase.cutover.json` during Section 9 |
| `docs/RETIREMENT-PLAN.md` | The redirect/retirement plan (document only) |
| `test/`, `functions/test/` | Node test suites; `test:rules` needs the Firestore emulator |

## Commands

Anthony's Mac requires the npm cache prefix on every npx call:

- Syntax + policy tests: `npm test`
- Functions unit tests: `npm --prefix functions run test`
- Rules + freeze emulator tests:
  `npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest emulators:exec --only firestore --project demo-study-room-security "npm --prefix functions run test:rules"`
- UI smoke: `npm run test:ui`

## Cross-repo rules

The LV Zion successor lives at `/Users/anthony/Projects/preaching`. Migration
rehearsal (export → import → reconcile) is driven from that repository. Shared
Firebase safety rules: `/Users/anthony/.claude/skills/lv-zion-firebase-apps/SKILL.md`.
Admin credential is the `STUDY_ROOM_ADMIN_PIN` secret in Secret Manager — never
copy its value anywhere.
