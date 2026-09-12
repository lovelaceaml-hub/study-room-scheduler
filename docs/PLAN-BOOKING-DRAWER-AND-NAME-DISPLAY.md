# Booking details and name display

## Outcome

Make member booking details complete and understandable across all six live designs and the classic app. Normalize public names around a leading title initial, collect the person or purpose being reserved for, connect one booking into one visual schedule block, and let a member open a reservation to see details and use the actions they are authorized to use.

## Acceptance criteria

1. A leading title word or initial renders as one initial plus the given name. `Sister Kiana Davis`, `Sister Kiana D`, and `S. Kiana` render as `S Kiana`; `Kiana` remains `Kiana`. A surname initial is added only when same-given-name bookings have different surnames.
2. Every member design collects resource, purpose, start, end, and a purpose-specific reserved-for value before confirmation. Contact asks for Contact Name, New Member asks for Member Name, and Other asks for a purpose description.
3. A scheduled booking displays the public name and Contact, New Member, or Other purpose. Consecutive 30-minute segments belonging to one booking look like one connected block.
4. Clicking a reservation opens a detail sheet. Public viewers see only public-safe details. The owning member sees the full reserved-for detail and can use End early and Cancel when the existing authorization rules allow it. Admin behavior remains available in the classic app.
5. Existing priority override indicators and the existing privacy boundary remain intact. No design writes directly to Firestore. New member writes continue through `memberSubmitBooking`.
6. Focused model, backend, design journey, classic UI, and production smoke checks pass. Only Hosting target `app` and `functions:memberSubmitBooking` are eligible for release.

## Delivery choices

- Mode: Parallel, coordinator runner.
- Controller: Sol, current Codex thread, integration and release owner.
- Writers: three bounded `executor_luna` lanes at their pinned maximum effort, each in its own Git worktree.
- Reviewer: one fresh read-only `reviewer_terra` pass after integration because this changes member-visible names, private reserved-for details, and cancellation controls.
- UI target: preserve the existing six live design directions and the classic app conventions. This is a behavior and information-completeness refinement, not a new visual direction.
- Production release: full replace after verification, using the existing Hosting `app` target and only `functions:memberSubmitBooking` if its source changes.

## Lane ownership

### Lane L1: Shared model, transport, backend contract, and classic app

Own `experiences/shared/model.js`, `experiences/shared/live.js`, `functions/lib/policy.js`, `functions/index.js` only if needed for the existing member callable contract, focused shared/backend tests, `app.js`, and classic app tests. Add collision-aware display-name projection without exposing owner-only details to public schedule viewers. Reuse existing callable actions and authorization checks for member Cancel and End early.

### Lane L2: Atlas, Cove, and Lattice member experiences

Own only `experiences/atlas/` `experiences/cove/` and `experiences/lattice/`. Add the purpose-specific reserved-for step, connected booking blocks, clickable public-safe reservation details, owner details when available through the shared transport, and accessible controls without changing shared modules.

### Lane L3: Petal, Solace, and Velum member experiences

Own only `experiences/petal/` `experiences/solace/` and `experiences/velum/`. Add the same member journey and schedule behavior as L2, matching each design's established visual language and responsive layout without changing shared modules.

## Release and verification

Run focused tests first, then `npm test`, `node --test test/live-model.test.mjs functions/test/public-lobby-schedule.test.js`, `node test/member-design-smoke.mjs`, `npm run test:ui`, `npm run test:confirm-popup`, and `node test/tv-smoke.mjs`. Use a fictional local browser fixture for submissions and a read-only production browser smoke. Do not submit a real production reservation.

## Build log

- 2026-09-12: Started on branch `change/booking-details-and-name-display` from `ade7a79`. Preserved pre-existing untracked `docs/prototype-reserve-now.html` with SHA-256 `98a5cf059e3ff678231ed2d7f85e66fbdf827dbe517c6db47dffc037c3a6c9fa`.
