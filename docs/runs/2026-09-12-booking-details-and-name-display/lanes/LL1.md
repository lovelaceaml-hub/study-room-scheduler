---
lane: LL1
title: Shared model, transport, backend contract, and classic app
state: merged
model: executor_luna
runner: coordinator
worktree: /Users/anthony/Projects/study-room-scheduler-worktrees/2026-09-12-booking-details-and-name-display/L1
review: reviewer_terra
depends_on: none
updated: 2026-09-12T20:35Z
---

# LL1: Shared model, transport, backend contract, and classic app

## Work order

Implement the shared title-aware public name projection, owner-only booking details, reserved-for validation and transport, backend persistence, classic booking flow, and focused tests.

## Result

Integrated as controller commit `5ffd034`, based on lane commit `87da374`. Added shared model and transport fields, callable persistence and validation, classic booking details, and owner actions. Focused backend and shared projection checks passed.

## Review

Controller integration review: merged cleanly. Privacy projection keeps ownerUid, reservedFor, notes, and full names out of public rows. Final browser verification passed after the controller completed the two-field step and TV/public-lobby normalization.
