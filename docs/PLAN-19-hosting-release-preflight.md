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
page checker, and the deploy guard. Document boundaries and remaining approval
steps.

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
- No changes have been pushed or deployed. A branch push publishes a
  seven-day preview that uses live data. Production release remains an explicit
  choice for Anthony.
