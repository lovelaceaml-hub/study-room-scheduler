# Run: 2026-09-12-remove-extra-copy

Plan ID: 2026-09-12-remove-extra-copy
Plan file: /Users/anthony/Projects/study-room-scheduler/docs/PLAN-REMOVE-EXTRA-COPY.md
Runner: coordinator
Started: 2026-09-12T18:09Z
Coordinator: Sol

## Baselines

| Repo | Path | Branch | Baseline HEAD |
|---|---|---|---|
| study-room-scheduler | /Users/anthony/Projects/study-room-scheduler | main | a71f159c04d983fc2fd6f333bbf7809b66ca36c3 |

## Lanes

| Lane | Title | State | Model | Worktree | Review | Depends on |
|---|---|---|---|---|---|---|
| LA | Atlas copy cleanup | merged | gpt-6-astra | /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-atlas | controller | none |
| LC | Cove copy cleanup | merged | gpt-6-astra | /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-cove | controller | none |
| LL | Lattice copy cleanup | merged | gpt-6-astra | /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-lattice | controller | none |
| LP | Petal copy cleanup | merged | gpt-6-astra | /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-petal | controller | none |
| LS | Solace copy cleanup | merged | gpt-6-astra | /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-solace | controller | none |
| LV | Velum copy cleanup | merged | gpt-6-astra | /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-velum | controller | none |

## Folders

- lanes/: one file per lane (work order, result, review). Front matter fields: lane, title, state, model, runner, worktree, review, depends_on, updated.
- research/: attacker output and critique briefs.
- decisions/: decisions log and integration rulings.
- logs/: coordinator events, one file per event.
- board/: rule diagram page and generated lane board.

## Artifacts

- Rule diagram: not needed for this copy-only run
- Lane board: generated after integration

## Integration result

All six lanes merged into `main`. Controller review found no material findings. No deployment was performed. The pre-existing `/Users/anthony/Projects/study-room-scheduler/docs/prototype-reserve-now.html` remained outside the change set.

<!-- lane: LA state: merged model: gpt-6-astra worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-atlas review: controller updated: 2026-09-12T18:19Z -->
<!-- lane: LC state: merged model: gpt-6-astra worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-cove review: controller updated: 2026-09-12T18:19Z -->
<!-- lane: LL state: merged model: gpt-6-astra worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-lattice review: controller updated: 2026-09-12T18:19Z -->
<!-- lane: LP state: merged model: gpt-6-astra worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-petal review: controller updated: 2026-09-12T18:19Z -->
<!-- lane: LS state: merged model: gpt-6-astra worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-solace review: controller updated: 2026-09-12T18:19Z -->
<!-- lane: LV state: merged model: gpt-6-astra worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-velum review: controller updated: 2026-09-12T18:19Z -->
