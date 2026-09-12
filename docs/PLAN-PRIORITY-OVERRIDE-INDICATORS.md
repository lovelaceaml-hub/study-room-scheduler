# Priority Override Indicators

## Outcome

When a member chooses Reserve Now, Study Room, and Contact, times held by lower-priority New Member or Other reservations remain selectable but are visibly marked as requiring a priority override. The existing transactional override callable remains the write authority.

## Model and execution setup

- Controller and integration: Sol, current Codex session.
- Runner: coordinator.
- Design lanes: one Codex agent per design, each owning only its experience folder in its own worktree.
- Shared policy and transport: controller-owned, integrated after design lanes land.
- Reviewer: no separate reviewer, per the active project plan's explicit no-review choice.
- Verification: focused policy and model tests, six fictional mocked journeys, UI smoke, and read-only production smoke.

## Lanes

### Lane L1: Atlas

Update only `/Users/anthony/Projects/study-room-scheduler/experiences/atlas/` so Contact can select occupied lower-priority ranges in Reserve Now and the time control visibly marks `Priority override`.

### Lane L2: Cove

Update only `/Users/anthony/Projects/study-room-scheduler/experiences/cove/` with the same behavior and accessible indicator.

### Lane L3: Lattice

Update only `/Users/anthony/Projects/study-room-scheduler/experiences/lattice/` with the same behavior and accessible indicator.

### Lane L4: Petal

Update only `/Users/anthony/Projects/study-room-scheduler/experiences/petal/` with the same behavior and accessible indicator.

### Lane L5: Solace

Update only `/Users/anthony/Projects/study-room-scheduler/experiences/solace/` with the same behavior and accessible indicator.

### Lane L6: Velum

Update only `/Users/anthony/Projects/study-room-scheduler/experiences/velum/` with the same behavior and accessible indicator.

## Integration contract

The controller will add shared `priorityForPurpose`, `overrideUnitForRange`, and validation/transport handling. Design lanes may assume these exports exist from `/Users/anthony/Projects/study-room-scheduler/experiences/shared/model.js` and `/Users/anthony/Projects/study-room-scheduler/experiences/shared/live.js`, with this interface:

```js
overrideUnitForRange(type, day, start, end, purpose, bookings) // unit id or null
validateInput(input, bookings, days) // returns override: true when only a lower-priority unit is usable
```

Each lane must preserve normal free-time behavior, use the override marker only when no free unit covers the complete range, and avoid changing Firebase calls or files outside its experience folder.

## Build log

- 2026-09-12: User reported that Reserve Now, Study Room, Contact hides or mishandles times already held by New Member and Other. Scope set to visible override-required indicators across all six designs, with priority policy extended consistently.
- 2026-09-12: Shared policy and transport changes passed focused checks. All six design lanes landed their indicators, complete project smoke passed, and a dedicated fictional all-lower-priority browser fixture confirmed the visible indicator and `memberSubmitBooking` path. Production deployment remains pending.
- 2026-09-12: Commit `6d7a01e` deployed successfully to Hosting target `app` and `functions:memberSubmitBooking`. Read-only production smoke passed for Atlas, Cove, Lattice, Petal, Solace, and Velum. No other Function, rules, indexes, Authentication, or legacy target was deployed.
- 2026-09-12: Final exact-unit safety commit `6008b92` deployed successfully to the same Hosting target and callable. Read-only production smoke passed again for all six routes.
