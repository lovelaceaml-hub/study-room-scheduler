# Run: performance-2026-10

Plan ID: performance-2026-10
Plan file: docs/PLAN-performance.md
Runner: Copilot CLI
Started: 2026-10-11T19:16Z
Coordinator: Copilot CLI

## Baselines

| Repo | Path | Branch | Baseline HEAD |
|---|---|---|---|
| lovelaceaml-hub/study-room-scheduler | . | lovelaceaml-hub-performance-improvements | 8ec837af6ae56e2f75f8a588db508681974de17c |

## Lanes

| Lane | Title | State | Model | Worktree | Review | Depends on |
|---|---|---|---|---|---|---|
| S1 | Index schedule occupancy | done | Auto | current branch | pending | none |
| S2 | Reuse booking availability work | done | Auto | current branch | pending | S1 |
| S3 | Cache Admin search text | done | Auto | current branch | pending | none |
| S4 | Index Admin bookings | done | Auto | current branch | pending | S1 |
| S5 | Group TV bookings | done | Auto | current branch | pending | none |
| S6 | Sort TV bookings once | done | Auto | current branch | pending | S5 |
| S7 | Skip unchanged grid rendering | done | Auto | current branch | pending | S1 |
| S8 | Preserve deadline-only Admin updates | done | Auto | current branch | pending | none |
| S9 | Reduce unnecessary polling | done | Auto | current branch | pending | none |
| S10 | Cache parsed schedule times | done | Auto | current branch | pending | none |

## Folders

- lanes/: one file per lane (work order, result, review). Front matter fields: lane, title, state, model, runner, worktree, review, depends_on, updated.
- research/: attacker output and critique briefs.
- decisions/: decisions log and integration rulings.
- logs/: coordinator events, one file per event.
- board/: rule diagram page and generated lane board.

## Artifacts

- Rule diagram: pending
- Lane board: pending

<!-- lane: S1 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S2 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S3 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S4 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S5 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S6 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S7 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S8 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S9 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
<!-- lane: S10 state: done model: Auto worktree: current branch review: pending updated: 2026-10-12T00:20Z -->
