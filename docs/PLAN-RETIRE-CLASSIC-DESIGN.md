# LV Zion Study Rooms: Plan 5, retire the current app design

Plan ID: `2026-09-19-retire-classic-design`
Project: `/Users/anthony/Projects/study-room-scheduler`
Live app: https://lvrooms.web.app
Approved route: Anthony, 2026-09-19, "Route 2, full removal, multi lane, Opus writes, Fable reviews and completes, Luna for small details."

## Goal line

Discontinue the current app design. When someone opens the app they select one of the six new designs (Solace, Velum, Cove, Petal, Atlas, Lattice). Solace is the default design. Nothing a member or Admin can do today is lost.

Every kickoff, work order, and review quotes this goal line and checks the work against it first.

## Models, effort, agents, reviewers

- Writer for every build lane: Claude Opus 5, high effort, as a helper subagent in its own worktree (Anthony's explicit choice; this overrides the usual "never Opus for fan-out" default for this plan only).
- Small details and refinement passes: Codex `gpt-5.6-luna` through `codex-dispatch`, only when the Codex pool has headroom at preflight. If it does not, the detail goes back to the lane's Opus writer.
- Coordinator, landing reviews, completion review, integration, release: Fable 5.1 (writes no feature code; small mechanical glue only).
- Hygiene sweep before each review: Haiku 4.5, low.
- Critic (Lane 0): `gpt-5.6-sol`, high, read-only. Fallback when the Codex pool refuses: Sonnet 5, high, read-only.
- Review sizing: church app real people use, so two review rounds (one landing round per lane, one completion round at integration).

Runner: coordinator

## Settled decisions

1. People who already chose one of the six designs keep their choice. People with no choice, or a stored choice of `classic`, see the six-design picker.
2. The picker has no "keep the current design" option. Solace is listed first, carries a visible "Default" mark, and has initial focus. Closing the picker (close button, Escape, backdrop) selects Solace.
3. `/?classic=1` stops showing the old look. With `tab=mine` it forwards to the person's design with My reservations open; otherwise it forwards to the person's design, or the picker.
4. My reservations, Cancel, and End early are built inside each of the six designs, in that design's own look, using the existing `cancelOwnedBooking` and `endOwnedBookingEarly` functions and the `myBookings` state in `/Users/anthony/Projects/study-room-scheduler/experiences/shared/live.js`.
5. Each design opens My reservations when its URL carries `?view=mine`. This is the shared deep-link contract.
6. Admin moves to its own page, `/admin/`, which keeps the existing Admin screens and logic unchanged in behavior. It is not one of the six designs and is not linked from member screens except a small "Admin" link in each design's footer navigation. Admin keeps the existing server-validated session; no credential is read, copied, or logged.
7. No backend change. No Functions, Firestore rules, indexes, Authentication, or `legacy` Hosting target deploy. Release scope is `hosting:app` only. If a lane finds it needs a backend change, it stops and asks one question.
8. The lobby TV (`/tv.html`) and the September 21 special schedule behavior are unchanged.
9. Production member data never enters fixtures, screenshots, logs, or agent prompts. All tests use the fictional mocked Firebase already in `/Users/anthony/Projects/study-room-scheduler/test/`.
10. The untracked file `/Users/anthony/Projects/study-room-scheduler/docs/prototype-reserve-now.html` and the original Atlas and Lattice prototypes under `/Users/anthony/Projects/study-room-scheduler/design/` are preserved untouched.

## Visual authority

The six live designs are the visual authority. "My reservations" in each design must look like it belongs to that design: reuse that design's existing tokens, type, buttons, sheets, and spacing. After Lane 1 lands the Solace My reservations screen, the coordinator shows Anthony a side-by-side (current My reservations screen versus Solace My reservations) with a real preview link before Lanes 2 and 3 start. This is a required stop.

## Branches and worktrees

- Integration branch: `change/retire-classic-design`, created from `main` at the baseline below.
- Each lane: `lane/2026-09-19-retire-classic-design/<lane-id>` in `/Users/anthony/.claude/worktrees/2026-09-19-retire-classic-design/<lane-id>`.
- Nothing merges to `main` and nothing deploys to production until Anthony answers the release question in Lane 5.

## Lanes

### Lane 0: Critic
Setup: frontier · high (fallback: balanced · high) · Lane: Codex · Review: none
  Claude: Sonnet 5 · high
  Codex:  gpt-5.6-sol · high  (fallback: Claude Sonnet 5 · high)
  Antigravity: none
Worktree: none, read-only
Depends on: none
Agents: none
Reviewers: none (the critic is the reviewer)
Hygiene: none

Argue against this plan: missing decisions, unsafe assumptions, untestable acceptance criteria, scope creep, rollback gaps, anything too ambiguous for a writer. Output goes to `/Users/anthony/Projects/study-room-scheduler/docs/runs/2026-09-19-retire-classic-design/research/L0-critique.md`. Launches alongside Lane 1 and Lane 4. Never blocks them.

### Lane 1: Shared contract, picker, and Solace My reservations
Setup: frontier · high · Lane: Claude · Review: controller
  Claude: Opus 5 · high  (fallback: Sonnet 5 · high)
  Codex:  gpt-5.6-luna for small details only
  Antigravity: none
Worktree: `/Users/anthony/.claude/worktrees/2026-09-19-retire-classic-design/L1`
Depends on: none
Agents: none
Reviewers: controller=Claude Fable 5.1; independent=none
Hygiene: Haiku 4.5 · low sweep before review

Owns (only these paths, all under `/Users/anthony/Projects/study-room-scheduler/` in its worktree):
- `design-choice.js`, `design-choice.css`
- `experiences/shared/live.js`, `experiences/shared/model.js`
- `experiences/solace/` (all files)
- `test/member-design-smoke.mjs`, `test/live-model.test.mjs`, and a new `test/design-choice.test.mjs`

Work:
1. Picker: implement settled decisions 1, 2, and 3 in `design-choice.js`. Remove the classic option, the "Change design" masthead injection for the classic page, and every path that stores `classic`. A stored `classic` is treated as no choice. Keep the `tv`, `test=1`, and `demo=1` behavior.
2. Shared: confirm `subscribe` state exposes `myBookings` with `canCancel` and `canEndEarly`, and add any small helper the designs need to list a person's upcoming and past reservations and the valid earlier end times for End early (30-minute boundaries, later than start, earlier than current end). Put pure helpers in `model.js` with tests. Do not change the callable names or payloads.
3. Solace: add a My reservations view opened by the footer link and by `?view=mine`. It lists the person's reservations (date, time, room or board or TV, reserved-for detail), with Cancel (confirmation step) and End early (choose an earlier end, confirmation step), loading, empty, error, and reconnecting states. Replace the three `/?classic=1` links in `experiences/solace/index.html` and `solace.js`: My reservations goes to the in-design view, "Current app" is removed, detail-sheet Cancel and End early act in place or open the in-design view. Add a small "Admin" link to `/admin/` in the footer navigation.
4. Tests: behavior tests, not source regexes. Picker rules (no choice, stored design, stored `classic`, close selects Solace, `?choose=1`, `?classic=1&tab=mine`), model helpers, and a Solace My reservations journey in the design smoke with fictional data: list, cancel, end early, empty state.

Acceptance: `npm test`; `node --test test/live-model.test.mjs test/design-choice.test.mjs`; `node test/member-design-smoke.mjs` all pass. Solace contains no `classic` link. Keyboard and screen-reader reachable; 44px touch targets; no horizontal scroll at 360px width.

Required stop after landing: coordinator shows Anthony the side-by-side and preview link (see Visual authority).

### Lane 2: Velum, Cove, and Petal My reservations
Setup: frontier · high · Lane: Claude · Review: controller
  Claude: Opus 5 · high  (fallback: Sonnet 5 · high)
  Codex:  gpt-5.6-luna for small details only
  Antigravity: none
Worktree: `/Users/anthony/.claude/worktrees/2026-09-19-retire-classic-design/L2`
Depends on: L1 landed and Anthony's go-ahead on the Solace screen
Agents: none
Reviewers: controller=Claude Fable 5.1; independent=none
Hygiene: Haiku 4.5 · low sweep before review

Owns: `experiences/velum/`, `experiences/cove/`, `experiences/petal/` (all files). Branches from the landed L1 commit. Reads but never edits `experiences/shared/` and `experiences/solace/`; a needed shared change is a request to the coordinator, not an edit.

Work: for each of the three designs, the same My reservations view, `?view=mine` deep link, in-place Cancel and End early, removal of every `/?classic=1` link, removal of "Current app", and the footer "Admin" link, following the Solace reference for behavior and each design's own look for appearance. Add each design's My reservations journey to a new `test/member-mine-smoke-l2.mjs` (new file, so it does not collide with Lane 1's or Lane 3's test files).

Acceptance: `node test/member-mine-smoke-l2.mjs` and `node test/member-design-smoke.mjs` pass; no `classic` string remains in the three folders; same accessibility bar as Lane 1.

### Lane 3: Atlas and Lattice My reservations
Setup: frontier · high · Lane: Claude · Review: controller
  Claude: Opus 5 · high  (fallback: Sonnet 5 · high)
  Codex:  gpt-5.6-luna for small details only
  Antigravity: none
Worktree: `/Users/anthony/.claude/worktrees/2026-09-19-retire-classic-design/L3`
Depends on: L1 landed and Anthony's go-ahead on the Solace screen
Agents: none
Reviewers: controller=Claude Fable 5.1; independent=none
Hygiene: Haiku 4.5 · low sweep before review

Owns: `experiences/atlas/`, `experiences/lattice/` (all files), and a new `test/member-mine-smoke-l3.mjs`. Same work and acceptance as Lane 2 for these two designs. The Lattice brand link that points at `/?classic=1` becomes a link to the design's own home.

### Lane 4: Admin gets its own page
Setup: frontier · high · Lane: Claude · Review: controller
  Claude: Opus 5 · high  (fallback: Sonnet 5 · high)
  Codex:  gpt-5.6-luna for small details only
  Antigravity: none
Worktree: `/Users/anthony/.claude/worktrees/2026-09-19-retire-classic-design/L4`
Depends on: none
Agents: none
Reviewers: controller=Claude Fable 5.1; independent=none
Hygiene: Haiku 4.5 · low sweep before review

Owns: a new folder `admin/` (`admin/index.html`, `admin/admin.js`, `admin/admin.css`) and a new `test/admin-smoke.mjs`. Reads but never edits `app.js`, `styles.css`, `tokens.css`, `index.html`.

Work: build `/admin/` as a standalone page that carries over the existing Admin experience from `app.js` (lock screen, header and date selection, request queue, day overview and list, add form, housekeeping, every `adminBookingAction` case including end-early, the `adminSchedule` read with the existing session token handling). Copy the Admin code and the helpers it needs into `admin/admin.js`; leave out the member tabs (Home, Reserve, My reservations) and the design picker. Behavior, callable names, payloads, and session handling stay identical. Styling may copy the needed rules from `styles.css` and `tokens.css` into `admin/admin.css` so the page stands alone after the old files are deleted. The page never shows, stores in new places, or logs the Admin credential.

Acceptance: `node test/admin-smoke.mjs` passes with mocked callables and fictional data, covering lock, unlock with a mocked session, day list, add, cancel, end early, and lock again. `node --check admin/admin.js` passes. The page works with `app.js` and `styles.css` absent.

### Lane 5: Integration, removal, release
Setup: frontier · high · Lane: Claude · Review: controller + completion round
  Claude: Fable 5.1 coordinates; Opus 5 · high writes the removal and test updates; Luna for small details
  Codex:  gpt-5.6-luna for small details only
  Antigravity: none
Worktree: shared, single writer, on `change/retire-classic-design`
Depends on: L1, L2, L3, L4 landed and reviewed; L0 findings ruled on
Agents: one Opus 5 writer, sequential
Reviewers: controller=Claude Fable 5.1 (completion review of the whole diff against the baseline); independent=none unless Anthony asks
Hygiene: Haiku 4.5 · low sweep before the completion review

Work:
1. Merge L1, then L4, then L2, then L3 into `change/retire-classic-design`. Correct accepted landing-review and Lane 0 findings here.
2. Root page: `index.html` becomes a minimal shell that loads `design-choice.js` only (forward to the stored design, otherwise show the picker). Remove `app.js`, `styles.css`, `special-schedule-entry.js` and any other file that only the old member screens used, after confirming with a repository search that nothing else (TV, designs, Admin page, tests, service worker) loads them. `tokens.css` stays if the TV or picker uses it.
3. Service worker: bump the cache name in `sw.js`, update its file list to the new file set including `/admin/` and the six designs' current files, and make sure the old cached classic shell is dropped on activate.
4. `manifest.json` start URL still opens `/` and lands on the picker or the stored design.
5. Tests: retire or rewrite `test/ui-smoke.mjs` and `test/confirm-popup-smoke.mjs` for the new entry flow, fold the two lane smoke files into one run, update `package.json` scripts so `npm test` no longer checks deleted files. Full suite must pass: `npm test`; `node --test test/live-model.test.mjs test/design-choice.test.mjs functions/test/public-lobby-schedule.test.js`; `npm run test:cutover`; every design and mine smoke; `node test/admin-smoke.mjs`; `node test/tv-smoke.mjs`.
6. Human-like browser walkthrough on a local preview with the mocked fixture: first visit picker with Solace default, close selects Solace, each design's reserve flow, My reservations, Cancel, End early, Change design, Admin page, TV page, 360px and desktop widths, light and dark.
7. Docs: `README.md` quick links, `AGENTS.md`, `docs/HANDOFF.md`, `docs/USER-MANUAL.md`, `/Users/anthony/Projects/README.md` row, this plan's Build log, and the run record tree.
8. Release: ask Anthony the release question from the `live-app-release` skill (full replace, or opt-in switch on a Firebase preview channel named `next`). The compatibility gate passes because there is no backend or data-shape change. Deploy only `hosting:app` with the project's normal deploy command. Then a read-only production smoke, commit, merge to `main`, push, and the private GitHub backup check.
9. Cleanup: remove merged lane worktrees and branches; ledger rows for every agent run.

Rollback: redeploy the baseline commit `61ebf4b` to `hosting:app`. No data or backend change exists to undo. A stored design choice in a browser stays valid under the old build.

## Out of scope

Backend changes, new designs, changes to booking policy, the LV Zion `/rooms` board in the `preaching` project, the `legacy` Hosting target, and any change to the lobby TV.

## Build log

- 2026-09-19: Plan drafted by Fable 5.1 from Anthony's request and route choice. Provisional completion-review baseline: `61ebf4b3ff6e4e7b4f6618bd70551fc958b0eebd` on `main`, tree clean except the preserved untracked file `docs/prototype-reserve-now.html` (not sensitive, not touched by any lane). Storage method for the dirty-work baseline: none needed beyond that note. No implementation has started.
- 2026-09-19: Coordinator run started (Fable 5.1, runner coordinator). Gate passed at 1ea6b15. L0 critic (gpt-5.6-sol, high, read-only) returned 11 objections, all accepted; rulings at `/Users/anthony/Projects/study-room-scheduler/docs/runs/2026-09-19-retire-classic-design/decisions/L0-rulings.md`. Corrections for the September 21 Admin schedule, root `tv`/`demo`/`test`/`tab=admin` routing, service worker registration, and the full My reservations parity matrix were sent to the L1 and L4 writers mid-run.
- 2026-09-19: L4 landed (Opus 5 helper), landing review by Fable 5.1 passed: 21 mocked smoke checks, function-by-function comparison against app.js (83 of 113 identical, the rest member-code removal or the September 21 rules). Commit 91ca785.
- 2026-09-19: L1 landed (Opus 5 helper), landing review by Fable 5.1 passed: 34 unit tests, design smoke 7 of 8 (Petal 390px overflow fails at baseline too, caused by the third eligible day; assigned to L2). Commit 3fe7dc2. Known limits recorded by the writer: pending shows "Pending review" instead of a queue position (needs backend data, out of scope); classic activity feed not carried (a view, not an action). Setup line was right.
- 2026-09-19: L1 then L4 merged into `change/retire-classic-design` (dc3e7fe). Preview channel `solace-mine` deployed for hosting target app only: https://lvrooms--solace-mine-oew6xrq0.web.app (expires 2026-09-26). Production verified unchanged. Pre-existing baseline failure for L5: `functions/test/policy.test.js` expects the old "Tuesday or Saturday" wording. Required stop 1 reached: waiting for Anthony's go-ahead on the Solace My reservations screen before L2 and L3.
- 2026-09-19: Required stop 1 answered by Anthony: "Yes, build the rest." L2 and L3 launched from the integration branch. L0 ruling 7 applied: L2 owns test/member-mine-smoke-l2.mjs, L3 acceptance runs test/member-mine-smoke-l3.mjs. Petal 390px overflow fix assigned to L2.
