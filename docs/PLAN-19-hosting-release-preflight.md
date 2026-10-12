# Plan 19: Check Hosting before production release

## Outcome

Before the production Hosting release, confirm that a temporary copy serves its
main pages and current lobby schedule. If it does not, stop before publishing
the production site. After a successful production publish, check the live
pages and schedule too.

The check must not write to the shared live database, and the temporary
preflight channel must expire automatically.

## Section 1: Add preview preflight

Deploy a uniquely named, one-day Hosting channel with the pinned production
Hosting scope. Parse the Firebase CLI output and accept only one HTTPS URL for
the expected `lvrooms` site and exact release channel. Run the established
GET/HEAD-only page and lobby schedule checker against it before production.

## Section 2: Verify and document

Test valid and invalid preview URLs, the release-check workflow, the existing
page checker, and the deploy guard. Document boundaries and release evidence.

## Build log

- **2026-10-10:** Added a one-day Hosting-channel preflight before production.
  It runs the read-only page, Admin, lobby TV, and schedule API checks; the
  workflow also adds a read-only check after a successful production deploy.
  Added strict preview URL parsing and a rejection test for a channel name that
  only shares the expected channel's prefix. Release checker: 28 tests pass.
  Main app tests: 138 pass; browser tests: 75 pass; deploy guard self-test: 24
  checks pass; Firestore rules emulator tests: 2 pass with Temurin 25 and Node
  22. Workflow YAML and parser syntax checks pass. No real Firebase deployment
  was run. Independent review found no actionable issues. Source inspection
  confirmed valid lobby rows use configured room units and the scheduler's
  validated time format; malformed stored rows fail the preflight. The real
  Firebase CLI URL remains fixture-tested only.
- **2026-10-11:** Integrated the audited change with the latest main branch,
  preserving the newer performance release. PR
  [#15](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/15)
  merged as `bf0141d0198e3ca94bc14100138b02b94884759e`. Hosted tests and the
  seven-day branch preview succeeded.
- Local integration checks passed: release checker 28/28, main suite 141/141,
  browser suite 77/77, deploy-guard 24/24, backend-guard 34/34, and workflow
  YAML and JavaScript syntax checks.
- Production workflow
  [run 38192834347](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/38192834347)
  passed. Its automatically expiring one-day preflight at
  https://lvrooms--release-check-38192834347-85g4u1i3.web.app returned HTTP 200
  for the member page, Admin page, and lobby TV; the current public schedule
  check passed. The headless load found no uncaught page errors.
- Production Hosting deploy and the same post-release page and schedule checks
  succeeded. The workflow deployed `hosting:app` only. Its read-only browser
  guard blocked an anonymous sign-up POST before it was sent; no booking data
  or backend resources were changed.
- **2026-10-11:** The seven-day user-facing branch review preview created for
  this release was deleted after release. The branch preview workflow now
  requires manual dispatch and an explicit visible-UI-change confirmation.
  Non-visual changes do not publish a branch review preview. The required
  automated one-day production preflight remains unchanged. No release steps
  remain.
