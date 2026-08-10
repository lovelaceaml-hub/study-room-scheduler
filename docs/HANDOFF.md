# Handoff notes — LV Zion Study Rooms

## Current status

**August 1, 2026 — Firebase scheduler restored and live.** The established
`lvrooms.web.app` booking site and its Functions/Firestore rules are active.
LV Zion Study Rooms is also active at `/rooms` by owner decision.

An encrypted local snapshot contained 129 documents, and LV Zion's importer
dry-run twice, apply, and post-apply reconciliation agreed: 64 source
bookings, 18 eligible/confirmed, 18 imported, 18 unchanged afterward, 4
account-linked, and 14 deliberately unclaimed for coordinator management.
There is no ongoing sync: Firebase and LV Zion bookings are separate. The
release owner explicitly waived the representative-member test because of time
constraints. No Firebase resource is authorized for deletion.

For the temporary public LV Zion release only, `functions:publicLobbySchedule`
provides a read-only projection of the Firebase lobby timetable. It returns
only the lobby's offered dates (today and the next Tuesday/Saturday), approved
Room 1–4 bookings with date, time, room, and an abbreviated name—never booking
IDs, owner IDs, requests, notes, equipment, or timestamps. LV Zion renders
that feed on its server; it does not read Firebase booking documents in a
visitor's browser. This is a display feed, not a booking sync.

**July 26, 2026 — approval removed and End early added. Deployed and live-verified.**
Deployment was `--only functions,hosting:app`: the new `memberEndBookingEarly` function was
created and the seven existing functions updated in `us-west1`. Firestore rules, indexes,
Authentication, and the `legacy` redirect target were unchanged. Live checks at
`https://lvrooms.web.app`: both eligible days report instant confirmation at every hour,
Monday is still refused, the End early sheet lists each earlier boundary with its freed
range, the "now" hint matches Los Angeles time, the reservation list goes inert behind the
sheet, no pending sections render, and the console is clean on both the demo and real app.

**July 26, 2026 — approval removed and End early added.** Every reservation is now
confirmed the moment it is made, on both eligible days. `shouldAutoApproveMemberBooking`
returns true for any Tuesday or Saturday in the shared front-end copy and in
`functions/lib/policy.js`, so the trusted backend and the member promise still match.
Availability remains the only gate: a submission is still refused, in the same
transaction as before, when no numbered unit is free for the whole range.

The new **End early** action lets the member who made a reservation—or Admin—move its
ending back to any earlier 30-minute boundary, releasing the rest of the time for
everyone immediately. It is implemented as the `memberEndBookingEarly` callable and an
`end-early` case in `adminBookingAction`, both validated by `earlyEndError` in
`functions/lib/policy.js`: the new ending must be on the grid, earlier than the current
ending, later than the start (a booking may never be shortened to nothing—cancel it
instead), and still valid for that day, including service blocks. The booking keeps its
unit, its owner, and an `endedEarlyFrom` record of what was originally booked.
Firestore rules are unchanged; ending early goes through the Admin SDK like every other
write, so members still cannot edit booking documents directly.

Older requests that were pending when this shipped are untouched. They remain in the
Admin queue and can still be approved, declined, or cancelled there.

**Live.** The July 20, 2026 mobile-first availability release was deployed to
https://lvrooms.web.app and live-verified with phone and TV demos. It adds vertical
start-time slots, an immediate **When should it end?** prompt, a member Home day
overview, named assignment/pending details, 11:00 PM closing, an eligible-day TV picker,
and complete browser-only mock data. The earlier compact dashboard and exact-time
scheduler were deployed and verified on July 19, 2026.

**Live layout refinement.** The July 20 Hosting-only release also removed Home's
device-specific notification and current/next-summary cards, made its Day overview
expandable by Morning/Afternoon/Evening, combined the then-separate member time and
availability controls into compact connected rows, and made the lobby TV study-room-only.
The deployed assets were checked at the primary address after release; Functions, Firestore rules,
indexes, and the legacy redirect were unchanged.

**July 21 Home-first release.** The Home-first redesign removes the member Reservations
tab on every width. Home starts with two compact Live updates, then owns
the one-date stepper, resource choice, daypart grids, start/end/availability/Continue
flow, purpose-under-name cells, and explicit vertical-scroll cues. My reservations,
Admin, policy, privacy, and the lobby TV stay unchanged. It was deployed and live-
verified on July 21, 2026.

