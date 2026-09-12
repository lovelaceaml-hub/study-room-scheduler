# Booking details and name display

## Outcome

Make member booking details complete and understandable across all six live designs and the classic app. Normalize public names around a leading title initial, collect the person or purpose being reserved for, connect one booking into one visual schedule block, and let a member open a reservation to see details and use the actions they are authorized to use.

## Acceptance criteria

1. A leading title word or initial renders as one initial plus the given name. `Sister Kiana Davis`, `Sister Kiana D`, and `S. Kiana` render as `S Kiana`; `Kiana` remains `Kiana`. A surname initial is added only when same-given-name bookings have different surnames.
2. Every member design collects resource, purpose, start, end, and a purpose-specific reserved-for value before confirmation. Contact asks for Contact Name, New Member asks for Member Name, and Other asks for a purpose description.
3. A scheduled booking displays the public name and Contact, New Member, or Other purpose. Consecutive 30-minute segments belonging to one booking look like one connected block.
4. Clicking a reservation opens a detail sheet. Everyone sees the public-safe name, reservation range, purpose, and purpose-specific reserved-for detail. Only the owning member sees and can use End early and Cancel when the existing authorization rules allow it. Admin behavior remains available in the classic app.
5. Raw booking documents are not readable by browsers. Member and TV clients use server-produced safe projections, public-safe reservation details are visible to everyone, owner action flags are returned only to the authenticated owner, and no design writes directly to Firestore. New member writes continue through `memberSubmitBooking`.
6. Focused model, backend, design journey, classic UI, security-rule, and production smoke checks pass. Release scope now includes Hosting target `app`, `memberSubmitBooking`, the secure member schedule and cancellation callables, the public lobby schedule endpoint, the Admin schedule callable, and the Firestore read-rule change.

## Delivery choices

- Mode: Parallel, coordinator runner.
- Controller: Sol, current Codex thread, integration and release owner.
- Writers: three bounded `executor_luna` lanes at their pinned maximum effort, each in its own Git worktree.
- Reviewer: one fresh read-only `reviewer_terra` pass after integration because this changes member-visible names, private reserved-for details, and cancellation controls.
- UI target: preserve the existing six live design directions and the classic app conventions. This is a behavior and information-completeness refinement, not a new visual direction.
- Production release: full replace after verification, using Hosting target `app`, the secure schedule and cancellation callables, the existing `memberSubmitBooking`, the public lobby schedule endpoint, the Admin schedule callable, and the Firestore read-rule change.

## Lane ownership

### Lane L1: Secure server boundary and backend contract

Own `firestore.rules`, `functions/index.js`, `functions/lib/public-lobby-schedule.js`, `functions/lib/policy.js`, and backend tests. Add server-produced safe member and Admin schedule responses, member cancellation, and preserve owner authorization. Raw booking records remain server-only.

### Lane L2: Shared member transport and classic app

Own `experiences/shared/live.js`, `app.js`, and shared/classic tests. Replace browser reads of raw bookings with the secure member schedule response, keep public detail visibility, and route member actions through protected callables.

### Lane L3: Atlas, Cove, and Lattice member experiences

Own only `experiences/atlas/` `experiences/cove/` and `experiences/lattice/`. Add the purpose-specific reserved-for step, connected booking blocks, clickable public-safe reservation details, owner details when available through the shared transport, and accessible controls without changing shared modules.

### Lane L4: Petal, Solace, and Velum member experiences

Own only `experiences/petal/` `experiences/solace/` and `experiences/velum/`. Add the same member journey and schedule behavior as L2, matching each design's established visual language and responsive layout without changing shared modules.

## Release and verification

Run focused tests first, then `npm test`, `node --test test/live-model.test.mjs functions/test/public-lobby-schedule.test.js`, `node test/member-design-smoke.mjs`, `npm run test:ui`, `npm run test:confirm-popup`, and `node test/tv-smoke.mjs`. Add a rule and secure-endpoint smoke that proves raw bookings are denied and public detail rows are safe. Use fictional local fixtures and a read-only production browser smoke. Do not submit a real production reservation.

## Build log

- 2026-09-12: Started on branch `change/booking-details-and-name-display` from `ade7a79`. Preserved pre-existing untracked `docs/prototype-reserve-now.html` with SHA-256 `98a5cf059e3ff678231ed2d7f85e66fbdf827dbe517c6db47dffc037c3a6c9fa`.
- 2026-09-12: Integrated L1 `87da374`, L2 `a1a4b6d`, and L3 `b640f1d`. Controller patches completed the two-field member flow, owner detail rows, TV and public-lobby normalization, and updated fictional browser assertions. Focused checks passed: 18 backend policy tests, 11 shared/public schedule tests, all six member-design journeys, chooser, home UI, confirmation popup, and TV smoke. Production release is pending the required full-replace or opt-in choice.
- 2026-09-12: Owner authorized the secure scope expansion after review found raw booking reads. The release now requires server-produced schedule projections, owner-authorized action details, a locked raw Firestore collection, and expanded function/rules deployment before production.
