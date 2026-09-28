# Study Rooms: remove extra design copy

## Outcome

Remove decorative welcome, promotional, and introductory copy from all six
member design experiences while preserving functional schedule, booking,
status, navigation, and accessibility text. The layouts must remain balanced
after the copy is removed.

## Baseline and boundary

- Repository: `/Users/anthony/Projects/study-room-scheduler`
- Starting branch: `main`
- Starting HEAD: `a71f159c04d983fc2fd6f333bbf7809b66ca36c3`
- Pre-existing user file: `/Users/anthony/Projects/study-room-scheduler/docs/prototype-reserve-now.html`, SHA-256 `98a5cf059e3ff678231ed2d7f85e66fbdf827dbe517c6db47dffc037c3a6c9fa` (not in scope and must remain untouched)
- Production boundary: the initial plan held deployment. The user later authorized release, limited to Firebase Hosting target `app`; do not deploy Functions or other Firebase surfaces.
- Protected: shared transport/model, classic app, booking behavior, Firebase configuration, original prototypes, and all unrelated dirty work.

## Runner and review

Runner: coordinator

- Implementation: six independent Codex lanes, one per design folder, `gpt-6-astra` at high effort, fallback `gpt-5.6-terra` at high effort.
- Controller: Sol, `gpt-6-astra` at high effort, reviews the cumulative diff and rendered/source evidence after all lanes land.
- Independent review: none, because this is a bounded copy-only change with no backend, data, or deployment scope.
- Hygiene: inspect changed paths, `git diff --check`, and targeted copy searches before controller review.

## Lanes

### Lane A: Atlas copy cleanup

Setup: `gpt-6-astra` · high (fallback: `gpt-5.6-terra` · high) · Lane: Codex · Review: controller
Worktree: `/Users/anthony/Projects/.worktrees/study-room-copy-cleanup-atlas`
Depends on: none
Agents: none
Owns: `/Users/anthony/Projects/study-room-scheduler/experiences/atlas/`
Acceptance: Remove the `Reserve with confidence` eyebrow, `Find the right space for the right moment.` heading, and the calmer-view lead paragraph. Keep the schedule, status, navigation, and booking copy working with no empty decorative gap.
Verify: `git diff --check`; targeted search for those exact strings; existing focused tests from integration.

### Lane C: Cove copy cleanup

Setup: `gpt-6-astra` · high (fallback: `gpt-5.6-terra` · high) · Lane: Codex · Review: controller
Worktree: `/Users/anthony/Projects/.worktrees/study-room-copy-cleanup-cove`
Depends on: none
Agents: none
Owns: `/Users/anthony/Projects/study-room-scheduler/experiences/cove/`
Acceptance: Remove decorative intro and invitation copy that only markets the experience. Keep the resource/date controls, schedule guidance, Reserve Now action, status/error text, and member navigation. Preserve usable spacing on phone and desktop.
Verify: `git diff --check`; source search and local render inspection; existing focused tests from integration.

### Lane L: Lattice copy cleanup

Setup: `gpt-6-astra` · high (fallback: `gpt-5.6-terra` · high) · Lane: Codex · Review: controller
Worktree: `/Users/anthony/Projects/.worktrees/study-room-copy-cleanup-lattice`
Depends on: none
Agents: none
Owns: `/Users/anthony/Projects/study-room-scheduler/experiences/lattice/` (integration also removes the dynamic `dayEyebrow` updater in `lattice.js` because it rendered the redundant Example 3 schedule eyebrow)
Acceptance: Remove the `Room availability, mapped.` hero heading, the `See the whole floor at once...` paragraph, and the redundant dynamic date-schedule eyebrow. Keep the date/resource controls, schedule title/hint, status, and booking flow with no empty decorative gap.
Verify: `git diff --check`; targeted search for those exact strings; existing focused tests from integration.

### Lane P: Petal copy cleanup

Setup: `gpt-6-astra` · high (fallback: `gpt-5.6-terra` · high) · Lane: Codex · Review: controller
Worktree: `/Users/anthony/Projects/.worktrees/study-room-copy-cleanup-petal`
Depends on: none
Agents: none
Owns: `/Users/anthony/Projects/study-room-scheduler/experiences/petal/`
Acceptance: Remove the decorative greeting and promotional action-bar copy while retaining dates, schedule, status, Reserve Now, navigation, and accessible labels. Preserve phone/desktop composition.
Verify: `git diff --check`; source search and local render inspection; existing focused tests from integration.

### Lane S: Solace copy cleanup

Setup: `gpt-6-astra` · high (fallback: `gpt-5.6-terra` · high) · Lane: Codex · Review: controller
Worktree: `/Users/anthony/Projects/.worktrees/study-room-copy-cleanup-solace`
Depends on: none
Agents: none
Owns: `/Users/anthony/Projects/study-room-scheduler/experiences/solace/`
Acceptance: Remove the decorative welcome and invitation copy while retaining the schedule, date/resource controls, Reserve Now action, status/error text, navigation, and accessible labels. Preserve phone/desktop composition.
Verify: `git diff --check`; source search and local render inspection; existing focused tests from integration.

### Lane V: Velum copy cleanup

Setup: `gpt-6-astra` · high (fallback: `gpt-5.6-terra` · high) · Lane: Codex · Review: controller
Worktree: `/Users/anthony/Projects/.worktrees/study-room-copy-cleanup-velum`
Depends on: none
Agents: none
Owns: `/Users/anthony/Projects/study-room-scheduler/experiences/velum/`
Acceptance: Remove `Welcome. Make yourself at home.`, `A little space. A meaningful moment.`, and `Find a quiet place for what matters.`. Keep the calendar, schedule guidance, booking flow, and functional status/navigation copy, with balanced spacing.
Verify: `git diff --check`; targeted search for those exact strings; existing focused tests from integration.

## Build log

- 2026-09-12: Planned as six independent copy-cleanup lanes from HEAD `a71f159`; existing untracked prototype file recorded and excluded.
- 2026-09-12: LA, LC, LL, LP, LS, and LV landed in isolated worktrees. The Solace lane was completed by the controller after its agent hit a local approval block; no product ambiguity remained.
- 2026-09-12: Lattice's dynamic `dayEyebrow` was also removed after rendered inspection confirmed it was the redundant date-schedule line from Example 3.
- 2026-09-12: `npm test` passed 17/17 policy tests; live-model and public-lobby tests passed 7/7; cutover tests passed 3/3; UI smoke, confirmation-popup smoke, TV smoke, and six-design member smoke all passed. Browser tests required the approved localhost execution boundary.
- 2026-09-12: Controller review found no material findings. Phone and desktop evidence show the promotional blocks absent, no horizontal overflow, and working Reserve Now flows. The pre-existing prototype file remains untouched.
- 2026-09-12: Additional live-audit copy was removed from Cove, Petal, Solace, and Velum, then committed as `76a4d5d`. Firebase Hosting target `app` was released from that commit. Post-release checks on the chooser and all six `?demo=1` routes found none of the requested phrases, no alert errors, Reserve Now controls present, and no desktop overflow.
- 2026-09-12: Removed the illustrative `Wren Davis` and full-name placeholder text from the shared and all six member reservation forms. Source search and the six-design browser smoke passed before the Hosting-only release.
