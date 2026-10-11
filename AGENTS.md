# Study Room Scheduler

This is the live LV Zion room-booking app at https://lvrooms.web.app. Read
`README.md`, `docs/HANDOFF.md`, and the active plan
`docs/PLAN-19-hosting-release-preflight.md` before changing or releasing it.

The active plan's `## Build log` is the record of implementation and verification.
The completion record is `docs/runs/plan-19-hosting-release-preflight/INDEX.md`.

## Verification

- `npm test`
- `npm run test:browser`
- With Temurin installed at `$HOME/tools/jdk`: set
  `JAVA_HOME="$HOME/tools/jdk/Contents/Home"` and put `$JAVA_HOME/bin` on `PATH`,
  then run `npm_config_cache=/tmp/npm-cache npm run test:rules`.
- `npm run test:release-check`
- `bash .github/scripts/deploy-guard.sh --self-test`

Before a release, the GitHub production workflow deploys a temporary Hosting
channel and runs the read-only page and lobby-schedule checks against it. It
deploys production only if that preflight passes. The same read-only check runs
again after production deployment.

## Boundaries

- Production is `https://lvrooms.web.app`, Firebase project `lvz-rooms`.
- A push to a non-main branch publishes a seven-day preview. Previews use the
  live database and Functions. Do not book, change records, or share preview
  access without Anthony's approval.
- Production Hosting releases run only through the manually started GitHub
  workflow on `main`, scoped to `hosting:app`. Do not run a bare Firebase
  deploy. Functions and Firestore rules have separate, narrower release
  procedures in `README.md`.
- Do not copy the Admin PIN or other credentials into files, logs, chat, or
  source control. The PIN is in Firebase Secret Manager.
- Live reservations and private notes are real member data. Verification uses
  the test fixtures or read-only live checks; never seed or alter production
  data without explicit approval.
