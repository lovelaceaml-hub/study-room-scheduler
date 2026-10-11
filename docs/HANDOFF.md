# Handoff

## Current status

The app is live at https://lvrooms.web.app. This branch improves schedule
rendering and availability lookups, caches Admin lookups, reduces repeat
render work, and lowers automatic schedule refresh frequency. Pull request
checks and the read-only preview are running. Production has not been changed.

## Decisions

- Member and Admin automatic schedule refreshes are 30 seconds apart instead
  of 15 seconds. User actions still trigger immediate refreshes.
- Admin polling pauses while its page is hidden. When the page becomes visible,
  it reloads immediately if the displayed schedule is at least 30 seconds old.
- The Admin session deadline update already only repaints the deadline; it
  does not fetch schedule or note data.
- Feature branch preview deployments use live backend services and are for
  read-only inspection.

## Verification

The performance plan and its `## Build log` are in
[`PLAN-performance.md`](PLAN-performance.md). The repository contract's
commands are in [`AGENTS.md`](../AGENTS.md). The full unit and browser suites
passed, and independent code and documentation reviews found no issues. A
read-only preview walkthrough can confirm member booking, Admin search and
map, and the TV's current and future room cards.

## Next work

Review the pull request checks and inspect its preview read-only. Production
release remains separate and requires the documented release process.
