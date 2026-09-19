# Shared My reservations contract (from the Lane 1 writer, reviewed by the coordinator)

### Shared contract for Lanes 2 and 3

**Model helpers** (all pure, all in `/Users/anthony/Projects/study-room-scheduler/experiences/shared/model.js`, all taking one `myBookings` row where `start` and `end` are `'HH:MM'` strings):
- `reservationResource(booking)` returns `{type:'room'|'whiteboard'|'tv', unit:Number|null, label:String}` or `null`. Labels are "Study Room 2", "Whiteboard 4", "TV 3", or the kind alone when no unit is assigned. Each design should render its own wording from `type` and `unit` (Solace uses its own `types[type].one`, giving "Room 2", "Whiteboard 4", "TV 3").
- `reservationStatusLabel(booking)` returns "Pending review", "Approved", "Declined", "Cancelled", "Given to a higher priority", or `''`.
- `reservationPurposeLabel(booking)` returns "Contact", "New Member", "Other" or "Reserved".
- `endedEarly(booking)` returns true when `endedEarlyFrom` is later than the current end.
- `endEarlyOptions(booking)` returns `['HH:MM', ...]`, every 30 minute boundary after the start and before the current ending; empty for a single block.
- `endEarlyNowOption(booking, now = new Date())` returns the last boundary the Los Angeles clock has passed today, else `null`. Mark that choice "now".
- `groupMyReservations(rows)` returns `{upcoming, past}`; upcoming is `pending` and `approved`, past is everything else, both sorted by date then start.
- `priorityNoticeText(booking)` returns one plain sentence for a `moved` or `released` notice, or `''`.

**Deep link.** `?view=mine` on the design's own URL opens My reservations on load. Opening pushes `view=mine` onto the URL, closing removes it, and a `popstate` listener keeps the view and the URL in step so Back works. Preserve any other parameters, `demo=1` especially. The footer link is a real `href="?view=mine"` whose click handler calls `preventDefault()` and opens the view, so it still works without JavaScript.

**Cancel and End early.** Call the shared functions directly with a plain booking id:
- `live.cancelOwnedBooking(bookingId)` where `bookingId` is `booking.id` from `myBookings`, or `ownerDetail.bookingId` on a public row. It updates `myBookings` and drops the public row itself; do not call `retry()` afterwards.
- `live.endOwnedBookingEarly(bookingId, end)` where `end` is one of `endEarlyOptions(booking)` as `'HH:MM'` (a minutes number is also accepted). It rejects any other value, updates the row, and shortens the public row.
Both throw an `Error` whose `message` is member-safe copy: show it and leave the person on the step they were on. Never write Firestore or call a callable directly from a design.

**Parity matrix** (every one of these is in Solace and asserted in the smoke, and the classic screen is `app.js` roughly lines 1213 and 1398 to 1470):
- Both lists: "Upcoming" (pending, approved) and "Past reservations" (cancelled, declined, overridden), from `myBookings` only; no historical fetch and no backend change.
- Each card: day, time range, resource, purpose, and the reserved-for detail under that purpose's own label (Solace uses "Contact Name", "Member Name", "Purpose").
- Status shown for all five statuses.
- "Ended early, originally booked until 3:00 PM" when `endedEarly(booking)`.
- The priority update sentence for both `moved` and `released`.
- "Reserve another time" on an `overridden` reservation, opening that design's own reserve flow.
- "End early" when `canEndEarly` and `endEarlyOptions` is not empty, leading to a chooser (with the "now" marker) and then a confirmation step.
- "Cancel reservation" when approved and "Cancel request" when pending, each with its own confirmation step; "Keep it" returns focus to the button it came from.
- States: loading, empty (with a "Reserve a space" action), error (with Retry connection), and a reconnecting or offline banner that disables Cancel and End early until the schedule is live again.
- Demo mode shows the same screen and reaches no backend.

**Footer Admin link markup.** Inside the design's own member navigation, last item, plain text: `<a href="/admin/" class="member-admin-link">Admin</a>`. It 404s until Lane 4 lands, as planned.

**Test fixtures.** `test/member-design-smoke.mjs` now drives fictional owned reservations through `localStorage['srs-mine-fixture']`, which the mocked `memberSchedule` returns as `myBookings` and as matching public rows with `ownerDetail`, and which mocked `memberCancelBooking` and `memberEndBookingEarly` mutate so a refresh stays consistent. Lanes 2 and 3 can copy that fixture block into their own smoke files. Fixture dates now come from `eligibleDays()[0].key` rather than a hardcoded date, which is what stops them ageing out.
