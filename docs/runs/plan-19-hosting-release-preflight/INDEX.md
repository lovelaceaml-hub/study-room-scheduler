# Plan 19 run record: Hosting release preflight

Plan: [Plan 19](../../PLAN-19-hosting-release-preflight.md)

Baseline: local branch `cloud/release-read-only-smoke`, merge commit
`35b5d0d` (current `origin/main` merged). The worktree was clean before this
change. No production deployment, live-data mutation, or push was performed.

## Evidence

| Lane | State | Evidence |
|---|---|---|
| S1: Add preview preflight | verified | Workflow change, strict one-day URL check, read-only preflight |
| S2: Verify and document | verified | Tests, deploy guard, project docs and user guide |

- Release-check parser and page-check tests: 28 passed.
- Main test suite: 138 passed.
- Browser suite: 75 passed.
- Firestore rules emulator: 2 passed with Temurin 25 and Node 22.
- Deploy guard self-test: 24 checks passed, including the exact one-day preflight command.
- Workflow YAML and preview-parser syntax checks passed.
- No real Firebase preview deployment was attempted. The parser is covered by
  CLI-shaped fixture JSON; a real deployment URL remains unverified.

## Review

The complete sanitized change passed independent review with no actionable
findings. A source follow-up confirmed the lobby projection emits only valid
room assignments and uses the scheduler's validated time format. No live
reservation data was queried to confirm its current contents; malformed stored
rows stop the preflight.

## Boundaries

The production workflow change is not active until reviewed, committed, and
released. A branch push publishes a seven-day preview using live data. Obtain
Anthony's release choice before pushing. The workflow's temporary preflight
channel expires after one day.