Verification completed: `npm test` passed 13/13; `npm run test:ui`, the TV smoke test,
and `git diff --check` passed; an independent re-review found no P0/P1 issues. The live
member app was checked at 393×852 for three tabs, two Live-update rows, purpose in booked
cells, Reserved privacy, the scroll cue, the end-time sheet, and no page overflow. Only
the primary Hosting `app` target was deployed. Functions, Firestore rules, indexes,
Authentication, and the legacy redirect were unchanged.

**July 22 selection-bar update — live.** After a member chooses an exact end time,
Home keeps the selected range, **Clear**, and **Continue** in a viewport-fixed bar. On
phones it sits above the fixed navigation; on larger screens it is centered near the
bottom of the viewport. This is a presentation-only change and does not alter booking
policy, capacity, dates, privacy, demo data, TV output, or backend behavior.

Verification completed: `npm test` passed 13/13; `npm run test:ui` passed; the focused
`npm run test:selection-bar` passed; `git diff --check` passed; and a read-only live
Playwright check at `https://lvrooms.web.app/?demo=1&test=1` measured the bar as fixed
and fully inside the 390×844 viewport both before and after scrolling. Only Hosting
target `app` was deployed. Functions, Firestore rules, indexes, Authentication, and
the legacy redirect were unchanged.

**July 21 mobile grid-density follow-up — live.** Commit `e940438` keeps phone-width
Home tiles evenly spaced with 44px minimum dimensions, retains the 58px single-line time
column, and uses 10px occupant names with 8.5px ellipsized purpose labels. It is a
visual Home-grid tightening only: booking rules, capacity, dates, fixtures, privacy, TV
output, Functions, Firestore, and Authentication remain unchanged. All 13 policy tests,
UI/axe, TV smoke, and diff checks passed. Independent review initially found a P1
8.5px/7.5px tiny-text regression; it was corrected and the final review found no
remaining P0/P1/P2 issues. Read-only Playwright at `https://lvrooms.web.app/?demo=1`
measured a fitting 58px time column, 65.75×44px tiles, 10px names, 8.5px purposes, and
no overflow. Deployment was `hosting:app` only; Functions, Firestore, Authentication,
and the legacy redirect were unchanged.

**July 21 two-item follow-up — live.** Commit `880afcb` narrows the Home day map’s
mobile time column and prevents its labels from wrapping, preserving room-tile width. It
also orders Live updates newest-first from the latest created, updated, or decision
timestamp, including normalizing browser, ISO, and Firestore timestamp forms. It changes
no policy, date, demo, privacy, TV, Function, Firestore, or Authentication behavior.
All 13 policy tests, UI smoke plus axe (including geometry, ISO, and latest-first), and
TV smoke passed. An independent re-review found no P0/P1 issues. Read-only Playwright at
`https://lvrooms.web.app/?demo=1` verified Jordan as the latest update, the one-line
58px time column, 66.5px room tiles, and no overflow at 393×852. Deployment was
`hosting:app` only; Functions, Firestore, Authentication, and the legacy redirect were
unchanged.

**July 21 annotation refinement — live.** Commit `29bc9d4` keeps two
visible Live-update rows on Home but lets their activity scroll independently; resource
controls now omit counts and remain 44px compact buttons; the masthead **Schedule**
link opens the public TV page; My reservations uses compact cards with a distinct
destructive cancellation action; and the Admin Recent updates feed is removed. This
change does not alter booking policy, eligible dates, fixture data, TV content, security,
or backend code. `npm test` passed 13/13; UI smoke passed, including the 393×852
no-overlap check and zero-Firebase demo Schedule navigation; TV smoke passed; and an
independent re-review found no remaining P0/P1 issues. A read-only Playwright check at
`https://lvrooms.web.app/?demo=1` confirmed Schedule retains `demo=1`, compact cards and
the cancellation action, count-free resource controls, the scrolling Live-update feed,
and the absent Admin feed. Deployment was only `hosting:app`; Functions, Firestore,
Authentication, and the legacy redirect were unchanged.

- **Firebase scheduler:** https://lvrooms.web.app
- **Firebase lobby TV:** https://lvrooms.web.app/?tv=1
- **Separate LV Zion scheduler:** https://lvzion.vercel.app/rooms
- **Firebase project:** `lvz-rooms`
- **GitHub repository:** `lovelaceaml-hub/study-room-scheduler` (private)

## Approved implementation

- Show only the upcoming Tuesday and upcoming Saturday, including today when
  applicable, in chronological order.
