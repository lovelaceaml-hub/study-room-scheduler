# Handoff

## Current status

The app is live at https://lvrooms.web.app. This branch improves schedule
rendering and availability lookups, caches Admin lookups, reduces repeat
render work, and lowers automatic schedule refresh frequency. A full
production release has been requested. The PR update removes the unnecessary
opt-in preview banner; its local unit and browser suites pass, and hosted
checks must pass before merging. Production has not yet been changed.

## Decisions

- Member and Admin automatic schedule refreshes are 30 seconds apart instead
  of 15 seconds. User actions still trigger immediate refreshes.
- Admin polling pauses while its page is hidden. When the page becomes visible,
  it reloads immediately if the displayed schedule is at least 30 seconds old.
- The Admin session deadline update already only repaints the deadline; it
  does not fetch schedule or note data.
- Release mode is a full replacement, Hosting only. No banner or opt-in
  switch is part of this release.

## Verification

The performance plan and its `## Build log` are in
[`PLAN-performance.md`](PLAN-performance.md). The repository contract's
commands are in [`AGENTS.md`](../AGENTS.md). The full unit and browser suites
passed locally after removing the temporary preview banner. Independent code
and documentation reviews found no issues in the performance changes.

## Next work

Merge the PR after its hosted checks pass, then run the documented
Hosting-only production release workflow on `main`.
