# Study Rooms UI quality report — July 17–21, 2026

## July 21 annotation-refinement verification

Commit `29bc9d4` was deployed to **https://lvrooms.web.app** on July 21, 2026. It retains
two visible Home Live-update rows while the activity inside them scrolls independently;
removes counts from the 44px compact resource
controls; makes the masthead **Schedule** link open the public TV view; condenses My
reservations into compact cards with a separately focused destructive cancellation
button; and removes the Admin Recent updates activity feed. It does not change the
booking policy, demo isolation, privacy model, dates, or TV schedule data.

`npm test` passed all **13 of 13** policy tests. UI smoke passed, including the
**393×852** no-overlap check and zero-Firebase demo **Schedule** navigation. TV smoke
passed, and an independent re-review found no remaining P0/P1 issues. A read-only
Playwright check at **https://lvrooms.web.app/?demo=1** confirmed that Schedule retains
`demo=1`, My reservations keeps compact cards and cancellation, the resource controls
have no counts, the Live-update area scrolls, and the Admin feed is absent while its
queue/day overview remains. Only `hosting:app` deployed; Functions, Firestore,
Authentication, and the legacy redirect were unchanged.

The existing limitation remains: the Firestore-rule emulator cannot run on this Mac
until Java is installed, and browser checks do not replace a formal first-time-member
user study. The historical results below remain evidence for earlier releases.

## July 20 mobile, approval, TV, and mock-preview verification

This release was deployed to **https://lvrooms.web.app** and live-verified on July 20,
2026. It adds the member Home day overview, vertically stacked reservation starts, the
**When should it end?** sheet, assignment-and-pending availability details, 11:00 PM
closing, the Saturday 10:00 AM Los Angeles approval boundary, the selectable TV day
view, and fixture-only member, Admin, and TV previews.

`npm test` passed all **13 of 13** policy tests. `npm run test:ui` passed at
390×844 and 320×720, including axe checks with no violations, keyboard navigation,
dialog focus restoration, Home date/resource controls and pending-request rendering,
Home open-slot handoff, and member demo isolation. `node test/tv-smoke.mjs`
passed at 1280×720 and 1920×1080, covering the eligible-date selector and URL,
selected-date cache/subscription behavior, future-day time-marker suppression,
privacy-safe names, late-evening scale, and Firebase-free TV fixtures.

An interactive Codex in-app-browser walkthrough and live phone/TV demo verification
showed no console warnings or errors. The final independent review's Home-overview,
fixture-isolation, and shared-day-map findings were corrected and rechecked.

Firestore rules are unchanged. The Firestore rule emulator was not run because this
Mac does not have the Java runtime required by Firebase Emulator.

## July 20 layout-refinement verification

The layout-only refinement was deployed to **https://lvrooms.web.app** and live-verified
after the primary Hosting release. It removes Home's device-specific notification and
current/next-summary cards; makes the Day overview expandable by Morning, Afternoon,
and Evening; uses compact connected time/availability rows in Reservations; and changes
the lobby TV to four study-room availability cards with an approved-only study-room
timeline. Pending-request, Whiteboard, and TV lanes are excluded from that public
display.

The release check confirmed the deployed `app.js` contains the Daypart overview and the
deployed `tv.js` contains the four study-room availability cards. Retain the existing
limitation: the Firestore rule emulator cannot run on this Mac without Java, and
automated/browser checks do not replace a first-time-member user study.

## July 21 Home-first booking verification

The Home-first redesign was deployed to **https://lvrooms.web.app** and live-verified
on July 21, 2026. It removes the member Reservations tab at every width, places exactly two compact Live
updates above Home's Day overview, uses a one-date arrow stepper, shows purpose beneath
name in member/Admin booking cells, and adds visible vertical-scroll cues to expandable
dayparts. An open Home cell must carry the member through exact start, end,
availability-detail, and Continue states without changing tabs. My reservations, Admin,
the booking policy, privacy boundaries, and the lobby TV are unchanged.

