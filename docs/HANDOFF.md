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

## Backend release 2026-11-04

All 10 Functions on `main` (`02e04a9`) were released to `lvz-rooms` by the
backend release workflow in
[run 41897349215](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/41897349215).
This is the first successful run of that workflow. It carries the Functions
dependency update (the security advisories in PRs #25 and #26) and the small
tidy-up in `functions/lib/actions.js`.

- **Not released:** Firestore rules (unticked, unchanged) and Hosting. No booking
  or note data was changed.
- **Tests in the run:** `npm test` 141 of 141, `test:rules` 2 of 2, server tests
  again at deploy 105 of 105. Anthony approved these for this run.
- **Checked afterwards, read-only:** the member page, `/admin/`, `/tv.html` and
  `/api/lobby-schedule` returned 200. The drift check in
  [run 41898106422](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/41898106422)
  reported all 10 Functions "same". Signed-in member and Admin actions were not
  exercised.

**Hosting release, same day.** `main` (`02e04a9`) went live with `hosting:app` only
in [run 41904705581](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/41904705581),
which includes the My reservations fix. Tests passed: `npm test` 141 of 141,
`test:browser` 77 of 77, `test:release-check` 28 of 28. The preview and live page
checks passed, and the live `mine.js` and `details.js` now match `main`. Anthony
approved both Hosting runs and their tests.

The first attempt, [run 41901214042](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/41901214042),
stopped at the preview step with nothing published. `firebase-tools` 15.34.1
(2026-10-22) added a check that the Hosting API is on, and the deploy account
`gh-hosting-deploy@lvz-rooms` had only `roles/firebasehosting.admin`, which does
not allow it. Adding `roles/serviceusage.serviceUsageConsumer` was the only change
before the rerun passed. The step sends the tool's error to a file, so the actual
message was never seen; the cause is inferred from the tool's source and that
result.

**Same gap in the other apps:** `gh-hosting-deploy` in `lv-zion-duties` and
`lv-wm-prayer` lacks this permission too, and both repositories use
`firebase-tools@15`. Their next Hosting releases may stop the same way.

**Keyless setup is finished.** `ops/cloud-shell/backend-deploy-wif.sh` was run on
2026-11-04 and this repository has its four variables, so the weekly drift check
now really compares. Before this it passed each week without checking anything.
The script can stop with "Service account ... does not exist" just after creating
an account, because Google needs a moment to catch up; running it again is safe.
It also changed the image cleanup in `lv-zion-duties` from 3 days to 1 day. The
identities for `worship-duty-app` and `morning-prayer-app` exist, but those
repositories do not have their variables yet, so nothing can use them.

**Known gaps against Anthony's full-suite rule:** the backend release workflow runs
`npm test` and `test:rules` but has no `full_suite_approved` input. The "Tests"
workflow starts every suite on every pull request, even a docs-only one; the rule
says full suites must not start automatically on pull-request updates.

## Live surfaces

- Reservations: https://lvrooms.web.app
- Lobby TV: https://lvrooms.web.app/tv.html
- Admin: https://lvrooms.web.app/admin/

The release preflight URL was
https://lvrooms--release-check-38192834347-85g4u1i3.web.app. It is an
automatically expiring one-day channel. The seven-day PR review preview was
deleted after the release. Future user-facing review previews are manual-only
and require an explicit confirmation that a visible UI change needs review.
The deleted review preview and the required one-day automated preflight use
the live backend, so never book or edit reservations from either.

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
- User-facing review previews are manually launched only for visible UI
  changes; a non-visual fix goes through the normal production release without
  publishing a review preview.

## Verification

The latest plan (complete; no plan is active now) and its `## Build log` are in
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

That record covers the 2026-10-11 Hosting release. For what is still open, see
"Backend release 2026-11-04" above.

## Review 2026-11-03

A whole-repo review is in [`reviews/2026-11-03-review.md`](reviews/2026-11-03-review.md):
ranked refactor ideas, dependency status, and decisions left for Anthony. Its
pull request updated dependencies; the Functions part went live in the backend
release of 2026-11-04.
