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

## New top layout 2026-11-13

The top of the member page follows Anthony's sketch, in the same colors and
fonts: a top bar (app icon, "Study Rooms" over "LV ZION", connection label, and
a round My reservations button showing your initials from your latest
reservation on that device), a full-width Study rooms / Whiteboards / TVs
switch, and slim day cards (weekday, date, month or "Today", a dot on days with
your reservation) in a row with arrows that scroll when the days do not fit.
The "Schedule" heading is gone and the Admin link sits below the schedule.
Merged as pull request #33 (`dbd8fce`) and released with `hosting:app` only in
[run 43460915584](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/43460915584).
No Functions, rules or booking data changed. Full suites were not ticked;
`test/app.smoke.mjs` passed 35 of 35 (a new test covers the day arrows) and
`test:release-check` 28 of 28. Afterwards the live page files matched `main`
and the live page showed the new top with "Live" status, read-only.

## Current-time line 2026-11-13

The member schedule shows a red line with a dot at the current time on today's
schedule while the rooms are open; it moves every 20 seconds by the church's
clock and is hidden on other days. Merged as pull request #31 (`34a980d`) and
released with `hosting:app` only in
[run 43456983451](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/43456983451).
No Functions, Firestore rules or booking data changed. Full suites were not
ticked; `test/app.smoke.mjs` passed 34 of 34 locally and the run's release
checker, guard self-test and read-only checks before and after publishing
passed. Afterwards the live `main.js` and `app.css` matched `main`.

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

## Improvements 2026-11-10 (live since 2026-11-11)

Merged as pull request #29 (`0e6d092`) and released with `hosting:app` only in
[run 43076646406](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/43076646406)
on 2026-11-11. No Functions or Firestore rules were deployed and no booking data
was changed. The full test suites were not ticked for this run; the release
checker, the guard self-test and the read-only page checks before and after
publishing all passed. Checked afterwards, read-only: the member page, `/admin/`,
`/tv.html` and `/api/lobby-schedule` returned 200, the live files match `main`
(including the Firebase 13.2.0 line and the new split files), and the new
headers are served (the member page refuses framing, the TV page does not).
Signed-in member and Admin actions were not exercised on the live site.

- **User manual:** new "Priority and Force override" section.
- **Screen-reader labels:** schedule blocks and time buttons now read out the
  words they show, in the same order ("B John, yours, Other, Room 1, ..."). The
  accessibility checker hold is lifted (`@axe-core/playwright` `^4.14.0`).
- **Security headers:** every file is sent with `X-Content-Type-Options` and
  `Referrer-Policy`; the member page can no longer be shown inside another site,
  like Admin. The lobby TV page is left embeddable on purpose, in case a
  signage tool shows it in a frame.
- **Firebase browser library:** 10.12.2 to 13.2.0 (`public/shared/firebase.js`).
  Checked on a local copy against the live schedule, read-only: the page loaded
  "Live" and the device kept the same anonymous identity across the change, so
  My reservations stays tied to each device.
- **Shared code:** status words are in `public/shared/labels.js`; the summary
  list, the connection banner and the "disabled" rule the sheets repeated are
  in `public/app/parts.js`.
- **Split files:** the booking sheet's markup moved to
  `public/app/booking-steps.js`; the Admin page's record helpers moved to
  `public/admin/records.js`. `admin.js` is still about 925 lines: the rest
  shares page state, and splitting it further should come with a full browser
  test run.
- **Pull requests:** #24 (preconnect) merged; draft #23 closed, replaced by #28.

**Checked:** every file parses, `test/rules.test.mjs` 19 of 19, and a demo-mode
walk through booking, My reservations and the Admin lock screen in a browser
with no page errors. **Browser suite:** Anthony approved one run of `npm run test:browser` on
2026-11-10. On commit `abfa8ca` it passed 76 of 77; the one failure was a test
still expecting the old label wording. That test was corrected and passed when
rerun by itself. The whole suite has not been run again since that fix.

## Full test suites need approval (2026-11-04)

No full test suite starts by itself any more. "Tests", both release workflows and
"Firebase preview" run them only when `full_suite_approved` is ticked, and it is
off by default. The Functions deploy hook in `firebase.json`, which used to run the
server tests on every deploy, is now a syntax check. Pull requests get only "Focused
checks": the guard self-test, the backend guard test and a JavaScript syntax check.

So a change can reach `main`, and go live, with no booking, page or database test
having run. Ask Anthony to approve the suites before a backend release in
particular; `README.md` "Releasing" says what an unticked release gives up.

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