`npm test` passed all **13 of 13** policy tests; `npm run test:ui`, the TV smoke test,
and `git diff --check` passed. An independent re-review found no P0/P1 issues. The live
member page was verified at **393×852** with exactly three tabs, two Live-update rows,
purpose beneath the booked name, privacy-safe **Reserved** content, the daypart scroll
cue, the end-time sheet, and no document-level overflow. Only the primary Hosting
`app` target was deployed; Functions, Firestore rules, indexes, Authentication, and the
legacy redirect were unchanged. The Firestore rule emulator remains unavailable on this
Mac without Java, and no formal first-time-member user study has been performed.

## July 19 compact-dashboard verification

The follow-up member picker was also driven at phone and desktop sizes before release:
half-hour start choices remain directly visible, keyboard Enter selects a start, the
chosen button keeps focus after rendering, and only then does the exact End-time menu
appear. Choosing a different start clears the old ending. Home displayed device-private
pending, next, and denied notices above the shared unit schedule. Axe reported zero
violations, the 320-pixel view had no horizontal overflow, and policy tests continued
to pass. An independent review found no blocking implementation issue; its two missing
regression checks for keyboard selection and stale-ending reset were added and passed.
After the Hosting-only production release, the live mobile page was checked again at
**https://lvrooms.web.app/?demo=1**. The deployed JavaScript matched the verified local
file byte-for-byte; the visible start choices and revealed End-time menu worked without
horizontal overflow or browser errors.

The Home dashboard, date stepper, listed starts with a revealed End menu, compact open/pending
summary, numbered-unit disclosure, and unavailable-range recovery were driven in a
real headless Chromium browser at 390×844 and 1280×900. The sample conflict used three
rooms occupied from 11:00–11:30 AM plus one room occupied from 10:00 AM onward.
Selecting 10:00 AM then 11:30 AM produced the required unavailable message and offered
10:00–11:00 AM instead; Yes produced exactly that range and the confirmation sheet
repeated it. Home rendered all four rooms and the bounded live feed, and the date arrows
moved between Tuesday and Saturday. The browser reported no page errors.

After the protected function and `app` Hosting target were deployed on July 19, the
same critical journey passed against **https://lvrooms.web.app/?demo=1** in a fresh
browser context. The live **https://lvrooms.web.app/?tv=1** route also rendered its
real-time timetable surface successfully. Demo verification made no booking writes.

Phone and desktop screenshots were visually reviewed for hierarchy, overflow, fixed
navigation, disclosure state, readable labels, and touch-target size. JavaScript syntax,
policy tests, diff checks, narrow-screen overflow, keyboard focus, and the independent
review evidence are recorded in the current release handoff.

This report retains the original July 17 redesign evidence and adds the July 19
dashboard, interaction, accessibility, and protected-capacity checks above.

## Current surfaces reviewed

- Member Reservations using Quiet Study and availability-first time rows.
- My reservations using durable upcoming and previous-decision cards.
- Admin at locked-phone and unlocked-desktop sizes.
- Lobby TV using the Signal Timetable presentation.
- Light and dark system themes.

## Current browser evidence

The current release was served locally and then live-verified through its visible
controls. The July 17 and July 19 production evidence above is retained as historical
evidence for those earlier releases.

| View | Size | Result |
|---|---:|---|
| Member | 320 × 720 | No document-level sideways scrolling; keyboard tab navigation and dialog-focus restoration passed. |
| Member | 390 × 844 | Home date/resource controls, pending-request visibility, vertical starts, exact endpoint sheet, availability details, conflict recovery, and axe checks passed. |
| Admin demo | Browser preview | Admin was automatically unlocked as a clearly labeled, read-only sample; no Admin action could write data. |
| Lobby TV | 1280 × 720 | Eligible-day controls, approved rows, pending lanes, service bands, and the full 11:00 PM scale fit without overflow. |
| Lobby TV | 1920 × 1080 | The chosen-date view, privacy-safe names, and wide-screen layout rendered without horizontal overflow. |