- Use 30-minute booking slots through 11:00 PM, including 10:00 PM and 10:30 PM starts.
- Block Tuesday 8:00–9:00 PM and Saturday 9:00–10:00 AM, 3:00–4:00 PM, and
  8:00–9:00 PM for services.
- Show Saturday from 9:00 AM so the morning service is visible; booking still begins
  at 10:00 AM.
- Open on Home with two visible compact Live-update rows first, followed by the
  member-safe Day overview. The update area scrolls independently when activity exceeds
  those rows. Study Rooms are the default; count-free 44px Study room, Whiteboard, and
  TV controls remain selectable.
- Make Home the only member booking screen at every width: members step between the two
  eligible dates with its one-date arrows, open Morning/Afternoon/Evening, follow the
  scroll cue where needed, tap an open cell, choose the exact ending in the **When
  should it end?** sheet, inspect availability, and continue to the remaining details.
- Store the second selected time as the exact ending; never silently add another
  30 minutes. Keep member options divided around service periods while the TV retains
  visible service bands.
- Make the complete-range open total a button that shows numbered-unit occupants. The
  pending count and pending lists appear only while a legacy pending request exists.
- Refuse a range that has no one unit open throughout. Offer the longest continuous
  shorter ending with Yes/No actions when possible, and repeat the check in the
  protected backend transaction for both Tuesday and Saturday.
- Keep pending requests unassigned in the member and Admin views; do not show them on
  the lobby TV.
- Move approved requests into Study Room 1–4, Whiteboard 1–5, or TV 1–3 rows.
- Remove the Baptism Room from future scheduling and return active future assignments
  there to pending for reassignment.
- Add the read-only lobby TV presentation with an eligible-day picker, first name plus
  last initial, four study-room availability cards, an approved-only supporting timeline,
  current time when viewing today, live status, and cached reconnect behavior.
- Improve the phone layout with a compact tappable calendar, larger touch targets,
  clearer selected states, pop-up labels and announcements, keyboard access, and
  enlarged-text support.
- Use silent member identity for ownership and protected backend Admin actions while
  keeping the existing server-validated administrator PIN flow while moving its value out of documentation.
- Keep optional notes Admin-only and never expose them on public or TV schedules.
- Member reservations now use one resource type at a time (Study room, Whiteboard, or
  TV), a compact scrollable calendar, and a name-and-purpose-only confirmation sheet.
- The visual redesign uses shared, accessible light/dark design tokens across the
  member app and lobby TV. It preserves every scheduling and security behavior.
- Home now opens first and owns all member booking. The Study room, Whiteboard, and TV
  picker switches the visible resource schedule; Home uses a single-date arrow stepper
  and shows two Live updates before its overview, while My reservations focuses on this
  device’s requests.
  The header has no connection-status label, and left/right tab swiping is disabled.
- The masthead **Schedule** link opens the read-only public TV route. My reservations
  uses compact status cards and keeps its owner-only cancellation control visibly
  destructive. Admin removes the redundant Recent updates feed while retaining queue,
  selected-request, and day-overview context.
- Every Tuesday and Saturday reservation is confirmed on submission; no day has an
  approval step. Purpose priority ordering is retained only for the legacy pending
  queue: Contact, New Member, Study Member, Meeting, Other, then request time.
- A member or Admin may end an approved reservation early at any earlier 30-minute
  boundary. The freed time becomes immediately available on Home, in Admin, and on the
  lobby TV.
- The approved Quiet Study production design leads with availability counts on
  member screens, keeps numbered-unit occupancy expandable and secondary, presents
  My reservations as durable status cards, and expands Admin into a desktop
  queue-and-detail workspace.
- The lobby TV uses the refined Signal Timetable treatment with four study-room cards,
  an approved-only four-room timeline, service bands, and a track-relative current-time
  marker. It excludes pending-request, Whiteboard, and TV lanes.

## Important behavior

Reservations are assigned a numbered unit by the backend at submission time and are
accepted only when one unit is free for the entire requested range. Failed writes must
visibly fail and roll back instead of looking saved.

Ending early only ever shrinks a reservation, so it needs no capacity check and no rate
limit; it can free time but never take more. It must never be able to remove a booking
outright—that is what cancellation is for.

Legacy pending requests reserve no specific unit. Approval performs the assignment and a
fresh conflict check.

Home’s member-safe day overview lets a member tap an open half-hour slot, choose an end,
inspect availability, and continue without changing tabs. Its booked cells show only
the public member name and purpose; it must not expose private notes or Admin controls.

