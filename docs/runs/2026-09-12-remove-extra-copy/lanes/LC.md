---
lane: LC
title: Cove copy cleanup
state: merged
model: gpt-6-astra
runner: coordinator
worktree: /Users/anthony/Projects/.worktrees/study-room-copy-cleanup-cove
review: controller
depends_on: none
updated: 2026-09-12T18:19Z
---

# LC: Cove copy cleanup

## Work order

Remove Cove's promotional intro, invitation marketing text, and phone dock slogan. Keep functional guidance, controls, status, navigation, and booking behavior.

## Result

Cove removed the promotional intro, desktop invitation heading and paragraph, and phone dock copy, with button spacing adjusted. Changed only `experiences/cove/index.html` in the lane worktree. `git diff --check`, targeted copy checks, and local renders at 320, 390, and 1280 pixels passed. No overflow or JavaScript errors.

## Review

Controller review: landed cleanly. No material findings.