The TV smoke test covers Today plus the upcoming Tuesday/Saturday choices. It verifies
all 12 unit rows, full-day positioning through 11:00 PM, service bands, pending lanes,
the track-relative current-time marker for Today only, and no marker for a chosen future
day.

## Current interaction and state checks

- Vertically stacked start rows open a **When should it end?** sheet. Its choices use
  exact boundaries; 10:00 AM plus 11:30 AM means 10:00–11:30 AM with no hidden extra
  half-hour.
- Whole-range capacity is calculated from a unit that remains open throughout the
  complete range, not independent half-hour counts.
- An open Home slot carries its date, resource, and highlighted start into the exact
  end-time flow; Clear and the end-time sheet both preserve understandable recovery
  paths.
- Tuesday is instant when open. Saturday is instant only for a request submitted on that
  Saturday at or after 10:00 AM Los Angeles time; advance and pre-10:00 AM Saturday
  requests remain pending.
- Name and Other-purpose validation remained required.
- Demo mode uses fixture-only data, skips Firebase startup, and provides an automatically
  unlocked, clearly labeled read-only Admin preview; its controls do not write data.
- Availability totals open named approved-unit assignments and named overlapping pending
  requests. Pending demand remains unassigned and never occupies a numbered unit before
  approval.
- Admin queue selection changed the detail and assignment context without changing
  data. Approve/decline/direct-add controls have duplicate-submit guards.
- Empty/loading, pending, approved, declined, cancelled, reconnecting, error, and
  closed-day presentations are all explicitly represented.

## Current keyboard and accessibility checks

- Tabs expose correct tab roles, selected state, roving tab stops, selected-panel
  labels, and arrow-key navigation without swipe gestures.
- Start rows and end-time choices preserve keyboard focus after rerender, and the
  completed range is announced through a polite status region.
- End-time, availability-detail, and booking sheets trap Tab, support Escape, make
  background controls inert, and restore focus to their invoking control when closed.
- Admin text fields and the PIN retain value, caret, and focus during live-data
  rerenders; session expiry automatically clears private notes and relocks the UI.
- Visible focus uses a high-contrast light-and-dark double ring, including on
  primary-colored cards. Small muted text and featured-card accents meet the
  reviewed contrast thresholds.
- Status is communicated with text and shape/pattern, not color alone.
- Member/Admin controls meet the 44px target, and mobile inputs use at least 16px
  text to avoid iPhone auto-zoom.
- Extremely narrow/enlarged-text layouts stack resource controls, selection actions,
  purpose controls, and sheet actions rather than clipping.
- User-provided long strings use safe wrapping, and banner messages use text-only
  rendering to prevent stored HTML execution.

## Current automated checks

- `node --check` passed for `app.js`, `tv.js`, and `sw.js`.
- All 13 scheduling-policy tests passed, including the 11:00 PM boundary, service
  checks, and Los Angeles Saturday 9:59 AM / 10:00 AM approval cutoff.
- The Playwright member critical journey and automated axe checks passed with zero
  violations on the tested Home, reservation, and dialog states.
- The TV smoke test passed at 1280×720 and 1920×1080, including eligible-date links,
  future-day marker suppression, and Firebase-free demo fixtures.
- `git diff --check` passed.
- Firestore rules were not changed. Their emulator suite could not start because
  this Mac does not currently have the Java runtime required by Firebase Emulator.

Automated and browser walkthrough evidence is not a substitute for a formal first-time
user study. A 5–8-person study with first-time members was not performed for this
release.

## Independent review

Three separate reviewers challenged the implementation for scheduling accuracy,
mobile/accessibility behavior, Admin security/privacy, and lobby-TV fidelity. The
current review's Home date/pending visibility, fixture isolation, and shared-day-map
findings were corrected and rechecked before the July 20 deployment. Earlier July 17/19
findings remain historical evidence for those earlier deployed releases.
