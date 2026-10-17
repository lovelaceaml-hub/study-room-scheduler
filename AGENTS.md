# Study Room Scheduler

## Full-suite testing requires Anthony's explicit approval (2026-10-17)

This rule applies to every agent and project, including delegated agents, CI,
release wrappers and scheduled jobs. It supersedes any older instruction below
that says to run a full suite by default.

- Run a full repository or project test suite only when Anthony's current prompt
  explicitly requests full-suite testing, or after recommending the exact suite
  and receiving his explicit approval immediately before executing it.
- Approval covers only the named project, suite and run. A generic request to
  test, verify, finish, release or deploy is not approval for a full suite.
- Keep focused checks tied to the change: selected test files or cases, syntax,
  types, lint, guards and limited smoke checks. Do not recreate a full suite by
  splitting it into several supposedly focused commands.
- Full suites must not start automatically on pushes, pull-request updates,
  merges or schedules. In workflows, use a manual dispatch and an explicit
  `full_suite_approved` input that defaults to false. Agents may set it true only
  for the current user-authorized run; a release request alone does not qualify.
- Pass this rule and the precise approved scope to every helper. Before invoking
  a script, package command, deploy hook or workflow, inspect what it runs. Report
  focused evidence and any full suite left unrun without claiming a full pass.

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

Browser tests use fictional data and a fake backend. Do not verify by changing
production reservations.

## Traps and boundaries

- Production is `https://lvrooms.web.app`, Firebase project `lvz-rooms`.
- Work on a feature branch, never `main`. The Firebase preview workflow is
  manual-only; use it only when a visible UI change needs a user-facing review.
  Previews use the live database and Functions; use them only for read-only
  inspection, never to book or change records. The production workflow's
  one-day automated read-only preflight is separate and remains required.
- Production Hosting releases run only through the manually started GitHub
  workflow on `main`, scoped to `hosting:app`. Do not run a bare Firebase
  deploy. Functions and Firestore rules have separate, narrower release
  procedures in `README.md`.
- Do not copy the Admin PIN or other credentials into files, logs, chat, or
  source control. The PIN is in Firebase Secret Manager.
- Live reservations and private notes are real member data. Verification uses
  the test fixtures or read-only live checks; never seed or alter production
  data without explicit approval.