The TV’s day picker is limited to eligible Tuesday/Saturday dates. It uses `?tv=1`,
omits all Admin controls and private details, and preserves its last public schedule
during a connection interruption. Its cards and timeline use approved Study Room data
only. A browser-only demo populates both member and TV views with fixture data without
writing to Firestore.

## Rollout checklist

> The Firebase scheduler is live alongside LV Zion by the August 1, 2026 owner
> decision. The two systems are independent; do not assume their availability
> or bookings synchronize.

- Firebase Blaze billing is enabled on this project through the church's existing
  Firebase Payment account because protected functions require it.
- Confirm future Baptism Room bookings were safely returned to pending.
  **Still open as of August 6, 2026 — attempted and blocked, not skipped.** Reading
  the `bookings` collection in Firestore project `lvz-rooms` returned
  `403 PERMISSION_DENIED`: this Mac's application-default credential belongs to
  `lovelace.aml@gmail.com`, which can see only the four `gen-lang-client-*` /
  personal projects, not the church Firebase projects. Two safety nets mean nothing
  member-visible depends on this row: `canonicalAssignments` in
  `functions/lib/policy.js` rejects `room-baptism` outright, and the migration path
  forces `status: 'pending'` for any booking it retires
  (`functions/lib/policy.js:173`). What is unproven is the *stored* state of legacy
  rows. To close it, either run the admin `retire-baptism-room` action once from
  https://lvrooms.web.app (idempotent — it re-pends anything still assigned there),
  or grant an account with Firestore read on `lvz-rooms` so the count can be
  measured directly.
- Verify anonymous request creation and owner-only cancellation.
- Verify Admin unlock, approve, decline, cancel, reassignment, direct-add, and lock.
- Verify listed start-time and revealed End-time selection, Morning/Afternoon/Evening disclosures, date arrows,
  unavailable-range recovery, the viewport-fixed Clear/Continue bar while scrolling,
  and the booking pop-up on desktop and phone.
- Verify no member Reservations tab at phone or desktop widths; two compact Live-update
  rows; Home's one-date stepper; visible daypart scrolling; public name-and-purpose
  cells; 10:00 PM and 10:30 PM starts; the 11:00 PM final boundary; and Home's direct
  start/end/availability/Continue flow with named pending/assignment details.
- The July 21 annotation-refinement release verified two visible Home update rows with
  independent activity scrolling; 44px count-free resource controls; the masthead
  Schedule-to-TV route; compact My cards with a separately focused destructive cancel
  button; and no Admin Recent updates feed. Repeat these checks for later changes.
- The July 21 two-item follow-up verified the 320×720 and 393×852 Home grid has a
  compact no-wrap time column, readable room tiles, and no document-level overflow;
  Live updates place the newest status change first across number, browser-date, ISO,
  and Firestore timestamp values. Repeat UI smoke, policy, TV, demo-isolation,
  accessibility, and diff checks for later changes.
- The July 21 grid-density follow-up verified at 320×720 and 393×852 that Home tiles
  stay evenly spaced and at least 44px, the 58px time column is single-line, 10px names
  fit, 8.5px purpose labels ellipsize safely, and no document overflow occurs. Repeat
  UI smoke, axe, and diff checks for later changes.
- Verify that both Tuesday and Saturday reservations confirm instantly, at any hour and
  any number of days ahead, and that a full range is still refused with the shorter-ending
  offer.
- Verify End early on a member card and in the Admin day list: every earlier boundary is
  offered, the "now" choice matches Los Angeles time on the day itself, the freed time
  reappears as open, a 30-minute booking offers no End early, and the demo preview
  writes nothing.
- Verify simultaneous member, Admin, phone, and TV live updates, the TV eligible-day
  picker, four study-room cards, approved-only timeline, and filled member/TV demo data
  without Firestore writes.
- Verify 320/375/390-pixel phone views and 720p/1080p TV views.
- Verify the shared visual tokens load in both the member app and lobby TV after an
  installed copy updates.
- Verify the primary URL, previous-address redirect, and preservation of `?tv=1`.
- Verify installation and offline/reconnect behavior from the new hostname.
- Keep this file and the Quick links status current after future releases.

## Maintenance notes

The app is intentionally buildless. Keep scheduling rules centralized so member,
Admin, validation, and TV behavior cannot drift. Keep deployments scoped, preserve
the old hostname redirect, and seek Anthony’s approval before changing billing.
