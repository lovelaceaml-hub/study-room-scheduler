# Handoff

## Current status

The performance improvements are live at https://lvrooms.web.app. Pull request
[#19](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/19) was
merged, and the guarded Firebase Hosting-only release succeeded. Production
serves the merged `main` version. No Functions or Firestore rules were
deployed.

## Decisions

- Member and Admin automatic schedule refreshes are 30 seconds apart instead
  of 15 seconds. User actions still trigger immediate refreshes.
- Admin polling pauses while its page is hidden. When the page becomes visible,
  it reloads immediately if the displayed schedule is at least 30 seconds old.
- The Admin session deadline update already only repaints the deadline; it
  does not fetch schedule or note data.
- Release mode was a full replacement, Hosting only. No banner or opt-in
  switch is part of the release.
- Temporary preview channels created during release preparation were removed.

## Verification

The performance plan and its `## Build log` are in
[`PLAN-performance.md`](PLAN-performance.md). The release record is
[`RETRO-performance-2026-10.md`](RETRO-performance-2026-10.md). The
repository contract's commands are in [`AGENTS.md`](../AGENTS.md). Local and
hosted unit, browser, and Firestore rules checks passed. The live homepage
returned HTTP 200 and matched the merged source.

## Next work

No remaining release steps. The normal backend release process remains
separate and was not needed for this Hosting-only change.
