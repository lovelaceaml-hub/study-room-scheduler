# Handoff: Study Room Scheduler

## Current status

The performance improvements are live at https://lvrooms.web.app. Pull request
[#19](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/19) was
merged, and the guarded Firebase Hosting-only release succeeded. No Functions
or Firestore rules were deployed.

Pull request
[#15](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/15) adds a
one-day Hosting preview and read-only member, Admin, lobby TV, and live-schedule
checks before production, plus the same checks after release. The preview and
checks do not write to live bookings. This change is being integrated with the
newer production performance release before publication.

## Decisions

- Member and Admin automatic schedule refreshes are 30 seconds apart instead
  of 15 seconds. User actions still trigger immediate refreshes.
- Admin polling pauses while its page is hidden. When the page becomes visible,
  it reloads immediately if the displayed schedule is at least 30 seconds old.
- The Admin session deadline update only repaints the deadline; it does not
  fetch schedule or note data.
- Release mode is full replacement, Hosting only. No banner or opt-in switch
  is part of this release.
- The one-day Hosting channel is used only for read-only preflight and expires
  automatically.

## Verification

The active plan and its `## Build log` are in
[`PLAN-19-hosting-release-preflight.md`](PLAN-19-hosting-release-preflight.md).
The preflight completion record is
[`runs/plan-19-hosting-release-preflight/INDEX.md`](runs/plan-19-hosting-release-preflight/INDEX.md).
The performance release record is
[`RETRO-performance-2026-10.md`](RETRO-performance-2026-10.md). Repository
verification commands and release boundaries are in [`AGENTS.md`](../AGENTS.md).

The current production site was released from the latest `main` and serves
HTTP 200 at the member, Admin, and lobby TV URLs. The actual one-day preflight
and post-release checks remain pending until the release workflow runs with
this change.

## Next

Merge the reviewed preflight change through PR #15, then run the GitHub
**Firebase release (production)** workflow on `main`. Do not deploy Functions,
Firestore rules, or other Firebase resources for this Hosting-only change.
