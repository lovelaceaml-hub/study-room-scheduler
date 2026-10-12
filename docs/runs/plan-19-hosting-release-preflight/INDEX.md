# Plan 19 run record: Hosting release preflight

Plan: [Plan 19](../../PLAN-19-hosting-release-preflight.md)

The original audited change was on local branch `cloud/release-read-only-smoke`,
commit `f80a164c16dfcd5c47e735a72d6ac4d39e5c295f`, based on merge commit
`35b5d0d`. The worktree was clean before that change. This release integrated
it with current main `42fdae58155ab47553132119ff5f868429cfbc21`; PR #15 merged
as `bf0141d0198e3ca94bc14100138b02b94884759e`.

## Evidence

| Lane | State | Evidence |
|---|---|---|
| S1: Add preview preflight | released | Real one-day Hosting preflight and post-release checks passed |
| S2: Verify and document | released | Local and hosted tests passed; handoff and release records updated |

- Original implementation checks: release-check 28 passed, main suite 138
  passed, browser suite 75 passed, Firestore emulator 2 passed, and deploy
  guard 24 passed.
- Current-main integration checks: release-check 28/28, main suite 141/141,
  browser suite 77/77, deploy guard 24/24, backend guard 34/34, workflow YAML
  parsed, and all changed JavaScript files passed `node --check`.
- Hosted PR checks passed in
  [run 38192561036](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/38192561036).
- The seven-day branch preview succeeded in
  [run 38192558281](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/38192558281).
  Its member, lobby TV, and Admin pages returned HTTP 200 in the read-only
  headless check.
- The production release passed in
  [run 38192834347](https://github.com/lovelaceaml-hub/study-room-scheduler/actions/runs/38192834347).
  The real one-day preflight URL was
  https://lvrooms--release-check-38192834347-85g4u1i3.web.app. The member page,
  Admin page, lobby TV, and current public schedule check passed before
  deployment and again afterward.
- The browser guard blocked an anonymous sign-up POST before sending it. No
  booking data, Functions, Firestore rules, or account settings were changed.

## Review

The complete sanitized change passed independent review with no actionable
findings before this release. A source follow-up confirmed the lobby
projection emits only valid room assignments and uses the scheduler's
validated time format. The real preflight confirmed the current public
schedule response also passes the check. The merged release adds no booking
behavior changes.

## Boundaries

Production is https://lvrooms.web.app. The production workflow deploys only
`hosting:app`; backend releases remain separate. The seven-day branch preview
and one-day release preflight both use the live backend, so only read-only
checks were run. Both channels expire automatically.
