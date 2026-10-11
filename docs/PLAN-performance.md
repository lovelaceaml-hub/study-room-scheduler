# Performance improvements

## Goal

Make the schedule, booking choices, Admin tools and lobby display do less
repeated work without changing booking rules, what users see, or data access
boundaries.

## Acceptance criteria

- Schedule occupancy lookup is indexed by day, unit and time slot for member
  and Admin views.
- Booking choices share an occupancy index across candidate start/end times
  and continue to match direct rule results.
- Admin search text, booking-by-ID and booking-by-day lookups are reused.
- The TV groups and sorts each room's schedule once per render.
- Unchanged member-grid inputs skip grid generation; highlight changes still
  repaint the grid.
- Admin does not poll while hidden and catches up when visible; member and
  Admin polling intervals are 30 seconds. User-initiated actions still reload
  immediately.
- Parsed opening hours and service boundaries are cached for reused config
  and day objects.
- Session deadline updates do not fetch schedules or notes; the existing
  behavior is retained.
- Existing booking rules, accessible interactions and live-data boundaries
  remain unchanged.

## Sections

## Section 1: Index schedule occupancy

Index occupied slots once for member grids, Admin maps and Admin overlap
checks.

## Section 2: Reuse booking availability work

Build one indexed occupancy view for each candidate start-time calculation,
then reuse it across candidate ends.

## Section 3: Cache Admin search text

Reuse normalized search content while the reservation and server config stay
the same.

## Section 4: Index Admin bookings

Build lookup maps by ID and day when a schedule arrives.

## Section 5: Group TV bookings

Partition a day's bookings by room once and reuse each group in cards and the
timeline.

## Section 6: Sort TV bookings once

Sort each room's group once and pass it to the status renderer without another
sort.

## Section 7: Skip unchanged grid rendering

Compare the inputs that affect the member grid before rebuilding its markup.

## Section 8: Preserve deadline-only Admin updates

Confirm the existing deadline callback does not reload schedule or note data;
make no change if already satisfied.

## Section 9: Reduce unnecessary polling

Move member and Admin polling to 30 seconds and pause Admin polling while
hidden, without delaying refreshes after actions.

## Section 10: Cache parsed schedule times

Cache parsed opening hours and service boundaries for each immutable config
and day object.

## Build log

- Baseline: `8ec837af6ae56e2f75f8a588db508681974de17c`, clean worktree. The
  content-aware baseline is owner-only local storage, opaque ID
  `20261011T190928Z`.
- Implemented indexed occupancy and Admin lookups, availability-index reuse,
  cached search text and parsed time boundaries, grouped/sorted TV data,
  member-grid render memoization, and 30-second member/Admin polling with
  hidden-page pause and stale-on-return refresh.
- Section 8 was already satisfied: `admin.on('deadline', showDeadline)` only
  updates the deadline display. No unnecessary schedule fetch was added.
- Targeted availability/TV unit checks passed (25 tests). Targeted member and
  Admin browser checks passed (4 tests), including booking focus, refresh
  frequency and hidden-page behavior.
- Full checks passed: `npm test` (141 tests) and `npm run test:browser` (77
  tests, including phone-width and accessibility checks).
- Synthetic lookup check: for 5,000 booking rows and 416 grid lookups, the
  indexed lookup plus index build took 3.30 ms versus 31.07 ms for linear
  scans in this local run. This measures the lookup algorithm only, not
  production traffic or a user's device.
- Independent code review: no significant issues found.
- Documentation hygiene review: no findings.
- Pull request checks and read-only preview are running.
