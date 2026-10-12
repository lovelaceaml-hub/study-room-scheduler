# Handoff: Study Room Scheduler

## Current status

The live app is https://lvrooms.web.app. On 2026-10-11, PR
[#15](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/15) merged
as `bf0141d0198e3ca94bc14100138b02b94884759e`. The guarded production
workflow succeeded in
[run 38192834347](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/38192834347).

The Hosting release workflow now deploys a uniquely named one-day preview,
checks the member page, Admin page, lobby TV, and current public schedule before
production, and stops if any check fails. It repeats those read-only checks
after publishing. The production release deployed `hosting:app` only; no
Functions or Firestore rules were deployed, and no booking data was changed.

## Live surfaces

- Reservations: https://lvrooms.web.app
- Lobby TV: https://lvrooms.web.app/tv.html
- Admin: https://lvrooms.web.app/admin/

The release preflight URL was
https://lvrooms--release-check-38192834347-85g4u1i3.web.app. It is an
automatically expiring one-day channel. The PR branch preview is
https://lvrooms--cloud-release-read-only-4b699c-g7bw2j6n.web.app; it expires
after seven days and uses the live backend. Do not book or edit reservations
from any preview.

## Decisions

- Member and Admin automatic schedule refreshes are 30 seconds apart instead
  of 15 seconds. User actions still trigger immediate refreshes.
- Admin polling pauses while its page is hidden. When the page becomes visible,
  it reloads immediately if the displayed schedule is at least 30 seconds old.
- The Admin session deadline update only repaints the deadline; it does not
  fetch schedule or note data.
- Release mode was full replacement, Hosting only. No banner or opt-in switch
  is part of the release.
- The one-day Hosting channel is used only for read-only preflight and expires
  automatically.

## Verification

The active plan and its `## Build log` are in
[`PLAN-19-hosting-release-preflight.md`](PLAN-19-hosting-release-preflight.md).
The completion record is
[`runs/plan-19-hosting-release-preflight/INDEX.md`](runs/plan-19-hosting-release-preflight/INDEX.md).
The performance release record is
[`RETRO-performance-2026-10.md`](RETRO-performance-2026-10.md). Repository
verification commands and release boundaries are in [`AGENTS.md`](../AGENTS.md).

The real preflight passed before production: the three pages and current lobby
schedule API were valid, and the headless browser reported no uncaught page
errors. The post-release check passed the same way. In both checks, the
read-only guard blocked an anonymous sign-up POST before sending it. The live
member, Admin, and TV pages also returned HTTP 200 after release.

No release steps remain. The backend release process is separate and was not
needed.
