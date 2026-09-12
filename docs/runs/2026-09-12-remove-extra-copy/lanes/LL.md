---
lane: LL
title: Lattice copy cleanup
state: merged
model: gpt-6-astra
runner: coordinator
worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-lattice
review: controller
depends_on: none
updated: 2026-09-12T18:19Z
---

# LL: Lattice copy cleanup

## Work order

Remove Lattice's promotional hero heading, paragraph, and redundant date-schedule eyebrow. Keep date/resource controls, schedule title, status, and booking behavior.

## Result

Lattice removed the promotional heading and paragraph, the dynamic date-schedule eyebrow, and unused hero styling. Changed `experiences/lattice/index.html`, `experiences/lattice/lattice.css`, and the integration-owned `experiences/lattice/lattice.js` updater. `git diff --check`, targeted copy checks, all-resource mocked bookings, error recovery, offline protection, and phone/desktop checks passed.

## Review

Controller review: landed cleanly. No material findings.
