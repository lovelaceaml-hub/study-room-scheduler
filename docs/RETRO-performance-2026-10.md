# Performance release retro

## What shipped

All ten plan sections were completed. Indexed occupancy and Admin lookups,
cached search and parsed time data, grouped and sorted lobby-TV bookings, and
member-grid render reuse reduce repeated work. Member and Admin polling now
runs every 30 seconds; hidden Admin pages pause polling and refresh stale
data on return. Section 8 already met its goal, so no redundant code was
added.

The change was merged in pull request [#19](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/19)
and released to https://lvrooms.web.app using the guarded Hosting-only
workflow. Functions, Firestore rules, reservations, and production data were
not changed. The live homepage matched the merged source after release.

## Deviations and lessons

The original performance work passed its local and hosted checks and received
independent code and documentation reviews. During release preparation, an
unrequested opt-in banner was added for a preview path. It obstructed browser
test interactions, causing hosted browser checks to fail. The banner and
handoff link were removed; local and hosted checks passed again before the
production merge. Stable and branch-specific preview channels created during
that detour were deleted.

**Proposed house rule for Anthony to approve:** when Anthony explicitly asks
to deploy production, use the full-replacement path. Do not add an opt-in
switch or a stable `next` channel unless he requests that release mode.
No instruction files were changed to adopt this proposal.

## Setup and verification accuracy

The repository instructions identify the production URL and the guarded
Hosting-only release workflow. The member and Admin interval is documented
as 30 seconds. `npm test` passed with 141 tests; `npm run test:browser`
passed with 77 tests. The hosted Firestore rules and browser checks passed.
The local synthetic lookup benchmark is illustrative only, not a production
traffic measurement.

## Survey

Survey declined/pending. No answers were available when this retro was
prepared.
